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
    />,
  )
}

describe('EquipmentExclusionPicker', () => {
  it('shows the skills an item grants as a hover tooltip on its search option', () => {
    renderPicker()

    fireEvent.change(screen.getByLabelText('Search armor pieces to exclude'), {
      target: { value: 'Leather' },
    })

    expect(screen.getByRole('option', { name: 'Leather Helm' })).toHaveAttribute('title', 'Attack: 5')
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
      />,
    )

    expect(screen.getByText('Leather Helm')).toHaveAttribute('title', 'Attack: 5')
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
      fireEvent.change(screen.getByLabelText('Skills matching search'), {
        target: { value: '2' },
      })

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
