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

    const results = [...search(slots, [{ skillId: 1, minPoints: 3 }])]

    expect(results).toHaveLength(1)
    expect(results[0].picks.get('head')?.id).toBe('Leather Helm')
    expect(results[0].skillTotals.get(1)).toBe(5)
    expect(results[0].surplus).toBe(2)
  })

  it('returns nothing when no candidate meets the requirement', () => {
    const slots: SlotQuery[] = [
      { slotId: 'head', candidates: [candidate('Leather Helm', { 1: 1 })] },
    ]

    const results = [...search(slots, [{ skillId: 1, minPoints: 3 }])]

    expect(results).toEqual([])
  })

  it('combines candidates across multiple slots to meet the requirement', () => {
    const slots: SlotQuery[] = [
      { slotId: 'head', candidates: [candidate('Helm', { 1: 2 })] },
      { slotId: 'chest', candidates: [candidate('Mail', { 1: 2 })] },
    ]

    const results = [...search(slots, [{ skillId: 1, minPoints: 3 }])]

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

    const results = [...search(slots, [{ skillId: 1, minPoints: 3 }])]

    expect(results).toHaveLength(1)
    expect(results[0].picks.get('head')?.id).toBe('Helm A')
  })

  it('satisfies multiple simultaneous skill requirements', () => {
    const slots: SlotQuery[] = [
      { slotId: 'head', candidates: [candidate('Helm', { 1: 5, 2: 1 })] },
      { slotId: 'chest', candidates: [candidate('Mail', { 2: 4 })] },
    ]

    const results = [
      ...search(slots, [
        { skillId: 1, minPoints: 3 },
        { skillId: 2, minPoints: 5 },
      ]),
    ]

    expect(results).toHaveLength(1)
    expect(results[0].skillTotals.get(1)).toBe(5)
    expect(results[0].skillTotals.get(2)).toBe(5)
  })

  it("omits a requirement's skill from totals only when truly absent, otherwise reports 0 contribution", () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 5 })] }]

    const results = [...search(slots, [{ skillId: 1, minPoints: 3 }])]

    expect(results[0].skillTotals.get(99)).toBeUndefined()
  })

  it('prunes a candidate that is strictly dominated by another on every requested skill', () => {
    // Small Helm's single-skill contribution (3) is strictly worse than Big
    // Helm's (10) -- Small Helm's build can never outrank Big Helm's, so
    // it's pruned rather than surfaced as a redundant, strictly-worse
    // alternative (confirmed project direction).
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Big Helm', { 1: 10 }), candidate('Small Helm', { 1: 3 })],
      },
    ]

    const results = [...search(slots, [{ skillId: 1, minPoints: 3 }])]

    expect(results.map((r) => r.picks.get('head')?.id)).toEqual(['Big Helm'])
    expect(results.map((r) => r.surplus)).toEqual([7])
  })

  it('ranks multiple non-dominated results by descending surplus', () => {
    // Neither candidate dominates the other (Balanced Helm is better at
    // skill 1, Off Helm is better at skill 2), so both survive -- ranked by
    // their actual combined surplus, not by either skill alone.
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [
          candidate('Balanced Helm', { 1: 10, 2: 1 }),
          candidate('Off Helm', { 1: 2, 2: 8 }),
        ],
      },
    ]
    const requirements = [
      { skillId: 1, minPoints: 0 },
      { skillId: 2, minPoints: 0 },
    ]

    const results = [...search(slots, requirements)]

    expect(results.map((r) => r.picks.get('head')?.id)).toEqual(['Balanced Helm', 'Off Helm'])
    expect(results.map((r) => r.surplus)).toEqual([11, 10])
  })

  it('returns one result when the query has no slots and there are no requirements', () => {
    const results = [...search([], [])]

    expect(results).toHaveLength(1)
    expect(results[0].picks.size).toBe(0)
    expect(results[0].surplus).toBe(0)
  })

  it('finds every non-dominated valid combination, not just the first', () => {
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Helm A', { 1: 5, 2: 0 }), candidate('Helm B', { 1: 0, 2: 5 })],
      },
    ]
    const requirements = [
      { skillId: 1, minPoints: 0 },
      { skillId: 2, minPoints: 0 },
    ]

    const results = [...search(slots, requirements)]

    expect(results.map((r) => r.picks.get('head')?.id).sort()).toEqual(['Helm A', 'Helm B'])
  })

  it('can be consumed lazily, stopping before the full result set is computed', () => {
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Helm A', { 1: 3 }), candidate('Helm B', { 1: 4 })],
      },
    ]

    const generator = search(slots, [{ skillId: 1, minPoints: 3 }])
    const first = generator.next()

    expect(first.done).toBe(false)
    expect(first.value.picks.get('head')?.id).toBe('Helm B') // higher surplus first
  })
})

describe('search with decorations', () => {
  it('uses a decoration placed in an open slot to meet the requirement', () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Bare Helm', {}, [2])] }]
    const jewel = deco('Attack Jewel', 2, { 1: 5 })

    const results = [...search(slots, [{ skillId: 1, minPoints: 3 }], [jewel])]

    expect(results).toHaveLength(1)
    expect(results[0].skillTotals.get(1)).toBe(5)
    expect(results[0].decorations.get('head')).toEqual([jewel])
  })

  it('still returns the undecorated result when no decoration is needed or supplied', () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 5 }, [2])] }]

    const resultsWithoutDecorations = [...search(slots, [{ skillId: 1, minPoints: 3 }])]
    expect(resultsWithoutDecorations).toHaveLength(1)
    expect(resultsWithoutDecorations[0].decorations.get('head')).toBeUndefined()

    const resultsWithIrrelevantDecoration = [
      ...search(slots, [{ skillId: 1, minPoints: 3 }], [deco('Irrelevant Jewel', 2, { 99: 1 })]),
    ]
    // A decoration that contributes to none of the requested skills can
    // never change whether a requirement is met or how results rank, so it
    // isn't expanded into a separate result variant -- only the undecorated
    // build is returned, same as if the decoration didn't exist. This is a
    // deliberate performance tradeoff (see engine.ts's module docstring):
    // without it, every candidate gets expanded against the *entire*
    // decoration catalog regardless of relevance, which is combinatorially
    // enormous at real-dataset scale.
    expect(resultsWithIrrelevantDecoration).toHaveLength(1)
    expect(resultsWithIrrelevantDecoration[0].decorations.get('head')).toBeUndefined()
  })

  it('prunes a decoration choice that is strictly dominated by a better one', () => {
    // Small Jewel's contribution (1) is strictly worse than Big Jewel's (5)
    // on the only requested skill -- same pruning rule as for candidates.
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Bare Helm', {}, [2])] }]
    const bigJewel = deco('Big Jewel', 2, { 1: 5 })
    const smallJewel = deco('Small Jewel', 2, { 1: 1 })

    const results = [...search(slots, [{ skillId: 1, minPoints: 1 }], [bigJewel, smallJewel])]

    const decorated = results.filter((r) => (r.decorations.get('head')?.length ?? 0) > 0)
    expect(decorated.map((r) => r.decorations.get('head')?.[0].id)).toEqual(['Big Jewel'])
  })

  it('ranks non-dominated decoration choices by the surplus they produce', () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Bare Helm', {}, [2])] }]
    const attackJewel = deco('Attack Jewel', 2, { 1: 5, 2: 1 })
    const defenseJewel = deco('Defense Jewel', 2, { 1: 1, 2: 4 })

    const requirements = [
      { skillId: 1, minPoints: 0 },
      { skillId: 2, minPoints: 0 },
    ]
    const results = [...search(slots, requirements, [attackJewel, defenseJewel])]

    const decorated = results.filter((r) => (r.decorations.get('head')?.length ?? 0) > 0)
    expect(decorated.map((r) => r.decorations.get('head')?.[0].id)).toEqual([
      'Attack Jewel',
      'Defense Jewel',
    ])
    expect(decorated.map((r) => r.surplus)).toEqual([6, 5])
  })
})
