import { describe, expect, it } from 'vitest'
import { rankName, rankNameOrSkills, rankSkillText, rankedMatches } from './search-rank'
import { firstMatch } from './pick-first-match'

// Skill search texts in the same shape App.tsx builds them: the skill's own
// name, then its tier labels, joined by spaces and lowercased.
const ATTACK = 'attack attack up (small) attack up (medium) attack up (large)'
const STRONG_ATTACK = 'strong attack strong attack +1 strong attack +2'
const COOKING = 'cooking bbq master'

describe('rankName', () => {
  it('treats separators like hyphens and ・ as spaces', () => {
    expect(rankName('G Attack・Vamp', 'g-attack')).toBe(1)
    expect(rankName('G Attack・Vamp', 'g attack')).toBe(1)
  })

  it('ranks exact, then start, then word start, then anywhere', () => {
    expect(rankName('Attack', 'attack')).toBe(0)
    expect(rankName('Attack Gem Ⅲ', 'attack')).toBe(1)
    expect(rankName('Fire Attack Gem Ⅰ', 'attack')).toBe(2)
    expect(rankName('Counterattack', 'attack')).toBe(3)
    expect(rankName('Defense Gem', 'attack')).toBe(false)
  })

  it('matches query words in order with other words between them, ranked last', () => {
    expect(rankName('G Attack・Rush', 'g rush')).toBe(4)
    expect(rankName('G Attack・Rush', 'g att ru')).toBe(4)
    expect(rankName('Fire Attack Gem Ⅰ', 'fire gem')).toBe(4)
  })

  it('needs every query word to start a name word, in order', () => {
    expect(rankName('G Attack・Rush', 'rush g')).toBe(false)
    expect(rankName('G Attack・Rush', 'g ush')).toBe(false)
    expect(rankName('G Attack・Rush', 'g rush rush')).toBe(false)
    expect(rankName('Attack Gem Ⅲ', 'g rush')).toBe(false)
  })
})

describe('rankSkillText', () => {
  it('never matches a query containing a word the skill does not have', () => {
    expect(rankSkillText(ATTACK, 'g attack')).toBe(false)
    expect(rankSkillText(STRONG_ATTACK, 'g attack')).toBe(false)
  })

  it('ranks a skill whose own name starts with the query above a later-word match', () => {
    expect(rankSkillText(ATTACK, 'attack')).toBe(0)
    expect(rankSkillText(STRONG_ATTACK, 'attack')).toBe(1)
  })

  it('still matches a tier label', () => {
    expect(rankSkillText(COOKING, 'bbq')).not.toBe(false)
  })

  it('no longer matches mid-word', () => {
    expect(rankSkillText(ATTACK, 'ttack')).toBe(false)
  })
})

describe('rankNameOrSkills', () => {
  it('ranks every name match above every skill match', () => {
    const worstName = rankNameOrSkills('Counterattack', [], 'attack')
    const bestSkill = rankNameOrSkills('Power Jewel', [ATTACK], 'attack')
    expect(worstName).not.toBe(false)
    expect(bestSkill).not.toBe(false)
    expect(worstName as number).toBeLessThan(bestSkill as number)
  })
})

describe('the "G attack" bug report', () => {
  const decorations = [
    { id: '1', name: 'Power Jewel', skills: [ATTACK] },
    { id: '2', name: 'Brute Jewel', skills: [STRONG_ATTACK] },
    { id: '3', name: 'G Attack・Vamp', skills: [ATTACK] },
    { id: '4', name: 'G Rage・Attack', skills: [ATTACK] },
    { id: '5', name: 'Attack Gem Ⅲ', skills: [ATTACK] },
  ]
  const matches = (d: (typeof decorations)[number], q: string) =>
    rankNameOrSkills(d.name, d.skills, q)

  it('"g attack" finds the G Attack series first, never a skill-only match', () => {
    expect(rankedMatches(decorations, 'g attack', matches).map((d) => d.name)).toEqual([
      'G Attack・Vamp',
      'G Rage・Attack',
    ])
    expect(firstMatch(decorations, 'G attack', matches)?.name).toBe('G Attack・Vamp')
  })

  it('"attack" lists name matches first, then Attack before Strong Attack', () => {
    expect(rankedMatches(decorations, 'attack', matches).map((d) => d.name)).toEqual([
      'Attack Gem Ⅲ',
      'G Attack・Vamp',
      'G Rage・Attack',
      'Power Jewel',
      'Brute Jewel',
    ])
    expect(firstMatch(decorations, 'attack', matches)?.name).toBe('Attack Gem Ⅲ')
  })
})
