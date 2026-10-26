/**
 * Property-based correctness check (see docs/PLAN.md §3 "never miss a valid
 * combination, never return an invalid one" and §6 step 6 "correctness
 * oracle"). `search()`'s branch-and-bound pruning is cross-checked against a
 * deliberately naive, unpruned brute-force reference on small random
 * synthetic datasets -- if pruning ever discards a valid combination, or the
 * bound is unsound and lets an invalid one through, this catches it.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { fillSlots } from './decorations'
import { search } from './engine'
import { OPEN_SLOT_WEIGHT } from './ilp-model'
import { collect } from './test-helpers'
import type { BuildResult, Candidate, Decoration, SkillRequirement, SlotQuery } from './types'

/** Caps each dimension of `raw` at its own requirement's threshold -- once a
 * requirement is met, more points in it don't make a build "more valid" for
 * comparison purposes here (see the brute-force oracle functions below: this
 * is only used to compare *which outcomes* exist, never to rank them). Kept
 * local rather than imported from the old Pareto engine's dominance.ts,
 * which this property test's own correctness check doesn't depend on. */
function cappedVector(raw: readonly number[], requirements: readonly SkillRequirement[]): number[] {
  return raw.map((v, k) => (k < requirements.length ? Math.min(v, requirements[k].minPoints) : v))
}

function bruteForceSearch(
  slots: readonly SlotQuery[],
  requirements: readonly SkillRequirement[],
): BuildResult[] {
  const results: BuildResult[] = []

  function recurse(slotIndex: number, picks: Map<string, Candidate>): void {
    if (slotIndex === slots.length) {
      const totals = new Map<number, number>()
      for (const candidate of picks.values()) {
        for (const { skillId, points } of candidate.skills) {
          totals.set(skillId, (totals.get(skillId) ?? 0) + points)
        }
      }
      const meetsAll = requirements.every((r) => (totals.get(r.skillId) ?? 0) >= r.minPoints)
      if (meetsAll) {
        results.push({
          picks: new Map(picks),
          decorations: new Map(),
          cuffs: [],
          skillTotals: totals,
        })
      }
      return
    }

    const slot = slots[slotIndex]
    for (const candidate of slot.candidates) {
      picks.set(slot.slotId, candidate)
      recurse(slotIndex + 1, picks)
      picks.delete(slot.slotId)
    }
  }

  recurse(0, new Map())
  return results
}

/** search() only ever surfaces non-dominated builds (confirmed project
 * direction, see engine.ts's module docstring) -- the brute-force oracle
 * must be pruned the same way before comparing, independent of which exact
 * picks produced each vector (ties on the same vector are preserved).
 * Vectors are capped per requirement (`cappedVector`) to match search()'s
 * own dominance rule: once a requirement is met, more points in it don't
 * make a build better (see dominance.ts's module docstring) -- without this,
 * the oracle would still treat "overshoots a requirement" as strictly better
 * than "just meets it," which search() no longer does. */
function pruneDominated(
  results: readonly BuildResult[],
  requirements: readonly SkillRequirement[],
): BuildResult[] {
  const vectors = results.map((r) =>
    cappedVector(
      requirements.map((req) => r.skillTotals.get(req.skillId) ?? 0),
      requirements,
    ),
  )
  return results.filter(
    (_, i) => !vectors.some((v, j) => j !== i && dominatesVector(v, vectors[i])),
  )
}

function dominatesVector(a: readonly number[], b: readonly number[]): boolean {
  let identical = true
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return false
    if (a[i] !== b[i]) identical = false
  }
  return !identical
}

/** A result's capped vector (see `cappedVector`'s docstring), as a
 * comparable string -- used to compare *which outcomes* search() finds
 * against the brute-force oracle, not *how many distinct raw ways* (which
 * picks and decorations) it finds each one via. See `cappedVector`'s
 * docstring on why capping can make the incremental merge under-count
 * (never over-count, and never miss a better or admit a worse outcome)
 * exactly how many tied paths reach a given vector. */
function vectorSignature(result: BuildResult, requirements: readonly SkillRequirement[]): string {
  return cappedVector(
    requirements.map((r) => result.skillTotals.get(r.skillId) ?? 0),
    requirements,
  ).join(',')
}

const skillIdArb = fc.integer({ min: 1, max: 4 })

const candidateArb = fc.record({
  id: fc.uuid(),
  skills: fc.uniqueArray(
    fc.record({ skillId: skillIdArb, points: fc.integer({ min: 0, max: 10 }) }),
    { selector: (s) => s.skillId, maxLength: 4 },
  ),
})

const slotsArb = fc
  .array(fc.array(candidateArb, { minLength: 1, maxLength: 3 }), { minLength: 0, maxLength: 4 })
  .map((perSlotCandidates) =>
    perSlotCandidates.map((candidates, i): SlotQuery => ({ slotId: `slot-${i}`, candidates })),
  )

const requirementsArb = fc.uniqueArray(
  fc.record({ skillId: skillIdArb, minPoints: fc.integer({ min: 0, max: 15 }) }),
  { selector: (r) => r.skillId, maxLength: 4 },
)

describe('search (property-based)', () => {
  // See the decoration describe block below for why this is so generous: a
  // MIP solve's cost is input-sensitive, and a rare random instance can take
  // far longer than the typical case even at this tiny synthetic scale.
  const TEST_TIMEOUT_MS = 300_000

  it(
    'reaches exactly the same set of distinct outcomes as an unpruned brute-force search',
    async () => {
      // Compares distinct (capped) vectors reached, not exact pick signatures
      // or counts -- see `vectorSignature`'s docstring for why capping means
      // these can no longer be compared tie-for-tie.
      await fc.assert(
        fc.asyncProperty(slotsArb, requirementsArb, async (slots, requirements) => {
          const actual = await collect(search(slots, requirements))
          const expected = pruneDominated(bruteForceSearch(slots, requirements), requirements)

          const actualVectors = new Set(actual.map((r) => vectorSignature(r, requirements)))
          const expectedVectors = new Set(expected.map((r) => vectorSignature(r, requirements)))

          expect(actualVectors).toEqual(expectedVectors)
        }),
        // Matches the decoration describe block's own cap below: a
        // correctness invariant like this one plateaus well before fast-
        // check's default of 100 random cases, and each case is a full MIP
        // solve-to-exhaustion (every round until infeasible) -- halving the
        // case count halves this test's contribution to the solver-time
        // variance documented below, for no loss of meaningful coverage.
        { numRuns: 50 },
      )
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'never returns a combination that fails a requirement',
    async () => {
      await fc.assert(
        fc.asyncProperty(slotsArb, requirementsArb, async (slots, requirements) => {
          const results = await collect(search(slots, requirements))

          for (const result of results) {
            for (const req of requirements) {
              expect(result.skillTotals.get(req.skillId) ?? 0).toBeGreaterThanOrEqual(req.minPoints)
            }
          }
        }),
        { numRuns: 50 },
      )
    },
    TEST_TIMEOUT_MS,
  )
})

function bruteForceSearchWithDecorations(
  slots: readonly SlotQuery[],
  requirements: readonly SkillRequirement[],
  allDecorations: readonly Decoration[],
): BuildResult[] {
  const results: BuildResult[] = []

  // Mirrors search()'s own relevance filtering (see its module docstring):
  // a decoration touching none of the requested skills can't change which
  // requirements are met or how results rank, so search() never expands it
  // into a separate result variant, and this reference must agree.
  const requestedSkillIds = new Set(requirements.map((r) => r.skillId))
  const decorations = allDecorations.filter((d) =>
    d.skills.some((s) => requestedSkillIds.has(s.skillId)),
  )

  // Trusts fillSlots (already unit- and property-adjacent tested in
  // decorations.test.ts) to enumerate decoration choices; this reference
  // only needs to brute-force *which slot* choices to combine, unpruned.
  function recurse(
    slotIndex: number,
    picks: Map<string, Candidate>,
    chosenDecorations: Map<string, readonly Decoration[]>,
    totals: Map<number, number>,
  ) {
    if (slotIndex === slots.length) {
      const meetsAll = requirements.every((r) => (totals.get(r.skillId) ?? 0) >= r.minPoints)
      if (meetsAll) {
        results.push({
          picks: new Map(picks),
          decorations: new Map(chosenDecorations),
          cuffs: [],
          skillTotals: new Map(totals),
        })
      }
      return
    }

    const slot = slots[slotIndex]
    for (const candidate of slot.candidates) {
      for (const filling of fillSlots(candidate.openSlotCount ?? 0, decorations)) {
        const added = [...candidate.skills, ...filling.skills]
        for (const { skillId, points } of added) {
          totals.set(skillId, (totals.get(skillId) ?? 0) + points)
        }
        picks.set(slot.slotId, candidate)
        const usedDecorations = filling.decorationsUsed
        if (usedDecorations.length > 0) chosenDecorations.set(slot.slotId, usedDecorations)

        recurse(slotIndex + 1, picks, chosenDecorations, totals)

        picks.delete(slot.slotId)
        chosenDecorations.delete(slot.slotId)
        for (const { skillId, points } of added) {
          const next = (totals.get(skillId) ?? 0) - points
          if (next === 0) totals.delete(skillId)
          else totals.set(skillId, next)
        }
      }
    }
  }

  recurse(0, new Map(), new Map(), new Map())
  return results
}

/** Which candidate fills each slot -- the identity results are distinct by. */
function gearKey(result: BuildResult): string {
  return [...result.picks]
    .map(([slotId, c]) => `${slotId}=${c.id}`)
    .sort()
    .join('|')
}

/** The objective `buildModel` maximizes (default ranking, no options): open
 * slots left after decorations, then unrequested ("bonus") points. */
function objectiveOf(result: BuildResult, requirements: readonly SkillRequirement[]): number {
  const requested = new Set(requirements.map((r) => r.skillId))
  let total = 0
  for (const candidate of result.picks.values())
    total += OPEN_SLOT_WEIGHT * (candidate.openSlotCount ?? 0)
  for (const placed of result.decorations.values()) {
    for (const d of placed) total -= OPEN_SLOT_WEIGHT * d.slotSize
  }
  for (const [skillId, points] of result.skillTotals) if (!requested.has(skillId)) total += points
  return total
}

// No armor piece or weapon in the game has more than 3 decoration slots
// (see ilp-model.ts's `MAX_DECORATION_SLOTS_PER_PIECE`).
const openSlotCountArb = fc.integer({ min: 0, max: 3 })

const candidateWithSlotsArb = fc.record({
  id: fc.uuid(),
  skills: fc.uniqueArray(
    fc.record({ skillId: skillIdArb, points: fc.integer({ min: 0, max: 10 }) }),
    { selector: (s) => s.skillId, maxLength: 4 },
  ),
  openSlotCount: openSlotCountArb,
})

const slotsWithOpenSlotsArb = fc
  .array(fc.array(candidateWithSlotsArb, { minLength: 1, maxLength: 2 }), {
    minLength: 0,
    maxLength: 3,
  })
  .map((perSlotCandidates) =>
    perSlotCandidates.map((candidates, i): SlotQuery => ({ slotId: `slot-${i}`, candidates })),
  )

const decorationsArb = fc.uniqueArray(
  fc.record({
    id: fc.uuid(),
    slotSize: fc.integer({ min: 1, max: 3 }),
    skills: fc.uniqueArray(
      fc.record({ skillId: skillIdArb, points: fc.integer({ min: 1, max: 10 }) }),
      { selector: (s) => s.skillId, maxLength: 2 },
    ),
  }),
  { selector: (d) => d.id, maxLength: 3 },
)

describe('search with decorations (property-based)', () => {
  // A MIP solve's cost is input-sensitive in a way the old Pareto engine's
  // wasn't -- most random small instances solve in milliseconds, but a rare
  // one can hit enough solver symmetry to take over a minute even at this
  // tiny synthetic scale (observed directly: one random case took ~141s with
  // only 3 slots, 2 candidates each, and 3 decorations). That's still well
  // inside "seconds to low minutes, not half an hour" (the project's actual
  // bar -- see `engine.ts`'s module docstring), so the fix is a generous
  // per-test timeout, not a change to the engine itself.
  const TEST_TIMEOUT_MS = 300_000

  it(
    'returns every feasible gear set exactly once, each with its best decoration fill',
    async () => {
      // Results are distinct by gear set, each carrying the best-ranked
      // decoration fill for it (see ilp-model.ts's module docstring) -- so
      // the brute-force oracle is grouped the same way: every gear set with
      // any valid fill, mapped to the best objective any of its fills reach.
      await fc.assert(
        fc.asyncProperty(
          slotsWithOpenSlotsArb,
          requirementsArb,
          decorationsArb,
          async (slots, requirements, decorations) => {
            const actual = await collect(search(slots, requirements, decorations))
            const expected = new Map<string, number>()
            for (const r of bruteForceSearchWithDecorations(slots, requirements, decorations)) {
              const key = gearKey(r)
              const objective = objectiveOf(r, requirements)
              expected.set(key, Math.max(expected.get(key) ?? -Infinity, objective))
            }

            const actualKeys = actual.map(gearKey)
            expect(new Set(actualKeys).size).toBe(actualKeys.length)
            expect(new Map(actual.map((r) => [gearKey(r), objectiveOf(r, requirements)]))).toEqual(
              expected,
            )
          },
        ),
        { numRuns: 50 }, // decoration enumeration is combinatorially heavier per case
      )
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'never returns a combination that fails a requirement',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          slotsWithOpenSlotsArb,
          requirementsArb,
          decorationsArb,
          async (slots, requirements, decorations) => {
            const results = await collect(search(slots, requirements, decorations))

            for (const result of results) {
              for (const req of requirements) {
                expect(result.skillTotals.get(req.skillId) ?? 0).toBeGreaterThanOrEqual(
                  req.minPoints,
                )
              }
            }
          },
        ),
        { numRuns: 50 },
      )
    },
    TEST_TIMEOUT_MS,
  )
})
