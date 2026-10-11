import { describe, expect, it } from 'vitest'
import { expandSlot } from './expand'
import { computeFrontier } from './pareto'
import type { Candidate, SkillRequirement, SlotQuery } from './types'

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

function expand(slots: SlotQuery[], requirements: readonly SkillRequirement[] = []) {
  return slots.map((s) => expandSlot(s, [], requirements))
}

describe('computeFrontier', () => {
  it('returns a single all-zero entry for zero slots', () => {
    const frontier = computeFrontier([], [{ skillId: 1, minPoints: 0 }])

    expect(frontier).toHaveLength(1)
    // [requested skill, open slots, bonus points] -- see vectorOf's docstring.
    expect(frontier[0].vector).toEqual([0, 0, 0])
    expect(frontier[0].picks.size).toBe(0)
  })

  it('returns a single entry for one slot with one candidate', () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 5 })] }]

    // minPoints matches Helm's own value exactly: feasible (meets the
    // requirement) without being capped down (it's at, not past, the cap).
    const requirements = [{ skillId: 1, minPoints: 5 }]
    const frontier = computeFrontier(expand(slots, requirements), requirements)

    expect(frontier).toHaveLength(1)
    expect(frontier[0].vector).toEqual([5, 0, 0])
    expect(frontier[0].picks.get('head')?.candidate.id).toBe('Helm')
  })

  it('excludes a candidate that can never meet the requirement on its own', () => {
    // `computeFrontier` only ever returns results that already satisfy every
    // requirement (see `isSalvageable`'s root-level check in pareto.ts) --
    // Small Helm's 3 points never reaches a requirement of 5, regardless of
    // dominance. (Two candidates that *both* meet the same requirement
    // always tie once capped -- see "treats a combined build that
    // overshoots..." below -- so this is the only way a single candidate in
    // isolation gets excluded here.)
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Big Helm', { 1: 5 }), candidate('Small Helm', { 1: 3 })],
      },
    ]

    const requirements = [{ skillId: 1, minPoints: 5 }]
    const frontier = computeFrontier(expand(slots, requirements), requirements)

    expect(frontier).toHaveLength(1)
    expect(frontier[0].vector).toEqual([5, 0, 0])
    expect(frontier[0].picks.get('head')?.candidate.id).toBe('Big Helm')
  })

  it('preserves ties between candidates that satisfy requirements via different raw distributions', () => {
    // Attack Helm overshoots skill 1 and just meets skill 2; Defense Helm is
    // the mirror image -- genuinely different raw builds, but both capped to
    // exactly the requirements vector once each dimension is independently
    // satisfied, so neither is "better."
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [
          candidate('Attack Helm', { 1: 5, 2: 3 }),
          candidate('Defense Helm', { 1: 3, 2: 5 }),
        ],
      },
    ]

    const requirements = [
      { skillId: 1, minPoints: 3 },
      { skillId: 2, minPoints: 3 },
    ]
    const frontier = computeFrontier(expand(slots), requirements)

    expect(frontier.map((f) => f.picks.get('head')?.candidate.id).sort()).toEqual([
      'Attack Helm',
      'Defense Helm',
    ])
    expect(frontier.map((f) => f.vector)).toEqual([
      [3, 3, 0, 0],
      [3, 3, 0, 0],
    ])
  })

  it('prefers a build with more bonus skill points when the requested vector is otherwise tied', () => {
    // Confirmed project direction (see pareto.ts's `vectorOf` docstring):
    // a bonus skill nobody asked for makes a build strictly better, not
    // merely different, once every requested skill is already tied --
    // "Fancy Helm" no longer just ties with "Plain Helm" here, it wins.
    // (This is the cross-slot level, where bonus points is cheap enough to
    // be full dominance, not just a tie-break -- see expand.ts's
    // `skillAndSlotsVector` docstring for where and why that differs.)
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [
          candidate('Plain Helm', { 1: 5 }),
          candidate('Fancy Helm', { 1: 5, 99: 10 }), // bonus skill 99, not requested
        ],
      },
    ]

    const requirements = [{ skillId: 1, minPoints: 5 }]
    const frontier = computeFrontier(expand(slots, requirements), requirements)

    expect(frontier).toHaveLength(1)
    expect(frontier[0].picks.get('head')?.candidate.id).toBe('Fancy Helm')
    // The bonus skill is preserved in `totals` as well as counted toward the
    // dominance vector's own bonus-points dimension.
    expect(frontier[0].totals.get(99)).toBe(10)
  })

  it('prefers a build with more open decoration slots when the requested vector is otherwise tied', () => {
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Plain Helm', { 1: 5 }, 0), candidate('Slotted Helm', { 1: 5 }, 3)],
      },
    ]

    const requirements = [{ skillId: 1, minPoints: 5 }]
    const frontier = computeFrontier(expand(slots, requirements), requirements)

    expect(frontier).toHaveLength(1)
    expect(frontier[0].picks.get('head')?.candidate.id).toBe('Slotted Helm')
  })

  it('combines candidates across multiple slots, summing contributions', () => {
    const slots: SlotQuery[] = [
      { slotId: 'head', candidates: [candidate('Helm', { 1: 3 })] },
      { slotId: 'chest', candidates: [candidate('Mail', { 1: 4 })] },
    ]

    // Matches the combined total (3 + 4) exactly -- feasible, uncapped.
    const requirements = [{ skillId: 1, minPoints: 7 }]
    const frontier = computeFrontier(expand(slots, requirements), requirements)

    expect(frontier).toHaveLength(1)
    expect(frontier[0].vector).toEqual([7, 0, 0])
    expect(frontier[0].picks.get('head')?.candidate.id).toBe('Helm')
    expect(frontier[0].picks.get('chest')?.candidate.id).toBe('Mail')
  })

  it('ignores skills outside the requested set when computing dominance', () => {
    // Fancy Helm meets the requirement and has an extra bonus skill; Plain
    // Helm never reaches the requirement at all -- it's excluded regardless
    // of the bonus skill's existence.
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Plain Helm', { 1: 3 }), candidate('Fancy Helm', { 1: 5, 99: 10 })],
      },
    ]

    const requirements = [{ skillId: 1, minPoints: 5 }]
    const frontier = computeFrontier(expand(slots, requirements), requirements)

    expect(frontier).toHaveLength(1)
    expect(frontier[0].picks.get('head')?.candidate.id).toBe('Fancy Helm')
  })

  it('treats a combined build that overshoots a requirement as tied with one that just meets it', () => {
    // Confirmed project direction: once a requirement is met, more points in
    // it don't make a build better. Without capping, "Big Helm" would
    // dominate (and bury) "Just Enough Helm" purely for having more raw
    // points toward a requirement that's already satisfied either way.
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Just Enough Helm', { 1: 10 }), candidate('Big Helm', { 1: 1000 })],
      },
    ]

    const requirements = [{ skillId: 1, minPoints: 10 }]
    const frontier = computeFrontier(expand(slots, requirements), requirements)

    expect(frontier.map((f) => f.picks.get('head')?.candidate.id).sort()).toEqual([
      'Big Helm',
      'Just Enough Helm',
    ])
    expect(frontier.map((f) => f.vector)).toEqual([
      [10, 0, 0],
      [10, 0, 0],
    ])
  })
})
