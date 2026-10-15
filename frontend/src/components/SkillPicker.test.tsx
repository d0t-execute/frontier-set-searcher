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

    it('defaults a newly-added leveled skill to its weakest non-penalty tier', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(<SkillPicker skills={LEVELED_SKILLS} requirements={[]} onChange={onChange} />)

      await user.click(screen.getByRole('button', { name: 'Vampirism' }))

      expect(onChange).toHaveBeenCalledWith([{ skillId: 1, minPoints: 10 }])
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
})
