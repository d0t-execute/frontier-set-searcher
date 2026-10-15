import { beforeAll, describe, expect, it } from 'vitest'
import type { Highs, Model, SymbolDisposable } from 'highs'
import { getHighs } from './highs-runtime'
import {
  buildModel,
  decodeSolution,
  exclusionRow,
  isUsableResult,
  OPEN_SLOT_WEIGHT,
} from './ilp-model'
import type { Candidate, Decoration, SlotQuery } from './types'

function candidate(id: string, skills: Record<number, number>, openSlotCount = 0): Candidate {
  return {
    id,
    skills: Object.entries(skills).map(([skillId, points]) => ({
      skillId: Number(skillId),
      points,
    })),
    openSlotCount,
  }
}

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

// A Cuff is shaped identically to a Decoration (see types.ts's `Cuff` alias),
// so this just reuses `deco`'s shape under its own name for readability at
// cuff-specific call sites.
const cuff = deco

let highs: Highs

beforeAll(async () => {
  highs = await getHighs()
})

function solve(model: ReturnType<typeof buildModel>['model']): {
  modelStatus: number
  colValue: Float64Array
  native: SymbolDisposable<Model>
} {
  const native = highs.createModel(model)
  const result = native.run()
  const solution = native.getSolution()
  return { modelStatus: result.modelStatus, colValue: solution.colValue, native }
}

describe('buildModel', () => {
  it('sizes one row per slot cardinality, one per slot capacity, one per requirement', () => {
    const slots: SlotQuery[] = [
      { slotId: 'head', candidates: [candidate('Helm', { 1: 5 })] },
      { slotId: 'chest', candidates: [candidate('Mail', { 1: 5 })] },
    ]
    const { model } = buildModel(highs, slots, [], [{ skillId: 1, minPoints: 3 }])

    // 2 slots -> 2 cardinality rows + 2 capacity rows, plus 1 requirement row.
    expect(model.numRows).toBe(5)
  })

  it('creates one candidate column per (slot, candidate) pair and no decoration columns when nothing has open slots', () => {
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Helm A', { 1: 5 }), candidate('Helm B', { 1: 1 })],
      },
    ]
    const { model, columns } = buildModel(highs, slots, [], [{ skillId: 1, minPoints: 3 }])

    expect(columns).toHaveLength(2)
    expect(columns.every((c) => c.kind === 'candidate')).toBe(true)
    expect(model.numCols).toBe(2)
  })

  it('finds a feasible solution for a single candidate that satisfies the requirement alone', () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 5 })] }]
    const { model, columns } = buildModel(highs, slots, [], [{ skillId: 1, minPoints: 3 }])

    const { modelStatus, colValue, native } = solve(model)
    expect(modelStatus).toBe(highs.constants.modelStatus.optimal)
    const decoded = decodeSolution(columns, colValue)
    expect(decoded.picks.get('head')?.id).toBe('Helm')
    expect(decoded.skillTotals.get(1)).toBe(5)
    native.dispose()
  })

  it('reports infeasible when no combination can meet the requirement', () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 1 })] }]
    const { model } = buildModel(highs, slots, [], [{ skillId: 1, minPoints: 3 }])

    const { modelStatus, native } = solve(model)
    expect(modelStatus).toBe(highs.constants.modelStatus.infeasible)
    native.dispose()
  })

  it('requires exactly one candidate per slot (cardinality row)', () => {
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Helm A', { 1: 5 }), candidate('Helm B', { 1: 5 })],
      },
    ]
    const { model, columns } = buildModel(highs, slots, [], [{ skillId: 1, minPoints: 3 }])

    const { colValue, native } = solve(model)
    const chosen = columns.filter((_, j) => colValue[j] > 0.5)
    expect(chosen).toHaveLength(1)
    native.dispose()
  })

  it('combines candidates across multiple slots to meet the requirement', () => {
    const slots: SlotQuery[] = [
      { slotId: 'head', candidates: [candidate('Helm', { 1: 2 })] },
      { slotId: 'chest', candidates: [candidate('Mail', { 1: 2 })] },
    ]
    const { model, columns } = buildModel(highs, slots, [], [{ skillId: 1, minPoints: 3 }])

    const { modelStatus, colValue, native } = solve(model)
    expect(modelStatus).toBe(highs.constants.modelStatus.optimal)
    const decoded = decodeSolution(columns, colValue)
    expect(decoded.skillTotals.get(1)).toBe(4)
    native.dispose()
  })

  it('places a decoration in an open slot to meet a requirement the bare candidate cannot', () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Bare Helm', {}, 2)] }]
    const jewel = deco('Attack Jewel', 2, { 1: 5 })
    const { model, columns } = buildModel(highs, slots, [jewel], [{ skillId: 1, minPoints: 3 }])

    const { modelStatus, colValue, native } = solve(model)
    expect(modelStatus).toBe(highs.constants.modelStatus.optimal)
    const decoded = decodeSolution(columns, colValue)
    expect(decoded.decorations.get('head')).toEqual([jewel])
    expect(decoded.skillTotals.get(1)).toBe(5)
    native.dispose()
  })

  it("never lets placed decorations exceed the chosen candidate's open slot capacity", () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Bare Helm', {}, 2)] }]
    const jewel = deco('Jewel', 2, { 1: 5 })
    // Requirement forces 3 jewels' worth of points, but only 2 capacity exists.
    const { model } = buildModel(highs, slots, [jewel], [{ skillId: 1, minPoints: 15 }])

    const { modelStatus, native } = solve(model)
    expect(modelStatus).toBe(highs.constants.modelStatus.infeasible)
    native.dispose()
  })

  it('omits decoration columns entirely for a slot whose candidates all have zero open slots', () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Plain Helm', { 1: 5 })] }]
    const jewel = deco('Jewel', 1, { 1: 1 })
    const { columns } = buildModel(highs, slots, [jewel], [{ skillId: 1, minPoints: 3 }])

    expect(columns.some((c) => c.kind === 'decoration')).toBe(false)
  })

  it('one-hot encodes every physically-possible count for a decoration, including "place none"', () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Bare Helm', {}, 3)] }]
    const jewel = deco('Jewel', 1, { 1: 1 })
    const { columns } = buildModel(highs, slots, [jewel], [{ skillId: 1, minPoints: 1 }])

    const counts = columns.filter((c) => c.kind === 'decoration').map((c) => c.count)
    expect(counts.sort((a, b) => a - b)).toEqual([0, 1, 2, 3])
  })

  it('favors leaving decoration slots open over an unneeded decoration, among otherwise-tied options', () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 5 }, 2)] }]
    const jewel = deco('Irrelevant-ish Jewel', 2, { 1: 1 })
    const { model, columns } = buildModel(highs, slots, [jewel], [{ skillId: 1, minPoints: 3 }])

    const { colValue, native } = solve(model)
    const decoded = decodeSolution(columns, colValue)
    expect(decoded.decorations.get('head')).toBeUndefined()
    native.dispose()
  })

  it('weighs an open decoration slot as worth more than OPEN_SLOT_WEIGHT - 1 bonus points', () => {
    // Sanity-checks the objective weighting directly rather than just its
    // qualitative effect (the test above): no realistic bonus-point pile
    // should ever be able to outbid a single open slot.
    expect(OPEN_SLOT_WEIGHT).toBeGreaterThan(1000)
  })

  it('includes an unrequested bonus skill only as a tie-break, not a requirement', () => {
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Plain', { 1: 5 }), candidate('Bonus', { 1: 5, 2: 100 })],
      },
    ]
    const { model, columns } = buildModel(highs, slots, [], [{ skillId: 1, minPoints: 3 }])

    const { colValue, native } = solve(model)
    const decoded = decodeSolution(columns, colValue)
    // Both tie on the requested skill, so the solver should prefer the one
    // with more bonus points (Bonus) via the objective's tie-break term.
    expect(decoded.picks.get('head')?.id).toBe('Bonus')
    native.dispose()
  })

  it('prefers the candidate that avoids activating a bonus skill tier when preferExactMatches is set', () => {
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Plain', { 1: 5 }), candidate('Bonus', { 1: 5, 2: 100 })],
      },
    ]
    const { model, columns } = buildModel(highs, slots, [], [{ skillId: 1, minPoints: 3 }], {
      preferExactMatches: true,
      skillTiers: [{ skillId: 2, tierThresholds: [10] }],
    })

    const { colValue, native } = solve(model)
    const decoded = decodeSolution(columns, colValue)
    // Same tie on the requested skill as the test above, but 100 points of
    // skill 2 reaches its tier (threshold 10) -- Bonus is now penalized for
    // activating something nobody asked for, so Plain wins instead.
    expect(decoded.picks.get('head')?.id).toBe('Plain')
    native.dispose()
  })

  it("does not penalize bonus points that never reach any of the skill's own tiers", () => {
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Plain', { 1: 5 }), candidate('Bonus', { 1: 5, 2: 9 })],
      },
    ]
    const { model, columns } = buildModel(highs, slots, [], [{ skillId: 1, minPoints: 3 }], {
      preferExactMatches: true,
      skillTiers: [{ skillId: 2, tierThresholds: [10] }],
    })

    const { colValue, native } = solve(model)
    const decoded = decodeSolution(columns, colValue)
    // 9 points never reaches skill 2's threshold of 10 -- it does nothing in
    // the game, so preferExactMatches has no reason to avoid it. Both
    // candidates are genuinely tied here (the only difference is a
    // no-op), so either is an acceptable, correct answer.
    expect(['Plain', 'Bonus']).toContain(decoded.picks.get('head')?.id)
    native.dispose()
  })

  it('penalizes activating a negative (penalty) bonus tier, not just a positive one', () => {
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Plain', { 1: 5 }), candidate('Cursed', { 1: 5, 2: -10 })],
      },
    ]
    const { model, columns } = buildModel(highs, slots, [], [{ skillId: 1, minPoints: 3 }], {
      preferExactMatches: true,
      skillTiers: [{ skillId: 2, tierThresholds: [-10] }],
    })

    const { colValue, native } = solve(model)
    const decoded = decodeSolution(columns, colValue)
    // Cursed's -10 reaches skill 2's penalty tier -- a real, unwanted effect
    // on the build, so it must be penalized, not rewarded (a naive sign-flip
    // on the raw point total would do the opposite, since -10 negated looks
    // like a positive contribution).
    expect(decoded.picks.get('head')?.id).toBe('Plain')
    native.dispose()
  })

  it('treats bonus skills as neutral (no reward, no penalty) when preferExactMatches is set without skillTiers', () => {
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Plain', { 1: 5 }), candidate('Bonus', { 1: 5, 2: 100 })],
      },
    ]
    const { model, columns } = buildModel(highs, slots, [], [{ skillId: 1, minPoints: 3 }], {
      preferExactMatches: true,
    })

    const { colValue, native } = solve(model)
    const decoded = decodeSolution(columns, colValue)
    // With no tier data supplied, the engine can't tell whether skill 2's
    // points do anything -- "unknown" defaults to "assume harmless," so
    // both candidates are genuinely tied.
    expect(['Plain', 'Bonus']).toContain(decoded.picks.get('head')?.id)
    native.dispose()
  })

  it('still only enforces requirements as hard constraints when preferExactMatches is set', () => {
    // preferExactMatches changes ranking, never feasibility -- a candidate
    // that needs its own bonus points' worth of help is moot here since
    // bonus points by definition don't touch the requested skill, but this
    // confirms the requirement row itself is untouched by the option.
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 1 })] }]
    const { model } = buildModel(highs, slots, [], [{ skillId: 1, minPoints: 3 }], {
      preferExactMatches: true,
    })

    const { modelStatus, native } = solve(model)
    expect(modelStatus).toBe(highs.constants.modelStatus.infeasible)
    native.dispose()
  })

  it('skips tier machinery entirely for a skill no candidate could ever reach a threshold for', () => {
    // Every candidate tops out at 3 points -- skill 2's only tier is 10, so
    // it can never be activated in this query at all. Building the
    // accounting/indicator columns for it would be dead weight, not just
    // unnecessary caution.
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Plain', { 1: 5 }), candidate('Faint Bonus', { 1: 5, 2: 3 })],
      },
    ]
    const { columns } = buildModel(highs, slots, [], [{ skillId: 1, minPoints: 3 }], {
      preferExactMatches: true,
      skillTiers: [{ skillId: 2, tierThresholds: [10] }],
    })

    expect(columns.some((c) => c.kind === 'auxiliary')).toBe(false)
  })

  it('adds auxiliary accounting/indicator columns only when a bonus skill tier is actually reachable', () => {
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Plain', { 1: 5 }), candidate('Bonus', { 1: 5, 2: 100 })],
      },
    ]
    const { columns } = buildModel(highs, slots, [], [{ skillId: 1, minPoints: 3 }], {
      preferExactMatches: true,
      skillTiers: [{ skillId: 2, tierThresholds: [10] }],
    })

    expect(columns.some((c) => c.kind === 'auxiliary')).toBe(true)
  })
})

describe('buildModel with cuffs', () => {
  it('does not add any cuff columns or rows when no cuffs are given', () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 5 })] }]
    const { columns } = buildModel(highs, slots, [], [{ skillId: 1, minPoints: 3 }])

    expect(columns.some((c) => c.kind === 'cuff')).toBe(false)
  })

  it('leaves both cuff slots empty by default when nothing requires a cuff', () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 5 })] }]
    const cuffs = [cuff('Artisan PA1', 2, { 2: 10 })]
    const { model, columns } = buildModel(
      highs,
      slots,
      [],
      [{ skillId: 1, minPoints: 3 }],
      {},
      cuffs,
    )

    const { modelStatus, colValue, native } = solve(model)
    expect(modelStatus).toBe(highs.constants.modelStatus.optimal)
    const decoded = decodeSolution(columns, colValue)
    expect(decoded.cuffs).toEqual([])
    native.dispose()
  })

  it('equips a cuff and credits its skills when needed to satisfy a requirement', () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 3 })] }]
    const cuffs = [cuff('Sharpening PC1', 1, { 2: 10 })]
    const { model, columns } = buildModel(
      highs,
      slots,
      [],
      [
        { skillId: 1, minPoints: 3 },
        { skillId: 2, minPoints: 10 },
      ],
      {},
      cuffs,
    )

    const { modelStatus, colValue, native } = solve(model)
    expect(modelStatus).toBe(highs.constants.modelStatus.optimal)
    const decoded = decodeSolution(columns, colValue)
    expect(decoded.cuffs).toEqual([cuffs[0]])
    expect(decoded.skillTotals.get(2)).toBe(10)
    native.dispose()
  })

  it('allows the same cuff to fill both cuff slots at once', () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 3 })] }]
    const cuffs = [cuff('Sharpening PC1', 1, { 2: 5 })]
    const { model, columns } = buildModel(
      highs,
      slots,
      [],
      [
        { skillId: 1, minPoints: 3 },
        { skillId: 2, minPoints: 10 }, // only reachable with 2 copies (5 each)
      ],
      {},
      cuffs,
    )

    const { modelStatus, colValue, native } = solve(model)
    expect(modelStatus).toBe(highs.constants.modelStatus.optimal)
    const decoded = decodeSolution(columns, colValue)
    expect(decoded.cuffs).toEqual([cuffs[0], cuffs[0]])
    native.dispose()
  })

  it('rejects two cuffs whose combined slotSize exceeds the shared Poogie-slot budget', () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 3 })] }]
    // Each costs the full budget (2) on its own, so both at once (4) can't fit.
    const cuffs = [cuff('Skill Slots Up SZ', 2, { 2: 5 }), cuff('Guard Up SZ', 2, { 3: 5 })]
    const { model } = buildModel(
      highs,
      slots,
      [],
      [
        { skillId: 1, minPoints: 3 },
        { skillId: 2, minPoints: 5 },
        { skillId: 3, minPoints: 5 },
      ],
      {},
      cuffs,
    )

    const { modelStatus, native } = solve(model)
    expect(modelStatus).toBe(highs.constants.modelStatus.infeasible)
    native.dispose()
  })

  it('rejects three free cuffs even though their combined slotSize is 0', () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 3 })] }]
    // All free (slotSize 0, like a Hiden Cuff), but "at most 2 equipped" is a
    // separate rule from the slot-cost budget -- a third one must stay unmet.
    const cuffs = [
      cuff('SnS - Basic', 0, { 2: 5 }),
      cuff('SnS - Issen', 0, { 3: 5 }),
      cuff('SnS - Rush', 0, { 4: 5 }),
    ]
    const { model } = buildModel(
      highs,
      slots,
      [],
      [
        { skillId: 1, minPoints: 3 },
        { skillId: 2, minPoints: 5 },
        { skillId: 3, minPoints: 5 },
        { skillId: 4, minPoints: 5 },
      ],
      {},
      cuffs,
    )

    const { modelStatus, native } = solve(model)
    expect(modelStatus).toBe(highs.constants.modelStatus.infeasible)
    native.dispose()
  })

  it('allows one 2-cost cuff plus one free cuff, since only the budget is shared, not the item slot', () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 3 })] }]
    const cuffs = [cuff('Skill Slots Up SZ', 2, { 2: 5 }), cuff('SnS - Basic', 0, { 3: 5 })]
    const { model, columns } = buildModel(
      highs,
      slots,
      [],
      [
        { skillId: 1, minPoints: 3 },
        { skillId: 2, minPoints: 5 },
        { skillId: 3, minPoints: 5 },
      ],
      {},
      cuffs,
    )

    const { modelStatus, colValue, native } = solve(model)
    expect(modelStatus).toBe(highs.constants.modelStatus.optimal)
    const decoded = decodeSolution(columns, colValue)
    expect(new Set(decoded.cuffs.map((c) => c.id))).toEqual(
      new Set(['Skill Slots Up SZ', 'SnS - Basic']),
    )
    native.dispose()
  })
})

describe('buildModel with options.pinnedCuffs', () => {
  it("credits a pinned cuff's skills toward a requirement without any cuff column existing", () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 3 })] }]
    const pinnedCuffs = [cuff('Sharpening PC1', 1, { 2: 10 })]
    const { model, columns } = buildModel(
      highs,
      slots,
      [],
      [
        { skillId: 1, minPoints: 3 },
        { skillId: 2, minPoints: 10 },
      ],
      { pinnedCuffs },
      [],
    )

    expect(columns.some((c) => c.kind === 'cuff')).toBe(false)
    const { modelStatus, colValue, native } = solve(model)
    expect(modelStatus).toBe(highs.constants.modelStatus.optimal)
    const decoded = decodeSolution(columns, colValue)
    expect(decoded.cuffs).toEqual([])
    native.dispose()
  })

  it('reduces the free cuff pool budget by a pinned cuff that shares the same slot-cost budget', () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 3 })] }]
    const pinnedCuffs = [cuff('Skill Slots Up SZ', 2, { 2: 5 })]
    const freeCuffs = [cuff('Guard Up SZ', 2, { 3: 5 })]
    const { model } = buildModel(
      highs,
      slots,
      [],
      [
        { skillId: 1, minPoints: 3 },
        { skillId: 2, minPoints: 5 },
        { skillId: 3, minPoints: 5 },
      ],
      { pinnedCuffs },
      freeCuffs,
    )

    // The pin already spends the full budget (2), so the free cuff (also
    // costing 2) can no longer fit alongside it -- mirrors the unpinned
    // "rejects two cuffs whose combined slotSize exceeds the budget" case.
    const { modelStatus, native } = solve(model)
    expect(modelStatus).toBe(highs.constants.modelStatus.infeasible)
    native.dispose()
  })

  it('reduces the free cuff pool item-count limit by how many cuffs are pinned', () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 3 })] }]
    const pinnedCuffs = [cuff('SnS - Basic', 0, { 2: 5 }), cuff('SnS - Issen', 0, { 2: 5 })]
    const freeCuffs = [cuff('SnS - Rush', 0, { 2: 5 })]
    const { model, columns } = buildModel(
      highs,
      slots,
      [],
      [
        { skillId: 1, minPoints: 3 },
        { skillId: 2, minPoints: 5 },
      ],
      { pinnedCuffs },
      freeCuffs,
    )

    // Both cuff slots are already spoken for by the pins, so the free pool
    // (one more free cuff) can't be equipped at all even though it costs
    // nothing against the shared budget.
    const { modelStatus, colValue, native } = solve(model)
    expect(modelStatus).toBe(highs.constants.modelStatus.optimal)
    const decoded = decodeSolution(columns, colValue)
    expect(decoded.cuffs).toEqual([])
    native.dispose()
  })
})

describe('decodeSolution', () => {
  it('ignores auxiliary columns entirely, even when their value is far outside 0/1', () => {
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Plain', { 1: 5 }), candidate('Bonus', { 1: 5, 2: 100 })],
      },
    ]
    const { columns } = buildModel(highs, slots, [], [{ skillId: 1, minPoints: 3 }], {
      preferExactMatches: true,
      skillTiers: [{ skillId: 2, tierThresholds: [10] }],
    })
    const bonusIndex = columns.findIndex(
      (c) => c.kind === 'candidate' && c.candidate.id === 'Bonus',
    )
    const auxiliaryIndex = columns.findIndex((c) => c.kind === 'auxiliary')
    expect(auxiliaryIndex).toBeGreaterThanOrEqual(0)
    const colValue = new Float64Array(columns.length)
    colValue[bonusIndex] = 1
    // The accounting column's real value here would be 100 (Bonus's skill-2
    // points) -- decodeSolution must never mistake a value this far outside
    // [0, 1] for "chosen" the way it would for a choice column.
    colValue[auxiliaryIndex] = 100

    const decoded = decodeSolution(columns, colValue)

    expect(decoded.picks.get('head')?.id).toBe('Bonus')
    expect(decoded.decorations.size).toBe(0)
  })

  it('expands a chosen count > 0 decoration column into that many Decoration entries', () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Bare Helm', {}, 2)] }]
    const jewel = deco('Jewel', 1, { 1: 1 })
    const { columns } = buildModel(highs, slots, [jewel], [{ skillId: 1, minPoints: 1 }])
    const twoColumnIndex = columns.findIndex((c) => c.kind === 'decoration' && c.count === 2)
    const colValue = new Float64Array(columns.length)
    colValue[twoColumnIndex] = 0.9999999998 // never exactly 1.0 from a real solver

    const decoded = decodeSolution(columns, colValue)

    expect(decoded.decorations.get('head')).toEqual([jewel, jewel])
  })

  it('treats a chosen "place none" (count 0) column as no decorations placed', () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Bare Helm', {}, 2)] }]
    const jewel = deco('Jewel', 1, { 1: 1 })
    const { columns } = buildModel(highs, slots, [jewel], [{ skillId: 1, minPoints: 0 }])
    const zeroColumnIndex = columns.findIndex((c) => c.kind === 'decoration' && c.count === 0)
    const colValue = new Float64Array(columns.length)
    colValue[zeroColumnIndex] = 1

    const decoded = decodeSolution(columns, colValue)

    expect(decoded.decorations.get('head')).toBeUndefined()
  })

  it('sums all skills (including unrequested ones) into skillTotals', () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 5, 2: 7 })] }]
    const { columns } = buildModel(highs, slots, [], [{ skillId: 1, minPoints: 3 }])
    const colValue = new Float64Array(columns.length).fill(1)

    const decoded = decodeSolution(columns, colValue)

    expect(decoded.skillTotals.get(2)).toBe(7)
  })
})

describe('exclusionRow', () => {
  it('excludes auxiliary columns from the cut even when their value is far outside 0/1', () => {
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Plain', { 1: 5 }), candidate('Bonus', { 1: 5, 2: 100 })],
      },
    ]
    const { columns } = buildModel(highs, slots, [], [{ skillId: 1, minPoints: 3 }], {
      preferExactMatches: true,
      skillTiers: [{ skillId: 2, tierThresholds: [10] }],
    })
    const bonusIndex = columns.findIndex(
      (c) => c.kind === 'candidate' && c.candidate.id === 'Bonus',
    )
    const auxiliaryIndex = columns.findIndex((c) => c.kind === 'auxiliary')
    const colValue = new Float64Array(columns.length)
    colValue[bonusIndex] = 1
    colValue[auxiliaryIndex] = 100

    const row = exclusionRow(highs, columns, colValue)

    expect(row.indices).toEqual([bonusIndex])
    expect(row.upper).toBe(0) // 1 chosen (real) column - 1
  })

  it('forbids only the exact chosen set of columns', () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 5 }, 2)] }]
    const jewel = deco('Jewel', 1, { 1: 1 })
    const { columns } = buildModel(highs, slots, [jewel], [{ skillId: 1, minPoints: 3 }])
    const candidateIndex = columns.findIndex((c) => c.kind === 'candidate')
    const zeroColumnIndex = columns.findIndex((c) => c.kind === 'decoration' && c.count === 0)
    const colValue = new Float64Array(columns.length)
    colValue[candidateIndex] = 1
    colValue[zeroColumnIndex] = 1

    const row = exclusionRow(highs, columns, colValue)

    expect([...row.indices].sort((a, b) => a - b)).toEqual(
      [candidateIndex, zeroColumnIndex].sort((a, b) => a - b),
    )
    expect(row.values).toEqual([1, 1])
    expect(row.upper).toBe(1) // 2 chosen columns - 1
  })

  it('actually excludes the previous candidate combination when applied', () => {
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Helm A', { 1: 5 }), candidate('Helm B', { 1: 5 })],
      },
    ]
    const { model, columns } = buildModel(highs, slots, [], [{ skillId: 1, minPoints: 3 }])
    const native = highs.createModel(model)

    const first = native.run()
    expect(first.modelStatus).toBe(highs.constants.modelStatus.optimal)
    const firstSolution = native.getSolution()
    const firstPick = decodeSolution(columns, firstSolution.colValue).picks.get('head')?.id

    const cut = exclusionRow(highs, columns, firstSolution.colValue)
    native.addRow(cut.lower, cut.upper, { indices: cut.indices, values: cut.values })

    const second = native.run()
    expect(second.modelStatus).toBe(highs.constants.modelStatus.optimal)
    const secondSolution = native.getSolution()
    const secondPick = decodeSolution(columns, secondSolution.colValue).picks.get('head')?.id
    expect(secondPick).not.toBe(firstPick)

    const cut2 = exclusionRow(highs, columns, secondSolution.colValue)
    native.addRow(cut2.lower, cut2.upper, { indices: cut2.indices, values: cut2.values })
    const third = native.run()
    expect(third.modelStatus).toBe(highs.constants.modelStatus.infeasible)

    native.dispose()
  })

  it('excludes the previous decoration choice too, surfacing a tied alternative on the same candidate', () => {
    // Attack Jewel and Defense Jewel tie exactly in objective value (both
    // only touch requested skills, so neither earns bonus points, and both
    // use the same slotSize) -- a candidates-only cut would get stuck
    // re-finding whichever one solves first, since there's only one
    // candidate option for the slot.
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Bare Helm', {}, 2)] }]
    const attackJewel = deco('Attack Jewel', 2, { 1: 5, 2: 1 })
    const defenseJewel = deco('Defense Jewel', 2, { 1: 1, 2: 1 })
    const requirements = [
      { skillId: 1, minPoints: 1 },
      { skillId: 2, minPoints: 1 },
    ]
    const { model, columns } = buildModel(highs, slots, [attackJewel, defenseJewel], requirements)
    const native = highs.createModel(model)

    const first = native.run()
    expect(first.modelStatus).toBe(highs.constants.modelStatus.optimal)
    const firstDecoration = decodeSolution(columns, native.getSolution().colValue).decorations.get(
      'head',
    )?.[0].id

    const cut = exclusionRow(highs, columns, native.getSolution().colValue)
    native.addRow(cut.lower, cut.upper, { indices: cut.indices, values: cut.values })

    const second = native.run()
    expect(second.modelStatus).toBe(highs.constants.modelStatus.optimal)
    const secondDecoration = decodeSolution(columns, native.getSolution().colValue).decorations.get(
      'head',
    )?.[0].id
    expect(secondDecoration).not.toBe(firstDecoration)
    expect([firstDecoration, secondDecoration].sort()).toEqual(['Attack Jewel', 'Defense Jewel'])

    const cut2 = exclusionRow(highs, columns, native.getSolution().colValue)
    native.addRow(cut2.lower, cut2.upper, { indices: cut2.indices, values: cut2.values })
    const third = native.run()
    expect(third.modelStatus).toBe(highs.constants.modelStatus.infeasible)

    native.dispose()
  })
})

describe('isUsableResult', () => {
  it('accepts a proven-optimal result regardless of the (irrelevant) primal solution status value', () => {
    expect(
      isUsableResult(
        highs,
        highs.constants.modelStatus.optimal,
        highs.constants.solutionStatus.none,
      ),
    ).toBe(true)
  })

  it('accepts an interrupted result that still holds a feasible incumbent', () => {
    expect(
      isUsableResult(
        highs,
        highs.constants.modelStatus.interrupted,
        highs.constants.solutionStatus.feasible,
      ),
    ).toBe(true)
  })

  it('rejects an interrupted result with no incumbent found yet', () => {
    expect(
      isUsableResult(
        highs,
        highs.constants.modelStatus.interrupted,
        highs.constants.solutionStatus.none,
      ),
    ).toBe(false)
  })

  it('rejects a genuinely infeasible model', () => {
    expect(
      isUsableResult(
        highs,
        highs.constants.modelStatus.infeasible,
        highs.constants.solutionStatus.none,
      ),
    ).toBe(false)
  })
})
