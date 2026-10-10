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

function signature(filling: { decorationsUsed: readonly Decoration[] }): string {
  return filling.decorationsUsed
    .map((d) => d.id)
    .sort()
    .join(',')
}

describe('fillSlots', () => {
  it('returns only the empty filling when there is no open slot capacity', () => {
    const fillings = fillSlots(0, [deco('Attack Jewel', 1, { 1: 3 })])

    expect(fillings).toEqual([{ decorationsUsed: [], skills: [] }])
  })

  it('returns only the empty filling when there are no decorations available', () => {
    const fillings = fillSlots(2, [])

    expect(fillings).toEqual([{ decorationsUsed: [], skills: [] }])
  })

  it('offers both the empty filling and placing a decoration that fits exactly', () => {
    const jewel = deco('Attack Jewel', 2, { 1: 3 })

    const fillings = fillSlots(2, [jewel])

    expect(fillings).toHaveLength(2)
    expect(fillings).toContainEqual({ decorationsUsed: [], skills: [] })
    expect(fillings).toContainEqual({
      decorationsUsed: [jewel],
      skills: [{ skillId: 1, points: 3 }],
    })
  })

  it('does not offer a decoration that is too large for the remaining capacity', () => {
    const tooBig = deco('Big Jewel', 2, { 1: 3 })

    const fillings = fillSlots(1, [tooBig])

    expect(fillings).toEqual([{ decorationsUsed: [], skills: [] }])
  })

  it('allows a smaller decoration into a larger capacity, leaving the rest unused', () => {
    const small = deco('Small Jewel', 1, { 1: 3 })

    const fillings = fillSlots(2, [small])

    expect(fillings).toContainEqual({
      decorationsUsed: [small],
      skills: [{ skillId: 1, points: 3 }],
    })
  })

  it('combines decorations whose slot sizes sum to at most the open slot count', () => {
    // A size-1 and a size-2 decoration together cost 3, exactly filling a
    // 3-unit capacity.
    const attack = deco('Attack Jewel', 1, { 1: 3 })
    const defense = deco('Defense Jewel', 2, { 2: 5 })

    const fillings = fillSlots(3, [attack, defense])

    const oneOfEach = fillings.find(
      (f) =>
        f.decorationsUsed.length === 2 && new Set(f.decorationsUsed.map((d) => d.id)).size === 2,
    )
    expect(oneOfEach?.skills).toEqual(
      expect.arrayContaining([
        { skillId: 1, points: 3 },
        { skillId: 2, points: 5 },
      ]),
    )
  })

  it('does not offer a combination whose summed slot sizes exceed capacity', () => {
    const attack = deco('Attack Jewel', 2, { 1: 3 })
    const defense = deco('Defense Jewel', 2, { 2: 5 })

    const fillings = fillSlots(3, [attack, defense])

    expect(fillings.some((f) => f.decorationsUsed.length === 2)).toBe(false)
  })

  it('produces every reachable multiset exactly once', () => {
    const attack = deco('Attack Jewel', 1, { 1: 3 })
    const defense = deco('Defense Jewel', 1, { 2: 5 })

    // 2 units of capacity, two size-1 decorations in unlimited supply: the
    // achievable 2-decoration combos are (Attack,Attack), (Defense,Defense),
    // and (Attack,Defense) -- each must appear exactly once.
    const fillings = fillSlots(2, [attack, defense])

    const twoPieceSignatures = fillings.filter((f) => f.decorationsUsed.length === 2).map(signature)

    expect(twoPieceSignatures.sort()).toEqual([
      'Attack Jewel,Attack Jewel',
      'Attack Jewel,Defense Jewel',
      'Defense Jewel,Defense Jewel',
    ])
  })

  it('allows the same decoration to be used more than once', () => {
    const attack = deco('Attack Jewel', 1, { 1: 3 })

    const fillings = fillSlots(2, [attack])

    const both = fillings.find((f) => f.decorationsUsed.length === 2)
    expect(both?.skills).toEqual([{ skillId: 1, points: 6 }])
  })
})
