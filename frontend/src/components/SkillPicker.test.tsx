import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SkillPicker } from './SkillPicker'
import type { SkillOption } from './SkillPicker'

function skill(
  id: number,
  name: string,
  overrides: Partial<Pick<SkillOption, 'category' | 'tiers'>> = {},
): SkillOption {
  return { id, name, category: null, tiers: [], ...overrides }
}

const SKILLS = [skill(1, 'Attack'), skill(2, 'Defense'), skill(3, 'Evasion')]

describe('SkillPicker', () => {
  it('offers every skill in the "add a skill" results when none are picked', () => {
    render(<SkillPicker skills={SKILLS} requirements={[]} onChange={vi.fn()} />)

    const addControl = screen.getByRole('textbox', { name: /add a skill/i })
    expect(screen.getAllByRole('button', { name: 'Attack' })).toHaveLength(1)
    expect(addControl).toBeInTheDocument()
  })

  it('renders no requirement rows when none are picked', () => {
    render(<SkillPicker skills={SKILLS} requirements={[]} onChange={vi.fn()} />)

    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  it('appends a new requirement when a skill is chosen from the add control', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<SkillPicker skills={SKILLS} requirements={[]} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'Attack' }))

    expect(onChange).toHaveBeenCalledWith([{ skillId: 1, minPoints: 1 }])
  })

  it('refocuses the search field after a click, so adding several skills never needs the mouse (docs/skill-system-roadmap.md TODO #23)', async () => {
    const user = userEvent.setup()
    render(<SkillPicker skills={SKILLS} requirements={[]} onChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Attack' }))

    expect(screen.getByRole('textbox', { name: /add a skill/i })).toHaveFocus()
  })

  it('renders an existing requirement as a row with the skill name and its points', () => {
    render(
      <SkillPicker
        skills={SKILLS}
        requirements={[{ skillId: 2, minPoints: 15 }]}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('Defense')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton')).toHaveValue(15)
  })

  it("updates that requirement's minPoints when the number input changes, leaving others alone", () => {
    const onChange = vi.fn()
    render(
      <SkillPicker
        skills={SKILLS}
        requirements={[
          { skillId: 1, minPoints: 5 },
          { skillId: 2, minPoints: 10 },
        ]}
        onChange={onChange}
      />,
    )

    // A single atomic change event, rather than simulating keystroke by
    // keystroke -- this component is purely controlled by its `requirements`
    // prop, which this test never updates, so React would otherwise reset
    // the field's displayed value between simulated keystrokes.
    fireEvent.change(screen.getAllByRole('spinbutton')[1], { target: { value: '20' } })

    expect(onChange).toHaveBeenLastCalledWith([
      { skillId: 1, minPoints: 5 },
      { skillId: 2, minPoints: 20 },
    ])
  })

  it('removes a requirement when its remove button is clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <SkillPicker
        skills={SKILLS}
        requirements={[
          { skillId: 1, minPoints: 5 },
          { skillId: 2, minPoints: 10 },
        ]}
        onChange={onChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: /remove attack/i }))

    expect(onChange).toHaveBeenCalledWith([{ skillId: 2, minPoints: 10 }])
  })

  it('does not offer an already-picked skill again in the add control', () => {
    render(
      <SkillPicker
        skills={SKILLS}
        requirements={[{ skillId: 1, minPoints: 5 }]}
        onChange={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Attack' })).not.toBeInTheDocument()
  })

  it('narrows the add-a-skill results as the search text changes', async () => {
    const user = userEvent.setup()
    render(<SkillPicker skills={SKILLS} requirements={[]} onChange={vi.fn()} />)

    await user.type(screen.getByRole('textbox', { name: /add a skill/i }), 'def')

    expect(screen.getByRole('button', { name: 'Defense' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Attack' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Evasion' })).not.toBeInTheDocument()
  })

  it('matches a skill by one of its tier labels, not just its own name (docs/feedback.md Round 2 #8)', async () => {
    const user = userEvent.setup()
    const skillsWithTiers = [
      skill(1, 'Cooking', {
        tiers: [{ label: 'BBQ Master', minPoints: 15, description: null }],
      }),
      ...SKILLS,
    ]
    render(<SkillPicker skills={skillsWithTiers} requirements={[]} onChange={vi.fn()} />)

    await user.type(screen.getByRole('textbox', { name: /add a skill/i }), 'bbq master')

    expect(screen.getByRole('button', { name: 'Cooking' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Attack' })).not.toBeInTheDocument()
  })

  it('shows a message when no skill matches the search text', async () => {
    const user = userEvent.setup()
    render(<SkillPicker skills={SKILLS} requirements={[]} onChange={vi.fn()} />)

    await user.type(screen.getByRole('textbox', { name: /add a skill/i }), 'zzz')

    expect(screen.getByText('No matches.')).toBeInTheDocument()
  })

  it('clears the search text after adding a skill', async () => {
    const user = userEvent.setup()
    render(<SkillPicker skills={SKILLS} requirements={[]} onChange={vi.fn()} />)

    const addControl = screen.getByRole('textbox', { name: /add a skill/i })
    await user.type(addControl, 'Attack')
    await user.click(screen.getByRole('button', { name: 'Attack' }))

    expect(addControl).toHaveValue('')
  })

  it('numbers each selected skill in order', () => {
    render(
      <SkillPicker
        skills={SKILLS}
        requirements={[
          { skillId: 2, minPoints: 5 },
          { skillId: 1, minPoints: 10 },
        ]}
        onChange={vi.fn()}
      />,
    )

    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('1. Defense')
    expect(rows[1]).toHaveTextContent('2. Attack')
  })

  describe('keyboard-only selection', () => {
    it('adds the first match when Enter is pressed after typing', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(<SkillPicker skills={SKILLS} requirements={[]} onChange={onChange} />)

      await user.type(screen.getByRole('textbox', { name: /add a skill/i }), 'eva{Enter}')

      expect(onChange).toHaveBeenCalledWith([{ skillId: 3, minPoints: 1 }])
    })

    it('moves the highlighted match with the arrow keys before accepting it with Enter', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(<SkillPicker skills={SKILLS} requirements={[]} onChange={onChange} />)

      const addControl = screen.getByRole('textbox', { name: /add a skill/i })
      await user.click(addControl)
      await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')

      // Attack, Defense, Evasion in that order -- two ArrowDowns from the
      // first (Attack) lands on the third (Evasion).
      expect(onChange).toHaveBeenCalledWith([{ skillId: 3, minPoints: 1 }])
    })

    it('wraps back to the first match after arrowing past the last one', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(<SkillPicker skills={SKILLS} requirements={[]} onChange={onChange} />)

      const addControl = screen.getByRole('textbox', { name: /add a skill/i })
      await user.click(addControl)
      await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}')

      expect(onChange).toHaveBeenCalledWith([{ skillId: 1, minPoints: 1 }])
    })

    it('resets the highlighted match back to the first one after the search text changes', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(<SkillPicker skills={SKILLS} requirements={[]} onChange={onChange} />)

      const addControl = screen.getByRole('textbox', { name: /add a skill/i })
      await user.click(addControl)
      await user.keyboard('{ArrowDown}{ArrowDown}')
      await user.type(addControl, 'a')
      await user.keyboard('{Enter}')

      // Narrowing to "a" leaves Attack and Evasion -- Enter should pick the
      // first of those, not whatever was highlighted before typing.
      expect(onChange).toHaveBeenCalledWith([{ skillId: 1, minPoints: 1 }])
    })

    it('does nothing on Enter when there are no matches', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(<SkillPicker skills={SKILLS} requirements={[]} onChange={onChange} />)

      await user.type(screen.getByRole('textbox', { name: /add a skill/i }), 'zzz{Enter}')

      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('categorization', () => {
    const CATEGORIZED_SKILLS = [
      skill(1, 'Health', { category: 'Health and Stamina' }),
      skill(2, 'Vampirism', { category: 'Health and Stamina' }),
      skill(3, 'Attack', { category: 'Attack Skills' }),
      skill(4, 'Mystery Skill'), // no category
    ]

    it('groups the add-a-skill options under their category', () => {
      render(<SkillPicker skills={CATEGORIZED_SKILLS} requirements={[]} onChange={vi.fn()} />)

      const healthGroup = screen.getByRole('group', { name: 'Health and Stamina' })
      expect(
        within(healthGroup)
          .getAllByRole('button')
          .map((o) => o.textContent),
      ).toEqual(['Health', 'Vampirism'])
      expect(
        within(screen.getByRole('group', { name: 'Attack Skills' })).getByRole('button', {
          name: 'Attack',
        }),
      ).toBeInTheDocument()
    })

    it('groups skills with no category under "Other"', () => {
      render(<SkillPicker skills={CATEGORIZED_SKILLS} requirements={[]} onChange={vi.fn()} />)

      const otherGroup = screen.getByRole('group', { name: 'Other' })
      expect(within(otherGroup).getByRole('button', { name: 'Mystery Skill' })).toBeInTheDocument()
    })

    it('keeps category order fixed as a category loses its first-listed skill (docs/skill-system-roadmap.md #36)', () => {
      // Interleaved on purpose: "Health" (Health and Stamina) comes before
      // "Attack" (Attack Skills) in the catalog, but "Vampirism" (also Health
      // and Stamina) comes after it -- so once "Health" is picked and
      // filtered out, the old order-from-the-filtered-list grouping would see
      // Attack Skills' member before Health and Stamina's remaining member
      // and swap their order.
      const INTERLEAVED_SKILLS = [
        skill(1, 'Health', { category: 'Health and Stamina' }),
        skill(2, 'Attack', { category: 'Attack Skills' }),
        skill(3, 'Vampirism', { category: 'Health and Stamina' }),
      ]
      const groupNames = () => screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))

      const { rerender } = render(
        <SkillPicker skills={INTERLEAVED_SKILLS} requirements={[]} onChange={vi.fn()} />,
      )
      expect(groupNames()).toEqual(['Health and Stamina', 'Attack Skills'])

      rerender(
        <SkillPicker
          skills={INTERLEAVED_SKILLS}
          requirements={[{ skillId: 1, minPoints: 1 }]}
          onChange={vi.fn()}
        />,
      )
      expect(groupNames()).toEqual(['Health and Stamina', 'Attack Skills'])
    })
  })

  describe('leveled skills', () => {
    const VAMPIRISM_TIERS = [
      { label: 'Vampirism+2', minPoints: 20, description: null },
      { label: 'Vampirism+1', minPoints: 10, description: null },
    ]
    const LEVELED_SKILLS = [skill(1, 'Vampirism', { tiers: VAMPIRISM_TIERS })]

    it('renders a level select instead of a raw point input for a skill with tiers', () => {
      render(
        <SkillPicker
          skills={LEVELED_SKILLS}
          requirements={[{ skillId: 1, minPoints: 10 }]}
          onChange={vi.fn()}
        />,
      )

      expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
      const levelSelect = screen.getByRole('combobox', { name: /vampirism level/i })
      expect(
        within(levelSelect)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['Vampirism+2', 'Vampirism+1'])
      expect(levelSelect).toHaveValue('10')
      // The requirement-type select next to it is the fixed-width column
      // (2026-10-27, per the project owner) -- the level select sizes to its
      // picked tier's own label.
      expect(screen.getByRole('combobox', { name: /vampirism requirement type/i })).toHaveClass(
        'skill-requirement-type-select',
      )
    })

    it("sets the requirement's minPoints to the chosen tier's threshold", async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(
        <SkillPicker
          skills={LEVELED_SKILLS}
          requirements={[{ skillId: 1, minPoints: 10 }]}
          onChange={onChange}
        />,
      )

      await user.selectOptions(
        screen.getByRole('combobox', { name: /vampirism level/i }),
        'Vampirism+2',
      )

      expect(onChange).toHaveBeenCalledWith([{ skillId: 1, minPoints: 20 }])
    })

    it('defaults a newly-added leveled skill to its strongest non-penalty tier (docs/skill-system-roadmap.md TODO #22)', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(<SkillPicker skills={LEVELED_SKILLS} requirements={[]} onChange={onChange} />)

      await user.click(screen.getByRole('button', { name: 'Vampirism' }))

      expect(onChange).toHaveBeenCalledWith([{ skillId: 1, minPoints: 20 }])
    })

    it('defaults to the first tier when every tier is a penalty (negative threshold)', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      const allPenalty = [
        skill(1, 'Cursed Skill', {
          tiers: [
            { label: 'Cursed-1', minPoints: -10, description: null },
            { label: 'Cursed-2', minPoints: -20, description: null },
          ],
        }),
      ]
      render(<SkillPicker skills={allPenalty} requirements={[]} onChange={onChange} />)

      await user.click(screen.getByRole('button', { name: 'Cursed Skill' }))

      expect(onChange).toHaveBeenCalledWith([{ skillId: 1, minPoints: -10 }])
    })
  })

  describe('optional requirements (docs/feedback.md Round 3 #2)', () => {
    it('shows a single requirement-type selector defaulted to "Required"', () => {
      render(
        <SkillPicker
          skills={SKILLS}
          requirements={[{ skillId: 1, minPoints: 5 }]}
          onChange={vi.fn()}
        />,
      )

      expect(screen.getByRole('combobox', { name: /attack requirement type/i })).toHaveValue(
        'required',
      )
    })

    it('highlights a required requirement but not an optional one', () => {
      render(
        <SkillPicker
          skills={SKILLS}
          requirements={[
            { skillId: 1, minPoints: 5 },
            { skillId: 2, minPoints: 3, optional: true, priority: 1 },
          ]}
          onChange={vi.fn()}
        />,
      )

      expect(screen.getByRole('combobox', { name: /attack requirement type/i })).toHaveClass(
        'skill-requirement-select-required',
      )
      expect(screen.getByRole('combobox', { name: /defense requirement type/i })).not.toHaveClass(
        'skill-requirement-select-required',
      )
    })

    it('marks a requirement optional at the explicitly picked priority', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(
        <SkillPicker
          skills={SKILLS}
          requirements={[
            { skillId: 1, minPoints: 5 },
            { skillId: 2, minPoints: 3, optional: true, priority: 1 },
          ]}
          onChange={onChange}
        />,
      )

      await user.selectOptions(
        screen.getByRole('combobox', { name: /attack requirement type/i }),
        '3',
      )

      expect(onChange).toHaveBeenCalledWith([
        { skillId: 1, minPoints: 5, optional: true, priority: 3 },
        { skillId: 2, minPoints: 3, optional: true, priority: 1 },
      ])
    })

    it('reports a priority change for an already-optional requirement', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(
        <SkillPicker
          skills={SKILLS}
          requirements={[{ skillId: 1, minPoints: 5, optional: true, priority: 1 }]}
          onChange={onChange}
        />,
      )

      await user.selectOptions(
        screen.getByRole('combobox', { name: /attack requirement type/i }),
        '4',
      )

      expect(onChange).toHaveBeenCalledWith([
        { skillId: 1, minPoints: 5, optional: true, priority: 4 },
      ])
    })

    it('clears the priority when switching a requirement back to "Required"', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(
        <SkillPicker
          skills={SKILLS}
          requirements={[{ skillId: 1, minPoints: 5, optional: true, priority: 3 }]}
          onChange={onChange}
        />,
      )

      await user.selectOptions(
        screen.getByRole('combobox', { name: /attack requirement type/i }),
        'required',
      )

      expect(onChange).toHaveBeenCalledWith([
        { skillId: 1, minPoints: 5, optional: false, priority: undefined },
      ])
    })
  })

  describe('"Prefer higher" requirement type (2026-10-27)', () => {
    const VAMPIRISM_TIERS = [
      { label: 'Vampirism+2', minPoints: 20, description: null },
      { label: 'Vampirism+1', minPoints: 10, description: null },
    ]
    const LEVELED_SKILLS = [skill(1, 'Vampirism', { tiers: VAMPIRISM_TIERS })]

    it('offers "Prefer higher" between "Required" and "Option 1" for a skill with more than one tier', () => {
      render(
        <SkillPicker
          skills={LEVELED_SKILLS}
          requirements={[{ skillId: 1, minPoints: 10 }]}
          onChange={vi.fn()}
        />,
      )

      const typeSelect = screen.getByRole('combobox', { name: /vampirism requirement type/i })
      expect(
        within(typeSelect)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual([
        'Required',
        'Prefer higher',
        'Option 1',
        'Option 2',
        'Option 3',
        'Option 4',
        'Option 5',
        'Option 6',
        'Option 7',
      ])
    })

    it('does not offer "Prefer higher" for an untiered skill', () => {
      render(
        <SkillPicker
          skills={SKILLS}
          requirements={[{ skillId: 1, minPoints: 5 }]}
          onChange={vi.fn()}
        />,
      )

      const typeSelect = screen.getByRole('combobox', { name: /attack requirement type/i })
      expect(within(typeSelect).queryByText('Prefer higher')).not.toBeInTheDocument()
    })

    it('does not offer "Prefer higher" once the picked level is already the skill\'s own top tier', () => {
      // A multi-tier skill (`tiers.length > 1`) isn't enough on its own --
      // there has to be a tier *above the one currently picked*, which
      // Vampirism+2 (the strongest tier) has none of.
      render(
        <SkillPicker
          skills={LEVELED_SKILLS}
          requirements={[{ skillId: 1, minPoints: 20 }]}
          onChange={vi.fn()}
        />,
      )

      const typeSelect = screen.getByRole('combobox', { name: /vampirism requirement type/i })
      expect(within(typeSelect).queryByText('Prefer higher')).not.toBeInTheDocument()
    })

    it('sets preferHigher (clearing optional/priority) when "Prefer higher" is picked', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(
        <SkillPicker
          skills={LEVELED_SKILLS}
          requirements={[{ skillId: 1, minPoints: 10, optional: true, priority: 3 }]}
          onChange={onChange}
        />,
      )

      await user.selectOptions(
        screen.getByRole('combobox', { name: /vampirism requirement type/i }),
        'Prefer higher',
      )

      expect(onChange).toHaveBeenCalledWith([
        { skillId: 1, minPoints: 10, optional: false, priority: undefined, preferHigher: true },
      ])
    })

    it('shows the "Prefer higher" select as highlighted, the same as "Required"', () => {
      render(
        <SkillPicker
          skills={LEVELED_SKILLS}
          requirements={[{ skillId: 1, minPoints: 10, preferHigher: true }]}
          onChange={vi.fn()}
        />,
      )

      expect(screen.getByRole('combobox', { name: /vampirism requirement type/i })).toHaveClass(
        'skill-requirement-select-required',
      )
    })

    it('clears preferHigher when switching back to "Required"', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(
        <SkillPicker
          skills={LEVELED_SKILLS}
          requirements={[{ skillId: 1, minPoints: 10, preferHigher: true }]}
          onChange={onChange}
        />,
      )

      await user.selectOptions(
        screen.getByRole('combobox', { name: /vampirism requirement type/i }),
        'required',
      )

      expect(onChange).toHaveBeenCalledWith([
        {
          skillId: 1,
          minPoints: 10,
          optional: false,
          priority: undefined,
          preferHigher: undefined,
        },
      ])
    })

    it('clears preferHigher when switching to "Option N"', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(
        <SkillPicker
          skills={LEVELED_SKILLS}
          requirements={[{ skillId: 1, minPoints: 10, preferHigher: true }]}
          onChange={onChange}
        />,
      )

      await user.selectOptions(
        screen.getByRole('combobox', { name: /vampirism requirement type/i }),
        '2',
      )

      expect(onChange).toHaveBeenCalledWith([
        { skillId: 1, minPoints: 10, optional: true, priority: 2, preferHigher: undefined },
      ])
    })
  })
})
