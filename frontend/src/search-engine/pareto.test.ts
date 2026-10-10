import { describe, expect, it } from 'vitest'
import { expandSlot } from './expand'
import { computeFrontier } from './pareto'
import type { Candidate, SkillRequirement, SlotQuery } from './types'

function candidate(id: string, skills: Record<number, number>): Candidate {
  return {
    id,
    skills: Object.entries(skills).map(([skillId, points]) => ({
      skillId: Number(skillId),
      points,
    })),
  }
}

function expand(slots: SlotQuery[], requirements: readonly SkillRequirement[] = []) {
  return slots.map((s) => expandSlot(s, [], requirements))
}

describe('computeFrontier', () => {
  it('returns a single all-zero entry for zero slots', () => {
    const frontier = computeFrontier([], [{ skillId: 1, minPoints: 0 }])

    expect(frontier).toHaveLength(1)
    expect(frontier[0].vector).toEqual([0])
    expect(frontier[0].picks.size).toBe(0)
  })

  it('returns a single entry for one slot with one candidate', () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 5 })] }]

    const frontier = computeFrontier(expand(slots), [{ skillId: 1, minPoints: 0 }])

    expect(frontier).toHaveLength(1)
    expect(frontier[0].vector).toEqual([5])
    expect(frontier[0].picks.get('head')?.candidate.id).toBe('Helm')
  })

  it('discards a candidate strictly dominated by another on every requested skill', () => {
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Big Helm', { 1: 5 }), candidate('Small Helm', { 1: 3 })],
      },
    ]

    const frontier = computeFrontier(expand(slots), [{ skillId: 1, minPoints: 0 }])

    expect(frontier).toHaveLength(1)
    expect(frontier[0].vector).toEqual([5])
  })

  it('keeps both candidates when neither dominates the other', () => {
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [
          candidate('Attack Helm', { 1: 5, 2: 0 }),
          candidate('Defense Helm', { 1: 0, 2: 5 }),
        ],
      },
    ]

    const requirements = [
      { skillId: 1, minPoints: 0 },
      { skillId: 2, minPoints: 0 },
    ]
    const frontier = computeFrontier(expand(slots), requirements)

    const vectors = frontier.map((f) => f.vector).sort()
    expect(vectors).toEqual(
      [
        [5, 0],
        [0, 5],
      ].sort(),
    )
  })

  it('preserves ties: two different builds achieving the same requested vector both survive', () => {
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [
          candidate('Plain Helm', { 1: 5 }),
          candidate('Fancy Helm', { 1: 5, 99: 10 }), // bonus skill 99, not requested
        ],
      },
    ]

    const frontier = computeFrontier(expand(slots), [{ skillId: 1, minPoints: 0 }])

    expect(frontier).toHaveLength(2)
    expect(frontier.map((f) => f.vector)).toEqual([[5], [5]])
    // The bonus skill is preserved in `totals` even though it doesn't affect
    // the dominance vector.
    const fancy = frontier.find((f) => f.picks.get('head')?.candidate.id === 'Fancy Helm')
    expect(fancy?.totals.get(99)).toBe(10)
  })

  it('combines candidates across multiple slots, summing contributions', () => {
    const slots: SlotQuery[] = [
      { slotId: 'head', candidates: [candidate('Helm', { 1: 3 })] },
      { slotId: 'chest', candidates: [candidate('Mail', { 1: 4 })] },
    ]

    const frontier = computeFrontier(expand(slots), [{ skillId: 1, minPoints: 0 }])

    expect(frontier).toHaveLength(1)
    expect(frontier[0].vector).toEqual([7])
    expect(frontier[0].picks.get('head')?.candidate.id).toBe('Helm')
    expect(frontier[0].picks.get('chest')?.candidate.id).toBe('Mail')
  })

  it('ignores skills outside the requested set when computing dominance', () => {
    // Fancy Helm is strictly better on the requested skill AND has an extra
    // bonus skill -- it should dominate (and discard) Plain Helm regardless
    // of the bonus skill's existence.
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Plain Helm', { 1: 3 }), candidate('Fancy Helm', { 1: 5, 99: 10 })],
      },
    ]

    const frontier = computeFrontier(expand(slots), [{ skillId: 1, minPoints: 0 }])

    expect(frontier).toHaveLength(1)
    expect(frontier[0].picks.get('head')?.candidate.id).toBe('Fancy Helm')
  })
})
