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
import type { BuildResult, Candidate, Decoration, SkillRequirement, SlotQuery } from './types'

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
        const surplus = requirements.reduce(
          (sum, r) => sum + ((totals.get(r.skillId) ?? 0) - r.minPoints),
          0,
        )
        results.push({
          picks: new Map(picks),
          decorations: new Map(),
          skillTotals: totals,
          surplus,
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

function pickSignature(result: BuildResult, slots: readonly SlotQuery[]): string {
  return slots
    .map((s) => {
      const decoIds = (result.decorations.get(s.slotId) ?? [])
        .map((d) => d.id)
        .sort()
        .join(',')
      return `${s.slotId}=${result.picks.get(s.slotId)?.id}[${decoIds}]`
    })
    .join('|')
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
  it('returns exactly the same set of valid combinations as an unpruned brute-force search', () => {
    fc.assert(
      fc.property(slotsArb, requirementsArb, (slots, requirements) => {
        const actual = search(slots, requirements)
        const expected = bruteForceSearch(slots, requirements)

        const actualSignatures = new Set(actual.map((r) => pickSignature(r, slots)))
        const expectedSignatures = new Set(expected.map((r) => pickSignature(r, slots)))

        expect(actualSignatures).toEqual(expectedSignatures)
        expect(actual).toHaveLength(expected.length)
      }),
    )
  })

  it('never returns a combination that fails a requirement', () => {
    fc.assert(
      fc.property(slotsArb, requirementsArb, (slots, requirements) => {
        const results = search(slots, requirements)

        for (const result of results) {
          for (const req of requirements) {
            expect(result.skillTotals.get(req.skillId) ?? 0).toBeGreaterThanOrEqual(req.minPoints)
          }
        }
      }),
    )
  })

  it('always returns results sorted by descending surplus', () => {
    fc.assert(
      fc.property(slotsArb, requirementsArb, (slots, requirements) => {
        const results = search(slots, requirements)

        for (let i = 1; i < results.length; i++) {
          expect(results[i - 1].surplus).toBeGreaterThanOrEqual(results[i].surplus)
        }
      }),
    )
  })
})

function bruteForceSearchWithDecorations(
  slots: readonly SlotQuery[],
  requirements: readonly SkillRequirement[],
  decorations: readonly Decoration[],
): BuildResult[] {
  const results: BuildResult[] = []

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
        const surplus = requirements.reduce(
          (sum, r) => sum + ((totals.get(r.skillId) ?? 0) - r.minPoints),
          0,
        )
        results.push({
          picks: new Map(picks),
          decorations: new Map(chosenDecorations),
          skillTotals: new Map(totals),
          surplus,
        })
      }
      return
    }

    const slot = slots[slotIndex]
    for (const candidate of slot.candidates) {
      for (const filling of fillSlots(candidate.openSlots ?? [], decorations)) {
        const added = [...candidate.skills, ...filling.skills]
        for (const { skillId, points } of added) {
          totals.set(skillId, (totals.get(skillId) ?? 0) + points)
        }
        picks.set(slot.slotId, candidate)
        const usedDecorations = filling.placements.map((p) => p.decoration)
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

const openSlotsArb = fc.array(fc.integer({ min: 1, max: 3 }), { maxLength: 2 })

const candidateWithSlotsArb = fc.record({
  id: fc.uuid(),
  skills: fc.uniqueArray(
    fc.record({ skillId: skillIdArb, points: fc.integer({ min: 0, max: 10 }) }),
    { selector: (s) => s.skillId, maxLength: 4 },
  ),
  openSlots: openSlotsArb,
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
  it('matches an unpruned brute-force search that also enumerates decoration fillings', () => {
    fc.assert(
      fc.property(
        slotsWithOpenSlotsArb,
        requirementsArb,
        decorationsArb,
        (slots, requirements, decorations) => {
          const actual = search(slots, requirements, decorations)
          const expected = bruteForceSearchWithDecorations(slots, requirements, decorations)

          const actualSignatures = new Set(actual.map((r) => pickSignature(r, slots)))
          const expectedSignatures = new Set(expected.map((r) => pickSignature(r, slots)))

          expect(actualSignatures).toEqual(expectedSignatures)
        },
      ),
      { numRuns: 50 }, // decoration enumeration is combinatorially heavier per case
    )
  })

  it('never returns a combination that fails a requirement', () => {
    fc.assert(
      fc.property(
        slotsWithOpenSlotsArb,
        requirementsArb,
        decorationsArb,
        (slots, requirements, decorations) => {
          const results = search(slots, requirements, decorations)

          for (const result of results) {
            for (const req of requirements) {
              expect(result.skillTotals.get(req.skillId) ?? 0).toBeGreaterThanOrEqual(req.minPoints)
            }
          }
        },
      ),
      { numRuns: 50 },
    )
  })
})
