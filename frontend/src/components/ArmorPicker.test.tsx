import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
        hunterType: 'common',
        exoticSkillId: null,
        defenseMax: null,
        resistances: { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 },
        skills: [{ skillId: 1, points: 5 }],
        openSlotCount: 2,
      },
      {
        id: 'head:0002',
        name: 'Iron Helm',
        category: 'standard_plain',
        grankOrLater: false,
        hunterType: 'common',
        exoticSkillId: null,
        defenseMax: null,
        resistances: { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 },
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
        hunterType: 'common',
        exoticSkillId: null,
        defenseMax: null,
        resistances: { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 },
        skills: [],
      },
    ] as NamedCandidate[],
  },
]

const decorations: readonly NamedDecoration[] = [
  {
    id: 'D001',
    name: 'Attack Jewel',
    slotSize: 1,
    skills: [{ skillId: 1, points: 3 }],
    isTower: false,
    isSp: false,
    category: 'deco_standard',
  },
  {
    id: 'D002',
    name: 'Defense Jewel',
    slotSize: 2,
    skills: [{ skillId: 2, points: 3 }],
    isTower: false,
    isSp: false,
    category: 'deco_standard',
  },
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
        pinnedSlotDecorationIds={new Map()}
        onChangeSlotDecorations={() => {}}
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
        pinnedSlotDecorationIds={new Map()}
        onChangeSlotDecorations={() => {}}
        skills={skills}
      />,
    )

    fireEvent.change(screen.getByLabelText('Search pieces for head'), {
      target: { value: 'L' },
    })

    expect(screen.queryByLabelText('Pieces matching search for head')).not.toBeInTheDocument()
    expect(screen.queryByText(/no matches/i)).not.toBeInTheDocument()
  })

  it('filters candidates by a case-insensitive substring match', () => {
    render(
      <ArmorPicker
        slots={slots}
        decorations={decorations}
        pinned={new Map()}
        onChange={() => {}}
        pinnedSlotDecorationIds={new Map()}
        onChangeSlotDecorations={() => {}}
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
        pinnedSlotDecorationIds={new Map()}
        onChangeSlotDecorations={() => {}}
        skills={skills}
      />,
    )

    fireEvent.change(screen.getByLabelText('Search pieces for head'), {
      target: { value: 'leather' },
    })
    fireEvent.click(screen.getByRole('option', { name: 'Leather Helm' }))

    expect(onChange).toHaveBeenCalledWith(pinHead('head:0001'))
  })

  it('shows a pinned slot as a summary with Change/Clear controls', () => {
    render(
      <ArmorPicker
        slots={slots}
        decorations={decorations}
        pinned={pinHead('head:0001')}
        onChange={() => {}}
        pinnedSlotDecorationIds={new Map()}
        onChangeSlotDecorations={() => {}}
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
        pinnedSlotDecorationIds={new Map()}
        onChangeSlotDecorations={() => {}}
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
        pinnedSlotDecorationIds={new Map()}
        onChangeSlotDecorations={() => {}}
        skills={skills}
      />,
    )

    fireEvent.change(screen.getByLabelText('Search decorations for head'), {
      target: { value: 'attack' },
    })
    fireEvent.click(screen.getByRole('option', { name: 'Attack Jewel' }))

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
        pinnedSlotDecorationIds={new Map()}
        onChangeSlotDecorations={() => {}}
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
        pinnedSlotDecorationIds={new Map()}
        onChangeSlotDecorations={() => {}}
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
        pinnedSlotDecorationIds={new Map()}
        onChangeSlotDecorations={() => {}}
        skills={skills}
      />,
    )

    fireEvent.click(screen.getByLabelText('Remove Attack Jewel'))

    expect(onChange).toHaveBeenCalledWith(
      new Map([['head', { candidateId: 'head:0001', decorationIds: [] }]]),
    )
  })

  it('offers a decoration-only search for an unpinned slot (TODO #12)', () => {
    render(
      <ArmorPicker
        slots={slots}
        decorations={decorations}
        pinned={new Map()}
        onChange={() => {}}
        pinnedSlotDecorationIds={new Map()}
        onChangeSlotDecorations={() => {}}
        skills={skills}
      />,
    )

    expect(screen.getByLabelText('Search decorations to force into head')).toBeInTheDocument()
  })

  it('forces a decoration into an unpinned slot without pinning its piece', () => {
    const onChangeSlotDecorations = vi.fn()
    render(
      <ArmorPicker
        slots={slots}
        decorations={decorations}
        pinned={new Map()}
        onChange={() => {}}
        pinnedSlotDecorationIds={new Map()}
        onChangeSlotDecorations={onChangeSlotDecorations}
        skills={skills}
      />,
    )

    fireEvent.change(screen.getByLabelText('Search decorations to force into head'), {
      target: { value: 'attack' },
    })
    fireEvent.click(screen.getByRole('option', { name: 'Attack Jewel' }))

    expect(onChangeSlotDecorations).toHaveBeenCalledWith(new Map([['head', ['D001']]]))
  })

  it("bounds the decoration-only search by the largest capacity any of the slot's candidates could offer", () => {
    render(
      <ArmorPicker
        slots={slots}
        decorations={decorations}
        pinned={new Map()}
        onChange={() => {}}
        pinnedSlotDecorationIds={new Map([['head', ['D002']]])}
        onChangeSlotDecorations={() => {}}
        skills={skills}
      />,
    )

    // Max capacity across head's candidates is 2 (Leather Helm), already
    // spent entirely by the pinned D002 (size 2) -- no room left for
    // anything else, so the search box itself doesn't render (same as the
    // piece-pinned decoration picker's own "remainingCapacity > 0" gate).
    expect(
      screen.queryByLabelText('Search decorations to force into head'),
    ).not.toBeInTheDocument()
    expect(screen.getByText(/0 of 2 possible open slots left/i)).toBeInTheDocument()
  })

  it("doesn't show the decoration-only search once the slot has a full piece pin", () => {
    render(
      <ArmorPicker
        slots={slots}
        decorations={decorations}
        pinned={pinHead('head:0001')}
        onChange={() => {}}
        pinnedSlotDecorationIds={new Map()}
        onChangeSlotDecorations={() => {}}
        skills={skills}
      />,
    )

    expect(
      screen.queryByLabelText('Search decorations to force into head'),
    ).not.toBeInTheDocument()
  })

  it('removes a decoration-only pin when its remove button is clicked', () => {
    const onChangeSlotDecorations = vi.fn()
    render(
      <ArmorPicker
        slots={slots}
        decorations={decorations}
        pinned={new Map()}
        onChange={() => {}}
        pinnedSlotDecorationIds={new Map([['head', ['D001']]])}
        onChangeSlotDecorations={onChangeSlotDecorations}
        skills={skills}
      />,
    )

    fireEvent.click(screen.getByLabelText('Remove Attack Jewel'))

    expect(onChangeSlotDecorations).toHaveBeenCalledWith(new Map())
  })

  it('clears a slot-only decoration pin once a full piece pin is set for the same slot', () => {
    const onChangeSlotDecorations = vi.fn()
    render(
      <ArmorPicker
        slots={slots}
        decorations={decorations}
        pinned={new Map()}
        onChange={() => {}}
        pinnedSlotDecorationIds={new Map([['head', ['D001']]])}
        onChangeSlotDecorations={onChangeSlotDecorations}
        skills={skills}
      />,
    )

    fireEvent.change(screen.getByLabelText('Search pieces for head'), {
      target: { value: 'leather' },
    })
    fireEvent.click(screen.getByRole('option', { name: 'Leather Helm' }))

    expect(onChangeSlotDecorations).toHaveBeenCalledWith(new Map())
  })

  it('shows the skills a piece grants as a hover tooltip on its search option and once pinned', () => {
    render(
      <ArmorPicker
        slots={slots}
        decorations={decorations}
        pinned={pinHead('head:0001')}
        onChange={() => {}}
        pinnedSlotDecorationIds={new Map()}
        onChangeSlotDecorations={() => {}}
        skills={skills}
      />,
    )

    expect(screen.getByText('Leather Helm')).toHaveAttribute('title', 'Attack: 5')
  })

  it('shows the skills a decoration grants as a hover tooltip on its search option and once placed', () => {
    render(
      <ArmorPicker
        slots={slots}
        decorations={decorations}
        pinned={pinHead('head:0001')}
        onChange={() => {}}
        pinnedSlotDecorationIds={new Map()}
        onChangeSlotDecorations={() => {}}
        skills={skills}
      />,
    )

    fireEvent.change(screen.getByLabelText('Search decorations for head'), {
      target: { value: 'Attack' },
    })

    expect(screen.getByRole('option', { name: 'Attack Jewel' })).toHaveAttribute('title', 'Attack: 3')
  })

  it('shows a prompt to hover a result before anything is hovered', () => {
    render(
      <ArmorPicker
        slots={slots}
        decorations={decorations}
        pinned={new Map()}
        onChange={() => {}}
        pinnedSlotDecorationIds={new Map()}
        onChangeSlotDecorations={() => {}}
        skills={skills}
      />,
    )

    fireEvent.change(screen.getByLabelText('Search pieces for head'), {
      target: { value: 'leather' },
    })

    expect(screen.getByText('Hover a result to see its skills.')).toBeInTheDocument()
  })

  it('shows the hovered piece\'s skills in a persistent summary line below the results', () => {
    render(
      <ArmorPicker
        slots={slots}
        decorations={decorations}
        pinned={new Map()}
        onChange={() => {}}
        pinnedSlotDecorationIds={new Map()}
        onChangeSlotDecorations={() => {}}
        skills={skills}
      />,
    )

    fireEvent.change(screen.getByLabelText('Search pieces for head'), {
      target: { value: 'helm' },
    })
    fireEvent.mouseEnter(screen.getByRole('option', { name: 'Leather Helm' }))

    expect(screen.getByText('Attack: 5')).toBeInTheDocument()

    fireEvent.mouseLeave(screen.getByRole('option', { name: 'Leather Helm' }))

    expect(screen.getByText('Hover a result to see its skills.')).toBeInTheDocument()
  })

  it('highlights the searched-for skill in the hovered summary line', () => {
    render(
      <ArmorPicker
        slots={slots}
        decorations={decorations}
        pinned={new Map()}
        onChange={() => {}}
        pinnedSlotDecorationIds={new Map()}
        onChangeSlotDecorations={() => {}}
        skills={skills}
      />,
    )

    fireEvent.change(screen.getByLabelText('Search pieces for head'), {
      target: { value: 'attack' },
    })
    fireEvent.mouseEnter(screen.getByRole('option', { name: 'Leather Helm' }))

    const mark = screen.getByText('Attack: 5', { selector: 'mark' })
    expect(mark.tagName).toBe('MARK')
  })

  describe('keyboard-only picking', () => {
    it('pins the top-matching piece when Enter is pressed in the piece search', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(
        <ArmorPicker
          slots={slots}
          decorations={decorations}
          pinned={new Map()}
          onChange={onChange}
          pinnedSlotDecorationIds={new Map()}
          onChangeSlotDecorations={() => {}}
          skills={skills}
        />,
      )

      await user.type(screen.getByLabelText('Search pieces for head'), 'leather{Enter}')

      expect(onChange).toHaveBeenCalledWith(pinHead('head:0001'))
    })

    it('places the top-matching decoration when Enter is pressed in the decoration search', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(
        <ArmorPicker
          slots={slots}
          decorations={decorations}
          pinned={pinHead('head:0001')}
          onChange={onChange}
          pinnedSlotDecorationIds={new Map()}
          onChangeSlotDecorations={() => {}}
          skills={skills}
        />,
      )

      await user.type(screen.getByLabelText('Search decorations for head'), 'attack{Enter}')

      expect(onChange).toHaveBeenCalledWith(
        new Map([['head', { candidateId: 'head:0001', decorationIds: ['D001'] }]]),
      )
    })

    it('does nothing on Enter when there is no match in the piece search', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(
        <ArmorPicker
          slots={slots}
          decorations={decorations}
          pinned={new Map()}
          onChange={onChange}
          pinnedSlotDecorationIds={new Map()}
          onChangeSlotDecorations={() => {}}
          skills={skills}
        />,
      )

      await user.type(screen.getByLabelText('Search pieces for head'), 'zzz{Enter}')

      expect(onChange).not.toHaveBeenCalled()
    })
  })
})
