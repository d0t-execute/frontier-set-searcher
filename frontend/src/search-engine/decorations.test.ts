import { describe, expect, it } from 'vitest'
import { fillSlots } from './decorations'
import type { Decoration } from './types'

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

describe('fillSlots', () => {
  it('returns only the empty filling when there are no open slots', () => {
    const fillings = fillSlots([], [deco('Attack Jewel', 1, { 1: 3 })])

    expect(fillings).toEqual([{ placements: [], skills: [] }])
  })

  it('returns only the empty filling when there are no decorations available', () => {
    const fillings = fillSlots([2], [])

    expect(fillings).toEqual([{ placements: [], skills: [] }])
  })

  it('offers both the empty filling and placing a decoration that fits', () => {
    const jewel = deco('Attack Jewel', 2, { 1: 3 })

    const fillings = fillSlots([2], [jewel])

    expect(fillings).toHaveLength(2)
    expect(fillings).toContainEqual({ placements: [], skills: [] })
    expect(fillings).toContainEqual({
      placements: [{ slotIndex: 0, decoration: jewel }],
      skills: [{ skillId: 1, points: 3 }],
    })
  })

  it('does not offer a decoration that is too large for the slot', () => {
    const tooBig = deco('Big Jewel', 2, { 1: 3 })

    const fillings = fillSlots([1], [tooBig])

    expect(fillings).toEqual([{ placements: [], skills: [] }])
  })

  it('allows a smaller decoration into a larger slot', () => {
    const small = deco('Small Jewel', 1, { 1: 3 })

    const fillings = fillSlots([2], [small])

    expect(fillings).toContainEqual({
      placements: [{ slotIndex: 0, decoration: small }],
      skills: [{ skillId: 1, points: 3 }],
    })
  })

  it('fills multiple slots simultaneously, summing skill contributions', () => {
    // Attack (size 1) fits either slot; Defense (size 2) only fits slot 1 --
    // so the one filling that uses both one-of-each is slot0=Attack,
    // slot1=Defense specifically, not just "any filling with 2 placements"
    // (slot0=Attack, slot1=Attack is also a valid 2-placement filling).
    const attack = deco('Attack Jewel', 1, { 1: 3 })
    const defense = deco('Defense Jewel', 2, { 2: 5 })

    const fillings = fillSlots([1, 2], [attack, defense])

    const oneOfEach = fillings.find(
      (f) =>
        f.placements.length === 2 && new Set(f.placements.map((p) => p.decoration.id)).size === 2,
    )
    expect(oneOfEach?.skills).toEqual(
      expect.arrayContaining([
        { skillId: 1, points: 3 },
        { skillId: 2, points: 5 },
      ]),
    )
  })

  it('deduplicates fillings that use the same decorations across interchangeable same-size slots', () => {
    const attack = deco('Attack Jewel', 1, { 1: 3 })
    const defense = deco('Defense Jewel', 1, { 2: 5 })

    // Two same-size slots, both decorations fit either: the achievable
    // 2-placement combos are (Attack,Attack), (Defense,Defense), and
    // (Attack,Defense) -- but (Attack,Defense) and (Defense,Attack) are the
    // same achieved build, so that one must appear exactly once, not twice.
    const fillings = fillSlots([1, 1], [attack, defense])

    const twoPlacementSignatures = fillings
      .filter((f) => f.placements.length === 2)
      .map((f) =>
        f.placements
          .map((p) => p.decoration.id)
          .sort()
          .join(','),
      )

    expect(twoPlacementSignatures.sort()).toEqual([
      'Attack Jewel,Attack Jewel',
      'Attack Jewel,Defense Jewel',
      'Defense Jewel,Defense Jewel',
    ])
  })

  it('allows the same decoration to be placed in multiple slots', () => {
    const attack = deco('Attack Jewel', 1, { 1: 3 })

    const fillings = fillSlots([1, 1], [attack])

    const bothPlaced = fillings.find((f) => f.placements.length === 2)
    expect(bothPlaced?.skills).toEqual([{ skillId: 1, points: 6 }])
  })
})
