/**
 * `candidate-pruning.ts` is only sound if it never changes which builds a
 * search's top `maxResults` can reach. The property below checks exactly
 * that against the unpruned engine on small random instances: the objective
 * values of the first `k` results must be identical with and without
 * pruning. Values rather than exact picks, because a tie at the `k`-th rank
 * may legitimately resolve to a different, equally-ranked build.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { pruneDominatedCandidates, pruneDominatedDecorations } from './candidate-pruning'
import { search } from './engine'
import { GEAR_LEVEL_ZP_CATEGORIES } from './gear-categories'
import { getHighs } from './highs-runtime'
import {
  MAX_OPTIONAL_SKILL_PRIORITY_TIERS,
  OPEN_SLOT_WEIGHT,
  OPTIONAL_SKILL_BASE_WEIGHT,
  OPTIONAL_SKILL_TIER_GROWTH,
  PREFERRED_ITEM_WEIGHT,
  buildModel,
  exclusionRow,
} from './ilp-model'
import { collect } from './test-helpers'
import type {
  BuildResult,
  Candidate,
  Decoration,
  SearchOptions,
  SkillContribution,
  SkillRequirement,
  SlotQuery,
} from './types'

const SKILL_IDS = [1, 2, 3, 4] as const

/** The objective `ilp-model.ts`'s `buildModel` maximizes, recomputed from a
 * finished build (default ranking mode only) -- independent of the model's
 * own column layout, so it can't share a bug with it. */
function objectiveOf(
  result: BuildResult,
  requirements: readonly SkillRequirement[],
  options: SearchOptions,
): number {
  const optional = options.optionalSkillRequirements ?? []
  const asked = new Set([...requirements, ...optional].map((r) => r.skillId))
  const bonus = (skills: readonly SkillContribution[]) =>
    skills.reduce((sum, s) => sum + (asked.has(s.skillId) ? 0 : s.points), 0)

  let total = 0
  for (const candidate of result.picks.values()) {
    total += OPEN_SLOT_WEIGHT * (candidate.openSlotCount ?? 0) + bonus(candidate.skills)
    if (options.preferredCandidateIds?.has(candidate.id)) total += PREFERRED_ITEM_WEIGHT
  }
  for (const placed of result.decorations.values()) {
    for (const d of placed) total += -OPEN_SLOT_WEIGHT * d.slotSize + bonus(d.skills)
  }
  for (const { category, count } of options.preferredCategoryCounts ?? []) {
    const used = [...result.picks.values()].filter((c) => c.category === category).length
    total += PREFERRED_ITEM_WEIGHT * Math.min(count, used)
  }
  const metPriorities = new Set(
    optional
      .filter((r) => (result.skillTotals.get(r.skillId) ?? 0) >= r.minPoints)
      .map((r) => r.priority),
  )
  for (const priority of metPriorities) {
    total +=
      OPTIONAL_SKILL_BASE_WEIGHT *
      OPTIONAL_SKILL_TIER_GROWTH ** (MAX_OPTIONAL_SKILL_PRIORITY_TIERS - priority)
  }
  return total
}

async function topObjectives(
  slots: readonly SlotQuery[],
  requirements: readonly SkillRequirement[],
  decorations: readonly Decoration[],
  options: SearchOptions,
  k: number,
): Promise<number[]> {
  const results: BuildResult[] = []
  for await (const result of search(slots, requirements, decorations, options)) {
    results.push(result)
    if (results.length >= k) break
  }
  return results.map((r) => objectiveOf(r, requirements, options))
}

// Small point ranges and a lopsided category split make dominated candidates
// (and categories worth protecting) common, so a dimension the dominance rule
// forgets shows up as a counterexample rather than slipping through.
const skillsArb = fc.uniqueArray(
  fc.record({ skillId: fc.constantFrom(...SKILL_IDS), points: fc.integer({ min: -2, max: 4 }) }),
  { selector: (s) => s.skillId, maxLength: 3 },
)

const candidateArb = fc.record({
  skills: skillsArb,
  openSlotCount: fc.integer({ min: 0, max: 3 }),
  category: fc.constantFrom('a', 'b', 'b', 'b'),
  fire: fc.integer({ min: -3, max: 3 }),
})

const slotsArb = fc
  .array(fc.array(candidateArb, { minLength: 1, maxLength: 8 }), { minLength: 1, maxLength: 3 })
  .map((perSlot) =>
    perSlot.map((candidates, s): SlotQuery => ({
      slotId: `slot-${s}`,
      candidates: candidates.map((c, i): Candidate => ({
        id: `${s}-${i}`,
        skills: c.skills,
        openSlotCount: c.openSlotCount,
        category: c.category,
        resistances: { fire: c.fire, water: 0, thunder: 0, ice: 0, dragon: 0 },
      })),
    })),
  )

const decorationsArb = fc
  .array(
    fc.record({
      slotSize: fc.integer({ min: 1, max: 2 }),
      skills: fc.uniqueArray(
        fc.record({
          skillId: fc.constantFrom(...SKILL_IDS),
          points: fc.integer({ min: -2, max: 4 }),
        }),
        { selector: (s) => s.skillId, minLength: 1, maxLength: 2 },
      ),
    }),
    { maxLength: 3 },
  )
  .map((list) => list.map((d, i): Decoration => ({ id: `deco-${i}`, ...d })))

const requirementsArb = fc.uniqueArray(
  fc.record({ skillId: fc.constantFrom(...SKILL_IDS), minPoints: fc.integer({ min: 0, max: 10 }) }),
  { selector: (r) => r.skillId, maxLength: 2 },
)

/** Every option the dominance rule has to account for, each independently
 * present or absent. Skill ids are drawn from the same small pool as the
 * requirements, so they collide with them as often as real queries might. */
const optionsArb = fc
  .record(
    {
      preferredCandidateIds: fc
        .uniqueArray(fc.constantFrom('0-0', '0-1', '1-0', '1-2', '2-1'), { maxLength: 2 })
        .map((ids) => new Set(ids)),
      preferredCategoryCounts: fc.uniqueArray(
        fc.record({ category: fc.constantFrom('a', 'b'), count: fc.integer({ min: 1, max: 2 }) }),
        { selector: (p) => p.category, maxLength: 2 },
      ),
      excludedActiveSkillIds: fc.uniqueArray(fc.constantFrom(...SKILL_IDS), { maxLength: 1 }),
      resistanceFloors: fc
        .integer({ min: -4, max: 2 })
        .map((minTotal) => [{ element: 'fire' as const, minTotal }]),
      optionalSkillRequirements: fc.uniqueArray(
        fc.record({
          skillId: fc.constantFrom(...SKILL_IDS),
          minPoints: fc.integer({ min: 1, max: 10 }),
          priority: fc.integer({ min: 1, max: 3 }),
        }),
        { selector: (r) => r.skillId, maxLength: 2 },
      ),
    },
    { requiredKeys: [] },
  )
  .map((options): SearchOptions => ({
    ...options,
    // Excluded-active rows read tier thresholds from here.
    skillTiers: SKILL_IDS.map((skillId) => ({ skillId, tierThresholds: [-6, 6] })),
  }))

describe('pruneDominatedCandidates', () => {
  it('drops a candidate only once enough others dominate it', () => {
    const weak: Candidate = { id: 'weak', skills: [{ skillId: 1, points: 2 }], openSlotCount: 1 }
    const strong: Candidate = {
      id: 'strong',
      skills: [{ skillId: 1, points: 5 }],
      openSlotCount: 2,
    }
    const alsoStrong: Candidate = {
      id: 'also',
      skills: [{ skillId: 1, points: 3 }],
      openSlotCount: 1,
    }
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [weak, strong, alsoStrong] }]
    const requirements = [{ skillId: 1, minPoints: 1 }]

    const ids = (keep: number) =>
      pruneDominatedCandidates(slots, requirements, {}, keep)[0].candidates.map((c) => c.id)

    expect(ids(1)).toEqual(['strong'])
    expect(ids(2)).toEqual(['strong', 'also'])
    expect(ids(3)).toEqual(['weak', 'strong', 'also'])
  })

  it('never treats different points in an excluded-active skill as dominated', () => {
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [
          { id: 'clean', skills: [], openSlotCount: 0 },
          { id: 'better', skills: [{ skillId: 2, points: 5 }], openSlotCount: 3 },
        ],
      },
    ]
    const kept = pruneDominatedCandidates(slots, [], { excludedActiveSkillIds: [2] }, 1)
    expect(kept[0].candidates.map((c) => c.id)).toEqual(['clean', 'better'])
  })

  it('never drops a piece in a preferred gear-level tier for one outside it', () => {
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [
          { id: 'zp', skills: [], openSlotCount: 0, category: GEAR_LEVEL_ZP_CATEGORIES[0] },
          { id: 'roomy', skills: [], openSlotCount: 3, category: 'other' },
        ],
      },
    ]
    const options = { preferredCategoryCounts: [{ category: 'level:zp', count: 1 }] }
    const kept = pruneDominatedCandidates(slots, [], options, 1)
    expect(kept[0].candidates.map((c) => c.id)).toEqual(['zp', 'roomy'])
  })

  it('leaves preferExactMatches searches with tier data unpruned', () => {
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [
          { id: 'weak', skills: [], openSlotCount: 0 },
          { id: 'strong', skills: [], openSlotCount: 3 },
        ],
      },
    ]
    const options = { preferExactMatches: true, skillTiers: [] }
    expect(pruneDominatedCandidates(slots, [], options, 1)).toBe(slots)
  })

  it('keeps the top-k objective values identical to the unpruned search', async () => {
    await fc.assert(
      fc.asyncProperty(
        slotsArb,
        requirementsArb,
        decorationsArb,
        optionsArb,
        fc.integer({ min: 1, max: 3 }),
        async (slots, requirements, decorations, options, k) => {
          const unpruned = await topObjectives(slots, requirements, decorations, options, k)
          const pruned = await topObjectives(
            slots,
            requirements,
            decorations,
            { ...options, maxResults: k },
            k,
          )
          expect(pruned).toEqual(unpruned)
        },
      ),
      { numRuns: 250 },
    )
  }, 300_000)

  it('stops after maxResults results even when more exist', async () => {
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [1, 2, 3, 4].map((i) => ({ id: `h${i}`, skills: [], openSlotCount: i % 4 })),
      },
    ]
    expect(await collect(search(slots, [], [], {}))).toHaveLength(4)
    expect(await collect(search(slots, [], [], { maxResults: 2 }))).toHaveLength(2)
  })
})

/** The top-`k` optimal objective values straight from `buildModel`, with no
 * engine-level pruning in between -- so the property below can compare the
 * same model with and without `pruneDominatedDecorations` applied. */
async function topModelObjectives(
  slots: readonly SlotQuery[],
  requirements: readonly SkillRequirement[],
  decorations: readonly Decoration[],
  options: SearchOptions,
  k: number,
): Promise<number[]> {
  const highs = await getHighs()
  const { model, columns } = buildModel(highs, slots, decorations, requirements, options)
  const native = highs.createModel(model)
  native.options.set('mip_rel_gap', 0)
  native.options.set('mip_abs_gap', 0.99)
  const values: number[] = []
  try {
    for (let i = 0; i < k; i++) {
      if (native.run().modelStatus !== highs.constants.modelStatus.optimal) break
      values.push(Math.round(native.info.get('objective_function_value') as number))
      const cut = exclusionRow(highs, columns, native.getSolution().colValue)
      native.addRow(cut.lower, cut.upper, { indices: cut.indices, values: cut.values })
    }
  } finally {
    native.dispose()
  }
  return values
}

const manyDecorationsArb = fc
  .array(
    fc.record({
      slotSize: fc.integer({ min: 1, max: 3 }),
      skills: fc.uniqueArray(
        fc.record({
          skillId: fc.constantFrom(...SKILL_IDS),
          points: fc.integer({ min: -2, max: 4 }),
        }),
        { selector: (s) => s.skillId, minLength: 1, maxLength: 3 },
      ),
    }),
    { maxLength: 7 },
  )
  .map((list) => list.map((d, i): Decoration => ({ id: `deco-${i}`, ...d })))

describe('pruneDominatedDecorations', () => {
  it('drops a decoration that another no larger one beats on every scored skill', () => {
    const weak: Decoration = { id: 'weak', slotSize: 2, skills: [{ skillId: 1, points: 2 }] }
    const strong: Decoration = { id: 'strong', slotSize: 1, skills: [{ skillId: 1, points: 3 }] }
    const bigger: Decoration = { id: 'bigger', slotSize: 3, skills: [{ skillId: 1, points: 9 }] }
    const kept = pruneDominatedDecorations(
      [weak, strong, bigger],
      [{ skillId: 1, minPoints: 1 }],
      {},
    )
    expect(kept.map((d) => d.id)).toEqual(['strong', 'bigger'])
  })

  it('never drops a decoration for one with different excluded-active skill points', () => {
    // `clean` is the only decoration a build excluding skill 2 can use, even
    // though `boosted` beats it on the requested skill and on bonus points.
    const clean: Decoration = { id: 'clean', slotSize: 1, skills: [{ skillId: 1, points: 2 }] }
    const boosted: Decoration = {
      id: 'boosted',
      slotSize: 1,
      skills: [
        { skillId: 1, points: 3 },
        { skillId: 2, points: 3 },
      ],
    }
    const kept = pruneDominatedDecorations([clean, boosted], [{ skillId: 1, minPoints: 2 }], {
      excludedActiveSkillIds: [2],
    })
    expect(kept.map((d) => d.id)).toEqual(['clean', 'boosted'])
  })

  it('leaves preferExactMatches searches with tier data unpruned', () => {
    const decorations: Decoration[] = [
      { id: 'a', slotSize: 1, skills: [{ skillId: 1, points: 1 }] },
      { id: 'b', slotSize: 1, skills: [{ skillId: 1, points: 2 }] },
    ]
    const options = { preferExactMatches: true, skillTiers: [] }
    expect(pruneDominatedDecorations(decorations, [], options)).toBe(decorations)
  })

  it('keeps the top-k objective values identical to the unpruned model', async () => {
    await fc.assert(
      fc.asyncProperty(
        slotsArb,
        requirementsArb,
        manyDecorationsArb,
        optionsArb,
        fc.integer({ min: 1, max: 3 }),
        async (slots, requirements, decorations, options, k) => {
          const pruned = pruneDominatedDecorations(decorations, requirements, options)
          expect(await topModelObjectives(slots, requirements, pruned, options, k)).toEqual(
            await topModelObjectives(slots, requirements, decorations, options, k),
          )
        },
      ),
      { numRuns: 250 },
    )
  }, 300_000)
})
