import { describe, expect, it } from 'vitest'
import { filterRelevantDecorations } from './expand'
import type { Decoration, SkillRequirement } from './types'

function deco(id: string, skills: Record<number, number>): Decoration {
  return {
    id,
    slotSize: 1,
    skills: Object.entries(skills).map(([skillId, points]) => ({
      skillId: Number(skillId),
      points,
    })),
  }
}

describe('filterRelevantDecorations', () => {
  it('keeps a decoration that contributes to a requested skill', () => {
    const attack = deco('Attack Jewel', { 1: 3 })
    const requirements: SkillRequirement[] = [{ skillId: 1, minPoints: 1 }]

    expect(filterRelevantDecorations([attack], requirements)).toEqual([attack])
  })

  it('drops a decoration that contributes to none of the requested skills', () => {
    const irrelevant = deco('Gathering Jewel', { 99: 3 })
    const requirements: SkillRequirement[] = [{ skillId: 1, minPoints: 1 }]

    expect(filterRelevantDecorations([irrelevant], requirements)).toEqual([])
  })

  it('keeps a decoration whose skills include at least one requested skill, even alongside others', () => {
    const mixed = deco('Mixed Jewel', { 1: 3, 99: 5 })
    const requirements: SkillRequirement[] = [{ skillId: 1, minPoints: 1 }]

    expect(filterRelevantDecorations([mixed], requirements)).toEqual([mixed])
  })

  it('returns an empty array when there are no requirements', () => {
    const attack = deco('Attack Jewel', { 1: 3 })

    expect(filterRelevantDecorations([attack], [])).toEqual([])
  })
})
