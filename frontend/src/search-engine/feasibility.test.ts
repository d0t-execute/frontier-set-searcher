import { describe, expect, it } from 'vitest'
import { findUnreachableRequirements } from './feasibility'
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

const cuff = deco

function slot(slotId: string, candidates: readonly Candidate[]): SlotQuery {
  return { slotId, candidates }
}

describe('findUnreachableRequirements', () => {
  it('returns nothing when every requirement is reachable', () => {
    const slots = [slot('head', [candidate('head:1', { 1: 10 })])]
    const unreachable = findUnreachableRequirements(slots, [], [], [{ skillId: 1, minPoints: 10 }])
    expect(unreachable).toEqual([])
  })

  it('flags a requirement no slot, decoration, or cuff can ever reach at all', () => {
    const slots = [slot('head', [candidate('head:1', { 1: 10 })])]
    const unreachable = findUnreachableRequirements(slots, [], [], [{ skillId: 2, minPoints: 1 }])
    expect(unreachable).toEqual([{ skillId: 2, required: 1, maxReachable: 0 }])
  })

  it('flags a requirement whose summed max across every source still falls short', () => {
    const slots = [
      slot('head', [candidate('head:1', { 1: 5 })]),
      slot('chest', [candidate('chest:1', { 1: 3 })]),
    ]
    const decorations = [deco('D1', 1, { 1: 2 })]
    const cuffs = [cuff('C1', 0, { 1: 1 })]
    // Best case: 5 (head) + 3 (chest) + 0 (no open slots for decorations) + 2
    // (1 cuff, MAX_EQUIPPED_CUFFS lets it count twice) * ... -- regardless of
    // the exact arithmetic, nowhere near 100.
    const unreachable = findUnreachableRequirements(slots, decorations, cuffs, [
      { skillId: 1, minPoints: 100 },
    ])
    expect(unreachable).toHaveLength(1)
    expect(unreachable[0].skillId).toBe(1)
    expect(unreachable[0].required).toBe(100)
    expect(unreachable[0].maxReachable).toBeLessThan(100)
  })

  it('does not flag a requirement only reachable through decorations placed in open slots', () => {
    const slots = [slot('head', [candidate('head:1', {}, 3)])]
    const decorations = [deco('D1', 1, { 1: 5 })]
    const unreachable = findUnreachableRequirements(slots, decorations, [], [
      { skillId: 1, minPoints: 15 },
    ])
    expect(unreachable).toEqual([])
  })

  it('counts a pinned cuff toward reachability even though it is not in the free cuff pool', () => {
    const slots = [slot('head', [candidate('head:1', {})])]
    const pinnedCuffs = [cuff('C1', 0, { 1: 10 })]
    const unreachable = findUnreachableRequirements(
      slots,
      [],
      [],
      [{ skillId: 1, minPoints: 10 }],
      pinnedCuffs,
    )
    expect(unreachable).toEqual([])
  })

  it('counts a pinned slot decoration toward reachability', () => {
    const slots = [slot('head', [candidate('head:1', {}, 1)])]
    const pinnedSlotDecorations = new Map([['head', [deco('D1', 1, { 1: 10 })]]])
    const unreachable = findUnreachableRequirements(
      slots,
      [],
      [],
      [{ skillId: 1, minPoints: 10 }],
      [],
      pinnedSlotDecorations,
    )
    expect(unreachable).toEqual([])
  })

  it('returns an empty array for an empty requirements list', () => {
    expect(findUnreachableRequirements([], [], [], [])).toEqual([])
  })
})
