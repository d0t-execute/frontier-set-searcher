import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SkillPicker } from './SkillPicker'

const SKILLS = [
  { id: 1, name: 'Attack' },
  { id: 2, name: 'Defense' },
  { id: 3, name: 'Evasion' },
]

describe('SkillPicker', () => {
  it('offers every skill in the "add a skill" control when none are picked', () => {
    render(<SkillPicker skills={SKILLS} requirements={[]} onChange={vi.fn()} />)

    const addControl = screen.getByRole('combobox', { name: /add a skill/i })
    expect(screen.getAllByRole('option', { name: 'Attack' })).toHaveLength(1)
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

    await user.selectOptions(screen.getByRole('combobox', { name: /add a skill/i }), 'Attack')

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

    const addControl = screen.getByRole('combobox', { name: /add a skill/i })
    expect(within(addControl).queryByRole('option', { name: 'Attack' })).not.toBeInTheDocument()
  })
})
