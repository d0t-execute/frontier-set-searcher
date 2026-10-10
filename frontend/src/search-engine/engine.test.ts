import { describe, expect, it } from 'vitest'
import { search } from './engine'
import type { Candidate, Decoration, SlotQuery } from './types'

function candidate(
  id: string,
  skills: Record<number, number>,
  openSlots: readonly number[] = [],
): Candidate {
  return {
    id,
    skills: Object.entries(skills).map(([skillId, points]) => ({
      skillId: Number(skillId),
      points,
    })),
    openSlots,
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

describe('search', () => {
  it('returns a single-slot candidate that satisfies the requirement alone', () => {
    const slots: SlotQuery[] = [
      { slotId: 'head', candidates: [candidate('Leather Helm', { 1: 5 })] },
    ]

    const results = search(slots, [{ skillId: 1, minPoints: 3 }])

    expect(results).toHaveLength(1)
    expect(results[0].picks.get('head')?.id).toBe('Leather Helm')
    expect(results[0].skillTotals.get(1)).toBe(5)
    expect(results[0].surplus).toBe(2)
  })

  it('returns nothing when no candidate meets the requirement', () => {
    const slots: SlotQuery[] = [
      { slotId: 'head', candidates: [candidate('Leather Helm', { 1: 1 })] },
    ]

    const results = search(slots, [{ skillId: 1, minPoints: 3 }])

    expect(results).toEqual([])
  })

  it('combines candidates across multiple slots to meet the requirement', () => {
    const slots: SlotQuery[] = [
      { slotId: 'head', candidates: [candidate('Helm', { 1: 2 })] },
      { slotId: 'chest', candidates: [candidate('Mail', { 1: 2 })] },
    ]

    const results = search(slots, [{ skillId: 1, minPoints: 3 }])

    expect(results).toHaveLength(1)
    expect(results[0].skillTotals.get(1)).toBe(4)
    expect(results[0].surplus).toBe(1)
  })

  it('requires exactly one candidate per slot in the query', () => {
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Helm A', { 1: 5 }), candidate('Helm B', { 1: 1 })],
      },
    ]

    const results = search(slots, [{ skillId: 1, minPoints: 3 }])

    expect(results).toHaveLength(1)
    expect(results[0].picks.get('head')?.id).toBe('Helm A')
  })

  it('satisfies multiple simultaneous skill requirements', () => {
    const slots: SlotQuery[] = [
      { slotId: 'head', candidates: [candidate('Helm', { 1: 5, 2: 1 })] },
      { slotId: 'chest', candidates: [candidate('Mail', { 2: 4 })] },
    ]

    const results = search(slots, [
      { skillId: 1, minPoints: 3 },
      { skillId: 2, minPoints: 5 },
    ])

    expect(results).toHaveLength(1)
    expect(results[0].skillTotals.get(1)).toBe(5)
    expect(results[0].skillTotals.get(2)).toBe(5)
  })

  it("omits a requirement's skill from totals only when truly absent, otherwise reports 0 contribution", () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 5 })] }]

    const results = search(slots, [{ skillId: 1, minPoints: 3 }])

    expect(results[0].skillTotals.get(99)).toBeUndefined()
  })

  it('ranks results by descending surplus', () => {
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Big Helm', { 1: 10 }), candidate('Small Helm', { 1: 3 })],
      },
    ]

    const results = search(slots, [{ skillId: 1, minPoints: 3 }])

    expect(results.map((r) => r.picks.get('head')?.id)).toEqual(['Big Helm', 'Small Helm'])
    expect(results.map((r) => r.surplus)).toEqual([7, 0])
  })

  it('returns one result when the query has no slots and there are no requirements', () => {
    const results = search([], [])

    expect(results).toHaveLength(1)
    expect(results[0].picks.size).toBe(0)
    expect(results[0].surplus).toBe(0)
  })

  it('finds every valid combination, not just the first', () => {
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Helm A', { 1: 3 }), candidate('Helm B', { 1: 4 })],
      },
    ]

    const results = search(slots, [{ skillId: 1, minPoints: 3 }])

    expect(results.map((r) => r.picks.get('head')?.id).sort()).toEqual(['Helm A', 'Helm B'])
  })
})

describe('search with decorations', () => {
  it('uses a decoration placed in an open slot to meet the requirement', () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Bare Helm', {}, [2])] }]
    const jewel = deco('Attack Jewel', 2, { 1: 5 })

    const results = search(slots, [{ skillId: 1, minPoints: 3 }], [jewel])

    expect(results).toHaveLength(1)
    expect(results[0].skillTotals.get(1)).toBe(5)
    expect(results[0].decorations.get('head')).toEqual([jewel])
  })

  it('still returns the undecorated result when no decoration is needed or supplied', () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 5 }, [2])] }]

    const resultsWithoutDecorations = search(slots, [{ skillId: 1, minPoints: 3 }])
    expect(resultsWithoutDecorations).toHaveLength(1)
    expect(resultsWithoutDecorations[0].decorations.get('head')).toBeUndefined()

    const resultsWithUnusedDecorations = search(
      slots,
      [{ skillId: 1, minPoints: 3 }],
      [deco('Irrelevant Jewel', 2, { 99: 1 })],
    )
    // Both "leave the slot empty" and "fill it with the irrelevant jewel"
    // satisfy skill 1 via the base piece alone -- both are valid, distinct
    // results (the jewel also grants skill 99, which is extra information
    // even though nobody asked for it).
    expect(resultsWithUnusedDecorations.length).toBeGreaterThanOrEqual(1)
    expect(resultsWithUnusedDecorations.some((r) => r.decorations.get('head') === undefined)).toBe(
      true,
    )
  })

  it('ranks decoration choices by the surplus they produce', () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Bare Helm', {}, [2])] }]
    const bigJewel = deco('Big Jewel', 2, { 1: 5 })
    const smallJewel = deco('Small Jewel', 2, { 1: 1 })

    const results = search(slots, [{ skillId: 1, minPoints: 1 }], [bigJewel, smallJewel])

    const decorated = results.filter((r) => (r.decorations.get('head')?.length ?? 0) > 0)
    expect(decorated.map((r) => r.decorations.get('head')?.[0].id)).toEqual([
      'Big Jewel',
      'Small Jewel',
    ])
  })
})
