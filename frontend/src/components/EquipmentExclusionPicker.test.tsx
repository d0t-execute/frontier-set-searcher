import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EquipmentExclusionPicker } from './EquipmentExclusionPicker'

const armorCandidates = [
  { id: 'head:0001', name: 'Leather Helm', skills: [{ skillId: 1, points: 5 }] },
]
const decorations = [{ id: 'D001', name: 'Attack Jewel', skills: [{ skillId: 2, points: 3 }] }]
const cuffs = [{ id: 'cuff:0001', name: 'Sharpening PC1', skills: [{ skillId: 1, points: 5 }] }]
const skills = [
  { id: '1', name: 'Attack' },
  { id: '2', name: 'Sharpening' },
]

const skillNameById = new Map([
  [1, 'Attack'],
  [2, 'Sharpening'],
])

const skillSearchTextById = new Map([
  [1, 'attack expert'],
  [2, 'sharpening artisan'],
])

function renderPicker(onChangeExcludedArmorIds = vi.fn(), onChangeExcludedSkillIds = vi.fn()) {
  return render(
    <EquipmentExclusionPicker
      armorCandidates={armorCandidates}
      decorations={decorations}
      cuffs={cuffs}
      skills={skills}
      excludedArmorIds={new Set()}
      onChangeExcludedArmorIds={onChangeExcludedArmorIds}
      excludedDecorationIds={new Set()}
      onChangeExcludedDecorationIds={vi.fn()}
      excludedCuffIds={new Set()}
      onChangeExcludedCuffIds={vi.fn()}
      excludedSkillIds={new Set()}
      onChangeExcludedSkillIds={onChangeExcludedSkillIds}
      skillNameById={skillNameById}
      skillSearchTextById={skillSearchTextById}
    />,
  )
}

describe('EquipmentExclusionPicker', () => {
  it('shows the skills an item grants as a hover tooltip on its search option', () => {
    renderPicker()

    fireEvent.change(screen.getByLabelText('Search armor pieces to exclude'), {
      target: { value: 'Leather' },
    })

    expect(screen.getByRole('option', { name: 'Leather Helm' })).toHaveAttribute(
      'title',
      'Attack: 5',
    )
  })

  it('shows the skills an already-excluded item grants as a hover tooltip on its badge', () => {
    render(
      <EquipmentExclusionPicker
        armorCandidates={armorCandidates}
        decorations={decorations}
        cuffs={cuffs}
        skills={skills}
        excludedArmorIds={new Set(['head:0001'])}
        onChangeExcludedArmorIds={vi.fn()}
        excludedDecorationIds={new Set()}
        onChangeExcludedDecorationIds={vi.fn()}
        excludedCuffIds={new Set()}
        onChangeExcludedCuffIds={vi.fn()}
        excludedSkillIds={new Set()}
        onChangeExcludedSkillIds={vi.fn()}
        skillNameById={skillNameById}
        skillSearchTextById={skillSearchTextById}
      />,
    )

    expect(screen.getByText('Leather Helm')).toHaveAttribute('title', 'Attack: 5')
  })

  it('keeps the search field populated after picking, to make multi-selecting easy', () => {
    renderPicker()

    const search = screen.getByLabelText('Search armor pieces to exclude')
    fireEvent.change(search, { target: { value: 'Leather' } })
    fireEvent.click(screen.getByRole('option', { name: 'Leather Helm' }))

    expect(search).toHaveValue('Leather')
  })

  it("matches an armor piece by one of its granted skill's tier labels (docs/feedback.md Round 2 #8)", () => {
    renderPicker()

    fireEvent.change(screen.getByLabelText('Search armor pieces to exclude'), {
      target: { value: 'attack expert' },
    })

    expect(screen.getByRole('option', { name: 'Leather Helm' })).toBeInTheDocument()
  })

  it('matches a skill in the Skills list by its own tier label, not just its name', () => {
    renderPicker()

    fireEvent.change(screen.getByLabelText('Search skills to exclude'), {
      target: { value: 'sharpening artisan' },
    })

    expect(screen.getByRole('option', { name: 'Sharpening' })).toBeInTheDocument()
  })

  describe('hover skill summary (armor/decorations/cuffs)', () => {
    it('shows a prompt to hover a result before anything is hovered', () => {
      renderPicker()

      fireEvent.change(screen.getByLabelText('Search armor pieces to exclude'), {
        target: { value: 'Leather' },
      })

      expect(screen.getByText('Hover a result to see its skills.')).toBeInTheDocument()
    })

    it("shows the hovered item's skills in a persistent summary line below the results", () => {
      renderPicker()

      fireEvent.change(screen.getByLabelText('Search armor pieces to exclude'), {
        target: { value: 'Leather' },
      })
      fireEvent.mouseEnter(screen.getByRole('option', { name: 'Leather Helm' }))

      expect(screen.getByText('Attack: 5')).toBeInTheDocument()

      fireEvent.mouseLeave(screen.getByRole('option', { name: 'Leather Helm' }))

      expect(screen.getByText('Hover a result to see its skills.')).toBeInTheDocument()
    })

    it('highlights the searched-for skill in the hovered summary line', () => {
      renderPicker()

      fireEvent.change(screen.getByLabelText('Search armor pieces to exclude'), {
        target: { value: 'Attack' },
      })
      fireEvent.mouseEnter(screen.getByRole('option', { name: 'Leather Helm' }))

      const mark = screen.getByText('Attack: 5', { selector: 'mark' })
      expect(mark.tagName).toBe('MARK')
    })

    it('does not render a hover-skill-summary line for the Skills list', () => {
      renderPicker()

      fireEvent.change(screen.getByLabelText('Search skills to exclude'), {
        target: { value: 'Sharp' },
      })

      expect(screen.queryByText('Hover a result to see its skills.')).not.toBeInTheDocument()
    })
  })

  describe('search by skill name (armor/decorations/cuffs)', () => {
    it('matches an armor piece by a skill it grants, not just its own name', () => {
      renderPicker()

      fireEvent.change(screen.getByLabelText('Search armor pieces to exclude'), {
        target: { value: 'Attack' },
      })

      expect(screen.getByRole('option', { name: 'Leather Helm' })).toBeInTheDocument()
    })

    it('matches a cuff by a skill it grants, not just its own name', () => {
      renderPicker()

      fireEvent.change(screen.getByLabelText('Search cuffs to exclude'), {
        target: { value: 'Attack' },
      })

      expect(screen.getByRole('option', { name: 'Sharpening PC1' })).toBeInTheDocument()
    })

    it('matches a decoration by a skill it grants, not just its own name', () => {
      render(
        <EquipmentExclusionPicker
          armorCandidates={armorCandidates}
          decorations={[{ id: 'D002', name: 'Lucky Charm', skills: [{ skillId: 2, points: 3 }] }]}
          cuffs={cuffs}
          skills={skills}
          excludedArmorIds={new Set()}
          onChangeExcludedArmorIds={vi.fn()}
          excludedDecorationIds={new Set()}
          onChangeExcludedDecorationIds={vi.fn()}
          excludedCuffIds={new Set()}
          onChangeExcludedCuffIds={vi.fn()}
          excludedSkillIds={new Set()}
          onChangeExcludedSkillIds={vi.fn()}
          skillNameById={skillNameById}
          skillSearchTextById={skillSearchTextById}
        />,
      )

      fireEvent.change(screen.getByLabelText('Search decorations to exclude'), {
        target: { value: 'Sharp' },
      })

      expect(screen.getByRole('option', { name: 'Lucky Charm' })).toBeInTheDocument()
    })

    it('excludes a piece found via skill-name search once picked', () => {
      const onChangeExcludedArmorIds = vi.fn()
      renderPicker(onChangeExcludedArmorIds)

      fireEvent.change(screen.getByLabelText('Search armor pieces to exclude'), {
        target: { value: 'Attack' },
      })
      fireEvent.click(screen.getByRole('option', { name: 'Leather Helm' }))

      expect(onChangeExcludedArmorIds).toHaveBeenCalledWith(new Set(['head:0001']))
    })

    it('excludes the top match found via skill-name search when Enter is pressed', async () => {
      const onChangeExcludedArmorIds = vi.fn()
      const user = userEvent.setup()
      renderPicker(onChangeExcludedArmorIds)

      await user.type(screen.getByLabelText('Search armor pieces to exclude'), 'Attack{Enter}')

      expect(onChangeExcludedArmorIds).toHaveBeenCalledWith(new Set(['head:0001']))
    })
  })

  describe('keyboard-only picking', () => {
    it('excludes the top-matching item when Enter is pressed in the search', async () => {
      const onChangeExcludedArmorIds = vi.fn()
      const user = userEvent.setup()
      renderPicker(onChangeExcludedArmorIds)

      await user.type(screen.getByLabelText('Search armor pieces to exclude'), 'Leather{Enter}')

      expect(onChangeExcludedArmorIds).toHaveBeenCalledWith(new Set(['head:0001']))
    })

    it('does nothing on Enter when there is no match in the search', async () => {
      const onChangeExcludedArmorIds = vi.fn()
      const user = userEvent.setup()
      renderPicker(onChangeExcludedArmorIds)

      await user.type(screen.getByLabelText('Search armor pieces to exclude'), 'zzz{Enter}')

      expect(onChangeExcludedArmorIds).not.toHaveBeenCalled()
    })
  })

  describe('skills', () => {
    it('shows a skill in its search results by name', () => {
      renderPicker()

      fireEvent.change(screen.getByLabelText('Search skills to exclude'), {
        target: { value: 'Sharp' },
      })

      expect(screen.getByRole('option', { name: 'Sharpening' })).toBeInTheDocument()
    })

    it('excludes a skill by id once picked', () => {
      const onChangeExcludedSkillIds = vi.fn()
      renderPicker(undefined, onChangeExcludedSkillIds)

      fireEvent.change(screen.getByLabelText('Search skills to exclude'), {
        target: { value: 'Sharp' },
      })
      fireEvent.click(screen.getByRole('option', { name: 'Sharpening' }))

      expect(onChangeExcludedSkillIds).toHaveBeenCalledWith(new Set(['2']))
    })

    it('shows an already-excluded skill as a badge by name', () => {
      render(
        <EquipmentExclusionPicker
          armorCandidates={armorCandidates}
          decorations={decorations}
          cuffs={cuffs}
          skills={skills}
          excludedArmorIds={new Set()}
          onChangeExcludedArmorIds={vi.fn()}
          excludedDecorationIds={new Set()}
          onChangeExcludedDecorationIds={vi.fn()}
          excludedCuffIds={new Set()}
          onChangeExcludedCuffIds={vi.fn()}
          excludedSkillIds={new Set(['2'])}
          onChangeExcludedSkillIds={vi.fn()}
          skillNameById={skillNameById}
          skillSearchTextById={skillSearchTextById}
        />,
      )

      expect(screen.getByText('Sharpening')).toBeInTheDocument()
    })

    it('excludes the top-matching skill when Enter is pressed in the search', async () => {
      const onChangeExcludedSkillIds = vi.fn()
      const user = userEvent.setup()
      renderPicker(undefined, onChangeExcludedSkillIds)

      await user.type(screen.getByLabelText('Search skills to exclude'), 'Sharp{Enter}')

      expect(onChangeExcludedSkillIds).toHaveBeenCalledWith(new Set(['2']))
    })
  })
})
