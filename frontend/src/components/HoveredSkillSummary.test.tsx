import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HoveredSkillSummary } from './HoveredSkillSummary'

describe('HoveredSkillSummary', () => {
  const skillNameById = new Map([[1, 'Cooking']])

  it('highlights a skill matched by its own name', () => {
    render(
      <HoveredSkillSummary
        hovered={{ skills: [{ skillId: 1, points: 10 }] }}
        skillNameById={skillNameById}
        query="cooking"
      />,
    )
    expect(screen.getByText('Cooking: 10').tagName).toBe('MARK')
  })

  it(
    'highlights a skill matched by a tier/threshold label (e.g. "BBQ Master"), not just its own ' +
      'name, when given a skillSearchTextById map (2026-10-20, per the project owner)',
    () => {
      const skillSearchTextById = new Map([[1, 'cooking bbq master']])
      render(
        <HoveredSkillSummary
          hovered={{ skills: [{ skillId: 1, points: 10 }] }}
          skillNameById={skillNameById}
          skillSearchTextById={skillSearchTextById}
          query="bbq"
        />,
      )
      expect(screen.getByText('Cooking: 10').tagName).toBe('MARK')
    },
  )

  it('falls back to matching only the skill name when no skillSearchTextById is given', () => {
    render(
      <HoveredSkillSummary
        hovered={{ skills: [{ skillId: 1, points: 10 }] }}
        skillNameById={skillNameById}
        query="bbq"
      />,
    )
    expect(screen.getByText('Cooking: 10').tagName).not.toBe('MARK')
  })
})
