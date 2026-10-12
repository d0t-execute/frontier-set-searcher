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
})

describe('decodeSolution', () => {
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
