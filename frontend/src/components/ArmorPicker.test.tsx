import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ArmorPicker } from './ArmorPicker'
import type { NamedCandidate, NamedDecoration, NamedSkill } from '../search-engine/load-bundle'
import type { PinnedSlot } from '../search-engine/pinned-armor'

const slots = [
  {
    slotId: 'head',
    candidates: [
      {
        id: 'head:0001',
        name: 'Leather Helm',
        category: 'standard_plain',
        grankOrLater: false,
        skills: [{ skillId: 1, points: 5 }],
        openSlotCount: 2,
      },
      {
        id: 'head:0002',
        name: 'Iron Helm',
        category: 'standard_plain',
        grankOrLater: false,
        skills: [],
      },
    ] as NamedCandidate[],
  },
  {
    slotId: 'chest',
    candidates: [
      {
        id: 'body:0001',
        name: 'Leather Vest',
        category: 'standard_plain',
        grankOrLater: false,
        skills: [],
      },
    ] as NamedCandidate[],
  },
]

const decorations: readonly NamedDecoration[] = [
  { id: 'D001', name: 'Attack Jewel', slotSize: 1, skills: [{ skillId: 1, points: 3 }], isTower: false },
  { id: 'D002', name: 'Defense Jewel', slotSize: 2, skills: [{ skillId: 2, points: 3 }], isTower: false },
]

const skills: readonly NamedSkill[] = [
  { id: 1, name: 'Attack', category: null, priorityRank: null, tiers: [] },
  { id: 2, name: 'Defense', category: null, priorityRank: null, tiers: [] },
]

function pinHead(candidateId: string): ReadonlyMap<string, PinnedSlot> {
  return new Map([['head', { candidateId, decorationIds: [] }]])
}

describe('ArmorPicker', () => {
  it('renders an unpinned search box per slot by default', () => {
    render(
      <ArmorPicker
        slots={slots}
        decorations={decorations}
        pinned={new Map()}
        onChange={() => {}}
        skills={skills}
      />,
    )

    expect(screen.getByLabelText('Search pieces for head')).toBeInTheDocument()
    expect(screen.getByLabelText('Search pieces for chest')).toBeInTheDocument()
  })

  it('shows nothing until the search text reaches the minimum length', () => {
    render(
      <ArmorPicker
        slots={slots}
        decorations={decorations}
        pinned={new Map()}
        onChange={() => {}}
        skills={skills}
      />,
    )

    fireEvent.change(screen.getByLabelText('Search pieces for head'), {
      target: { value: 'L' },
    })

    expect(screen.getAllByText(/type at least/i).length).toBeGreaterThan(0)
    expect(screen.queryByLabelText('Pieces matching search for head')).not.toBeInTheDocument()
  })

  it('filters candidates by a case-insensitive substring match', () => {
    render(
      <ArmorPicker
        slots={slots}
        decorations={decorations}
        pinned={new Map()}
        onChange={() => {}}
        skills={skills}
      />,
    )

    fireEvent.change(screen.getByLabelText('Search pieces for head'), {
      target: { value: 'leather' },
    })

    const matches = screen.getByLabelText('Pieces matching search for head')
    expect(matches).toHaveTextContent('Leather Helm')
    expect(matches).not.toHaveTextContent('Iron Helm')
  })

  it('pins a candidate when picked from the filtered list', () => {
    const onChange = vi.fn()
    render(
      <ArmorPicker
        slots={slots}
        decorations={decorations}
        pinned={new Map()}
        onChange={onChange}
        skills={skills}
      />,
    )

    fireEvent.change(screen.getByLabelText('Search pieces for head'), {
      target: { value: 'leather' },
    })
    fireEvent.change(screen.getByLabelText('Pieces matching search for head'), {
      target: { value: 'head:0001' },
    })

    expect(onChange).toHaveBeenCalledWith(pinHead('head:0001'))
  })

  it('shows a pinned slot as a summary with Change/Clear controls', () => {
    render(
      <ArmorPicker
        slots={slots}
        decorations={decorations}
        pinned={pinHead('head:0001')}
        onChange={() => {}}
        skills={skills}
      />,
    )

    expect(screen.getByText('Leather Helm')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument()
  })

  it('unpins a slot when Clear is clicked', () => {
    const onChange = vi.fn()
    render(
      <ArmorPicker
        slots={slots}
        decorations={decorations}
        pinned={pinHead('head:0001')}
        onChange={onChange}
        skills={skills}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(onChange).toHaveBeenCalledWith(new Map())
  })

  it('adds a decoration to a pinned slot within its remaining capacity', () => {
    const onChange = vi.fn()
    render(
      <ArmorPicker
        slots={slots}
        decorations={decorations}
        pinned={pinHead('head:0001')}
        onChange={onChange}
        skills={skills}
      />,
    )

    fireEvent.change(screen.getByLabelText('Search decorations for head'), {
      target: { value: 'attack' },
    })
    fireEvent.change(screen.getByLabelText('Add a decoration to head'), {
      target: { value: 'D001' },
    })

    expect(onChange).toHaveBeenCalledWith(
      new Map([['head', { candidateId: 'head:0001', decorationIds: ['D001'] }]]),
    )
  })

  it('only offers decorations that fit the remaining open-slot capacity', () => {
    const pinned: ReadonlyMap<string, PinnedSlot> = new Map([
      ['head', { candidateId: 'head:0001', decorationIds: ['D001'] }],
    ])
    render(
      <ArmorPicker
        slots={slots}
        decorations={decorations}
        pinned={pinned}
        onChange={() => {}}
        skills={skills}
      />,
    )

    // 2 open slots, 1 used by D001 (size 1) -> 1 left, too small for D002 (size 2).
    fireEvent.change(screen.getByLabelText('Search decorations for head'), {
      target: { value: 'defense' },
    })
    expect(screen.getByText(/no matches/i)).toBeInTheDocument()
  })

  it('shows live skill totals across pinned slots, flagging active skills', () => {
    render(
      <ArmorPicker
        slots={slots}
        decorations={decorations}
        pinned={pinHead('head:0001')}
        onChange={() => {}}
        skills={skills}
      />,
    )

    expect(screen.getByText(/attack: 5 \(active\)/i)).toBeInTheDocument()
  })

  it('removes a placed decoration when its remove button is clicked', () => {
    const onChange = vi.fn()
    const pinned: ReadonlyMap<string, PinnedSlot> = new Map([
      ['head', { candidateId: 'head:0001', decorationIds: ['D001'] }],
    ])
    render(
      <ArmorPicker
        slots={slots}
        decorations={decorations}
        pinned={pinned}
        onChange={onChange}
        skills={skills}
      />,
    )

    fireEvent.click(screen.getByLabelText('Remove Attack Jewel'))

    expect(onChange).toHaveBeenCalledWith(
      new Map([['head', { candidateId: 'head:0001', decorationIds: [] }]]),
    )
  })
})
