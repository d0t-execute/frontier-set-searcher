import { describe, expect, it } from 'vitest'
import { computePinnedSkillTotals } from './pinned-armor'
import type { PinnableSlot, PinnedSlot } from './pinned-armor'
import type { NamedDecoration } from './load-bundle'

const slots: readonly PinnableSlot[] = [
  {
    slotId: 'head',
    candidates: [{ id: 'head:0001', skills: [{ skillId: 1, points: 5 }] }],
  },
  {
    slotId: 'chest',
    candidates: [{ id: 'body:0001', skills: [{ skillId: 2, points: 3 }] }],
  },
]

const decorations: readonly NamedDecoration[] = [
  {
    id: 'D001',
    name: 'Attack Jewel',
    slotSize: 1,
    skills: [{ skillId: 1, points: 3 }],
    isTower: false,
    category: 'deco_standard',
  },
]

describe('computePinnedSkillTotals', () => {
  it('is empty when nothing is pinned', () => {
    expect(computePinnedSkillTotals(new Map(), slots, decorations).size).toBe(0)
  })

  it('sums a pinned candidate’s own skills', () => {
    const pinned: ReadonlyMap<string, PinnedSlot> = new Map([
      ['head', { candidateId: 'head:0001', decorationIds: [] }],
    ])

    const totals = computePinnedSkillTotals(pinned, slots, decorations)

    expect(totals.get(1)).toBe(5)
  })

  it('adds placed decorations’ skills on top of the candidate’s own', () => {
    const pinned: ReadonlyMap<string, PinnedSlot> = new Map([
      ['head', { candidateId: 'head:0001', decorationIds: ['D001'] }],
    ])

    const totals = computePinnedSkillTotals(pinned, slots, decorations)

    expect(totals.get(1)).toBe(8)
  })

  it('sums across multiple pinned slots', () => {
    const pinned: ReadonlyMap<string, PinnedSlot> = new Map([
      ['head', { candidateId: 'head:0001', decorationIds: [] }],
      ['chest', { candidateId: 'body:0001', decorationIds: [] }],
    ])

    const totals = computePinnedSkillTotals(pinned, slots, decorations)

    expect(totals.get(1)).toBe(5)
    expect(totals.get(2)).toBe(3)
  })

  it('ignores an unpinned slot entirely', () => {
    const pinned: ReadonlyMap<string, PinnedSlot> = new Map([
      ['head', { candidateId: 'head:0001', decorationIds: [] }],
    ])

    const totals = computePinnedSkillTotals(pinned, slots, decorations)

    expect(totals.has(2)).toBe(false)
  })

  it('adds a slot-only decoration pin (TODO #12) even though no candidate is pinned for it', () => {
    const totals = computePinnedSkillTotals(
      new Map(),
      slots,
      decorations,
      new Map([['head', ['D001', 'D001']]]),
    )

    expect(totals.get(1)).toBe(6)
  })

  it("ignores a slot-only decoration pin for a slot that already has a full piece pin", () => {
    const pinned: ReadonlyMap<string, PinnedSlot> = new Map([
      ['head', { candidateId: 'head:0001', decorationIds: [] }],
    ])

    const totals = computePinnedSkillTotals(
      pinned,
      slots,
      decorations,
      new Map([['head', ['D001']]]),
    )

    // Only the piece's own 5, not 5 + the slot-only pin's 3 too -- a piece
    // pin's own `decorationIds` is the only source of truth once one exists.
    expect(totals.get(1)).toBe(5)
  })
})
