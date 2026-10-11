/**
 * Covers `expandSlot`/`DecorationFillingCache`'s own decoration-filling
 * frontier, which until now was only exercised indirectly through
 * `pareto.test.ts` (always with zero decorations) and the full-engine
 * property tests in `engine.property.test.ts`. Added alongside fixes for two
 * compounding real-dataset bugs that together hung, then out-of-memory
 * crashed, a real multi-skill search:
 *
 * 1. `computeDecorationFillingFrontier` used to fully drain `fillSlots`
 *    (every raw multiset of relevant decorations fitting a capacity) before
 *    reducing to a Pareto frontier. Real MHF decoration data skews heavily
 *    toward slotSize-1 decorations, and a query touching a common skill
 *    (e.g. "Attack", which many weapon-event decorations carry as a
 *    secondary stat) can make 150+ decorations "relevant" -- at the very
 *    common capacity-3 slot count, that raw enumeration ran to roughly
 *    700,000 multisets *before* any pruning. See `fillSlots`'s own
 *    docstring -- it's kept as the deliberately naive, obviously-correct
 *    reference the tests below check the real (now incremental)
 *    implementation against.
 * 2. Even after (1), `expandSlot` itself built the full (candidate,
 *    decoration filling) cross product before pruning -- fine at a few
 *    thousand options, but real equipment slots run to ~13,000 candidates
 *    each, which multiplied out to 1.6 million raw options on a single real
 *    slot. Fixed by pruning via dominance as options are generated, fusing
 *    what `pareto.ts`'s `reduceSlotOptions` used to do entirely after the
 *    fact (see `expandSlot`'s docstring).
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { dominates } from './dominance'
import { fillSlots } from './decorations'
import { DecorationFillingCache, expandSlot, mergeSkills } from './expand'
import type { Candidate, Decoration, SkillRequirement, SlotQuery } from './types'

function deco(id: string, slotSize: number, skills: Record<number, number>): Decoration {
  return {
    id,
    slotSize,
    skills: Object.entries(skills).map(([skillId, points]) => ({
      skillId: Number(skillId),
      points,
    })),
  }
}

/** A single candidate with no skills of its own and `openSlotCount` open
 * slots, so `expandSlot`'s only contribution to each option's skills is
 * whatever decorations it placed -- isolates the decoration-filling frontier
 * from everything else `expandSlot` does. */
function emptySlot(openSlotCount: number): SlotQuery {
  return { slotId: 'slot', candidates: [{ id: 'bare', skills: [], openSlotCount }] }
}

function vectorsOf(
  options: readonly { readonly skills: readonly { skillId: number; points: number }[] }[],
  requirements: readonly SkillRequirement[],
): number[][] {
  return options.map((option) =>
    requirements.map((r) => option.skills.find((s) => s.skillId === r.skillId)?.points ?? 0),
  )
}

/** The deliberately naive reference: every raw filling from `fillSlots`,
 * reduced to its non-dominated vectors by brute force. */
function bruteForceFrontierVectors(
  capacity: number,
  decorations: readonly Decoration[],
  requirements: readonly SkillRequirement[],
): number[][] {
  const vectors = fillSlots(capacity, decorations).map((filling) =>
    requirements.map((r) => filling.skills.find((s) => s.skillId === r.skillId)?.points ?? 0),
  )
  return vectors.filter((v, i) => !vectors.some((other, j) => j !== i && dominates(other, v)))
}

function sortVectors(vectors: number[][]): number[][] {
  return [...vectors].sort((a, b) => a.join(',').localeCompare(b.join(',')))
}

describe('expandSlot decoration filling', () => {
  it('offers a single-decoration filling for each decoration that fits', () => {
    const attack = deco('Attack Jewel', 1, { 1: 3 })
    const defense = deco('Defense Jewel', 1, { 2: 5 })
    const requirements: SkillRequirement[] = [
      { skillId: 1, minPoints: 0 },
      { skillId: 2, minPoints: 0 },
    ]

    const expanded = expandSlot(emptySlot(1), [attack, defense], requirements)

    // The empty filling [0, 0] is correctly absent: it's dominated by both
    // single-decoration options (at least as good on every dimension, and
    // not identical), so it can never be part of an optimal build.
    const vectors = sortVectors(vectorsOf(expanded.options, requirements))
    expect(vectors).toEqual(
      sortVectors([
        [3, 0],
        [0, 5],
      ]),
    )
  })

  it('drops a filling dominated by another on every requested skill', () => {
    const weak = deco('Weak Jewel', 1, { 1: 2 })
    const strong = deco('Strong Jewel', 1, { 1: 5 })
    const requirements: SkillRequirement[] = [{ skillId: 1, minPoints: 0 }]

    const expanded = expandSlot(emptySlot(1), [weak, strong], requirements)

    const vectors = vectorsOf(expanded.options, requirements)
    expect(vectors).not.toContainEqual([2])
    expect(vectors).toContainEqual([5])
  })

  it('shares one frontier across every candidate and slot with the same capacity via the cache', () => {
    const attack = deco('Attack Jewel', 1, { 1: 3 })
    const requirements: SkillRequirement[] = [{ skillId: 1, minPoints: 0 }]
    const cache = new DecorationFillingCache()

    const first = cache.get(1, [attack], requirements)
    const second = cache.get(1, [attack], requirements)

    expect(second).toBe(first) // same array instance, not recomputed
  })

  const skillIdArb = fc.integer({ min: 1, max: 4 })
  const decorationsArb = fc.uniqueArray(
    fc.record({
      id: fc.uuid(),
      slotSize: fc.integer({ min: 1, max: 3 }),
      skills: fc.uniqueArray(
        fc.record({ skillId: skillIdArb, points: fc.integer({ min: 1, max: 10 }) }),
        { selector: (s) => s.skillId, maxLength: 2 },
      ),
    }),
    { selector: (d) => d.id, maxLength: 5 },
  )
  // At least one requirement, matching real usage (the UI never lets a
  // search run with zero skills picked): with zero requested dimensions,
  // dominance is vacuously never true for *any* pair of vectors (both are
  // always `[]`), so nothing ever gets pruned and even irrelevant
  // decorations produce "distinct" tied entries -- a degenerate case the
  // skip-irrelevant-decorations optimization below deliberately doesn't
  // preserve, since it can never arise from a real search.
  const requirementsArb = fc.uniqueArray(
    fc.record({ skillId: skillIdArb, minPoints: fc.integer({ min: 0, max: 15 }) }),
    { selector: (r) => r.skillId, minLength: 1, maxLength: 4 },
  )
  const capacityArb = fc.integer({ min: 0, max: 4 })

  it('matches the brute-force (fillSlots + prune) reference frontier', () => {
    fc.assert(
      fc.property(
        capacityArb,
        decorationsArb,
        requirementsArb,
        (capacity, decorations, requirements) => {
          // Mirrors the real contract: `search()` always runs decorations
          // through `filterRelevantDecorations` before `expandSlot` ever sees
          // them (see expand.ts's own docstring on why). A decoration
          // irrelevant to every requested dimension is a degenerate case
          // `expandSlot` isn't meant to handle on its own -- with it left in,
          // "ties are preserved" would require treating placing a
          // contributes-nothing decoration as a distinct result from not
          // placing it, which is exactly the blow-up `filterRelevantDecorations`
          // exists to avoid one layer up.
          const requestedSkillIds = new Set(requirements.map((r) => r.skillId))
          const relevant = decorations.filter((d) =>
            d.skills.some((s) => requestedSkillIds.has(s.skillId)),
          )

          const expanded = expandSlot(emptySlot(capacity), relevant, requirements)

          const actual = sortVectors(vectorsOf(expanded.options, requirements))
          const expected = sortVectors(bruteForceFrontierVectors(capacity, relevant, requirements))

          expect(actual).toEqual(expected)
        },
      ),
      { numRuns: 200 },
    )
  })

  it('stays fast when many slot-size-1 decorations are relevant at a common capacity', () => {
    // Mirrors the real dataset: a query touching a common skill can make
    // 150+ mostly slot-size-1 decorations "relevant", and capacity 3 is the
    // single most common open-slot count across real equipment. The old
    // brute-force-then-prune implementation enumerated ~700,000 raw
    // multisets here before pruning a single one.
    const decorations: Decoration[] = Array.from({ length: 150 }, (_, i) =>
      deco(`deco-${i}`, 1, { [i % 4]: 1 + (i % 10) }),
    )
    const requirements: SkillRequirement[] = [0, 1, 2, 3].map((skillId) => ({
      skillId,
      minPoints: 0,
    }))

    const start = performance.now()
    const expanded = expandSlot(emptySlot(3), decorations, requirements)
    const elapsedMs = performance.now() - start

    expect(expanded.options.length).toBeGreaterThan(0)
    expect(elapsedMs).toBeLessThan(1000)
  })
})

describe('expandSlot candidate pruning', () => {
  it('drops a candidate-and-filling combination dominated by another, across different candidates', () => {
    const requirements: SkillRequirement[] = [{ skillId: 1, minPoints: 0 }]
    const slot: SlotQuery = {
      slotId: 'slot',
      candidates: [
        { id: 'strong', skills: [{ skillId: 1, points: 5 }] },
        { id: 'weak', skills: [{ skillId: 1, points: 2 }] },
      ],
    }

    const expanded = expandSlot(slot, [], requirements)

    const vectors = vectorsOf(expanded.options, requirements)
    expect(vectors).toEqual([[5]])
  })

  it('preserves ties: two different candidates reaching the same requested vector both survive', () => {
    const requirements: SkillRequirement[] = [{ skillId: 1, minPoints: 0 }]
    const slot: SlotQuery = {
      slotId: 'slot',
      candidates: [
        { id: 'plain', skills: [{ skillId: 1, points: 5 }] },
        {
          id: 'fancy',
          skills: [
            { skillId: 1, points: 5 },
            { skillId: 99, points: 10 },
          ],
        },
      ],
    }

    const expanded = expandSlot(slot, [], requirements)

    expect(expanded.options.map((o) => o.candidate.id).sort()).toEqual(['fancy', 'plain'])
  })

  it('avoids materializing the full candidates x decoration-fillings cross product', () => {
    // Mirrors the real dataset's shape (~13,000 candidates per slot, a
    // sizeable decoration frontier once several skills are requested at
    // once): the old implementation built every (candidate, filling) pair
    // before pruning, which ran to 1.6 million raw options on a single real
    // slot and exhausted memory. Each candidate here has a strictly
    // increasing, *unique* point value on one of 3 axes -- so within an
    // axis, every candidate strictly dominates every earlier one on that
    // same axis (once combined with the same decoration filling), and the
    // frontier never accumulates more than "the best so far per axis per
    // filling" instead of growing with the candidate count. (Giving many
    // candidates the exact *same* vector instead would be a different,
    // deliberate stress case -- see the module docstring on ties -- that
    // pathologically inflates the frontier with never-pruned duplicates
    // instead of exercising this fix; that's not what's being tested here.)
    const requirements: SkillRequirement[] = [1, 2, 3].map((skillId) => ({ skillId, minPoints: 0 }))
    // Distinct point values per axis (not repeated across several
    // decorations) -- several decorations tying at the exact same point
    // value is itself the "many ties" case covered by the next test, and
    // compounds combinatorially one layer earlier, inside the decoration
    // frontier itself. Keeping values unique here isolates what this test is
    // actually about: candidate-level pruning, not decoration-level ties.
    const decorations: Decoration[] = Array.from({ length: 60 }, (_, i) =>
      deco(`deco-${i}`, 1, { [1 + (i % 3)]: 1 + i }),
    )
    const candidates: Candidate[] = Array.from({ length: 8000 }, (_, i) => ({
      id: `c-${i}`,
      skills: [{ skillId: 1 + (i % 3), points: i }],
      openSlotCount: 3,
    }))
    const slot: SlotQuery = { slotId: 'slot', candidates }

    const start = performance.now()
    const expanded = expandSlot(slot, decorations, requirements)
    const elapsedMs = performance.now() - start

    expect(elapsedMs).toBeLessThan(2000)
    expect(expanded.options.length).toBeLessThan(candidates.length)
  })

  it('stays fast even when many candidates tie on the exact same requested vector', () => {
    // The flip side of the test above: real equipment plausibly includes
    // many pieces that are cosmetically distinct but identical on every
    // *requested* skill (e.g. color variants). Ties are never deduplicated
    // by design (see the module docstring, and pareto.test.ts's "preserves
    // ties" case) -- which is correct, but means the frontier can legitimately
    // grow proportional to how many candidates tie, not just to how many
    // truly distinct vectors exist. This pins a sane budget for that case
    // rather than assuming it away.
    const requirements: SkillRequirement[] = [{ skillId: 1, minPoints: 0 }]
    const candidates: Candidate[] = Array.from({ length: 4000 }, (_, i) => ({
      id: `c-${i}`,
      skills: [{ skillId: 1, points: 5 }], // every candidate ties at vector [5]
    }))
    const slot: SlotQuery = { slotId: 'slot', candidates }

    const start = performance.now()
    const expanded = expandSlot(slot, [], requirements)
    const elapsedMs = performance.now() - start

    expect(expanded.options).toHaveLength(candidates.length) // all 4000 are genuine ties, none dropped
    expect(elapsedMs).toBeLessThan(3000)
  })
})

describe('mergeSkills', () => {
  it('sums points for a skill present on both sides', () => {
    expect(mergeSkills([{ skillId: 1, points: 3 }], [{ skillId: 1, points: 4 }])).toEqual([
      { skillId: 1, points: 7 },
    ])
  })

  it('keeps skills unique to either side', () => {
    const merged = mergeSkills([{ skillId: 1, points: 3 }], [{ skillId: 2, points: 4 }])
    expect(merged.sort((a, b) => a.skillId - b.skillId)).toEqual([
      { skillId: 1, points: 3 },
      { skillId: 2, points: 4 },
    ])
  })

  it('returns an equivalent (copied) array when either side is empty', () => {
    expect(mergeSkills([], [{ skillId: 1, points: 3 }])).toEqual([{ skillId: 1, points: 3 }])
    expect(mergeSkills([{ skillId: 1, points: 3 }], [])).toEqual([{ skillId: 1, points: 3 }])
    expect(mergeSkills([], [])).toEqual([])
  })

  it('never mutates its inputs', () => {
    const a = [{ skillId: 1, points: 3 }]
    const b = [{ skillId: 1, points: 4 }]
    mergeSkills(a, b)
    expect(a).toEqual([{ skillId: 1, points: 3 }])
    expect(b).toEqual([{ skillId: 1, points: 4 }])
  })
})
