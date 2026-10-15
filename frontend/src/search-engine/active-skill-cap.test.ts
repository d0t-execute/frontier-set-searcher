import { describe, expect, it } from 'vitest'
import {
  computeActiveSkillCap,
  countGrankOrLaterPieces,
  determineActiveSkills,
} from './active-skill-cap'
import type { NamedCandidate, NamedSkill } from './load-bundle'

function candidate(category: string, grankOrLater = false): NamedCandidate {
  return { id: `c:${category}`, name: category, category, grankOrLater, skills: [] }
}

function skill(
  id: number,
  overrides: Partial<Omit<NamedSkill, 'id'>> = {},
): NamedSkill {
  return { id, name: `Skill ${id}`, category: null, priorityRank: null, tiers: [], ...overrides }
}

const SKILL_SLOTS_UP_ID = 1000001
const ZENITH_SKILLS: readonly NamedSkill[] = [skill(SKILL_SLOTS_UP_ID, { name: 'Skill Slots Up' })]

describe('countGrankOrLaterPieces', () => {
  it('counts only candidates flagged grankOrLater', () => {
    const picks = new Map([
      ['head', candidate('grank_g', true)],
      ['chest', candidate('zenith_zy', true)],
      ['arms', candidate('standard_plain', false)],
    ])

    expect(countGrankOrLaterPieces(picks)).toBe(2)
  })

  it("doesn't trust category alone -- a mixed-tier category's pieces are judged individually", () => {
    // paid_gachapon mixes below-G-rank and G-Rank-or-later pieces together --
    // see NamedCandidate.grankOrLater's own docstring. The flag, not the
    // category string, is what this function reads.
    const picks = new Map([
      ['head', candidate('paid_gachapon', true)],
      ['chest', candidate('paid_gachapon', false)],
    ])

    expect(countGrankOrLaterPieces(picks)).toBe(1)
  })
})

describe('computeActiveSkillCap', () => {
  it('is 10 with no G-Rank pieces and no Skill Slots Up', () => {
    const picks = new Map([['head', candidate('standard_plain')]])

    expect(computeActiveSkillCap(picks, new Map(), ZENITH_SKILLS)).toBe(10)
  })

  it('adds +1 for 3-4 G-Rank-or-later pieces', () => {
    const picks = new Map([
      ['head', candidate('grank_g', true)],
      ['chest', candidate('grank_g', true)],
      ['arms', candidate('grank_g', true)],
    ])

    expect(computeActiveSkillCap(picks, new Map(), ZENITH_SKILLS)).toBe(11)
  })

  it('adds +2 for 5+ G-Rank-or-later pieces', () => {
    const picks = new Map(
      Array.from({ length: 5 }, (_, i) => [`slot${i}`, candidate('grank_g', true)] as const),
    )

    expect(computeActiveSkillCap(picks, new Map(), ZENITH_SKILLS)).toBe(12)
  })

  it('adds the Skill Slots Up level, capped at +7', () => {
    const picks = new Map([['head', candidate('standard_plain')]])

    expect(
      computeActiveSkillCap(picks, new Map([[SKILL_SLOTS_UP_ID, 4]]), ZENITH_SKILLS),
    ).toBe(14)
    expect(
      computeActiveSkillCap(picks, new Map([[SKILL_SLOTS_UP_ID, 19]]), ZENITH_SKILLS),
    ).toBe(17)
  })

  it('combines the G-Rank bonus and the Skill Slots Up bonus', () => {
    const picks = new Map(
      Array.from({ length: 5 }, (_, i) => [`slot${i}`, candidate('grank_g', true)] as const),
    )

    expect(
      computeActiveSkillCap(picks, new Map([[SKILL_SLOTS_UP_ID, 7]]), ZENITH_SKILLS),
    ).toBe(19)
  })
})

describe('determineActiveSkills', () => {
  const picks = new Map([['head', candidate('standard_plain')]])

  it('treats an untiered skill as active once its points are positive', () => {
    const skills = [skill(1)]
    const result = determineActiveSkills(picks, new Map([[1, 3]]), skills, ZENITH_SKILLS)

    expect(result.rankedActive).toEqual([1])
    expect(result.disabled).toEqual([])
  })

  it('only treats a tiered skill as active once a tier threshold is reached', () => {
    const skills = [skill(1, { tiers: [{ label: 'T1', minPoints: 10, description: null }] })]

    const below = determineActiveSkills(picks, new Map([[1, 5]]), skills, ZENITH_SKILLS)
    expect(below.rankedActive).toEqual([])

    const atThreshold = determineActiveSkills(picks, new Map([[1, 10]]), skills, ZENITH_SKILLS)
    expect(atThreshold.rankedActive).toEqual([1])
  })

  it('activates a negative (penalty) tier once points drop to its threshold', () => {
    const skills = [skill(1, { tiers: [{ label: 'T-10', minPoints: -10, description: null }] })]

    const result = determineActiveSkills(picks, new Map([[1, -10]]), skills, ZENITH_SKILLS)
    expect(result.rankedActive).toEqual([1])
  })

  it('ignores Zenith skill ids entirely, even if present in skillTotals', () => {
    const skills = [skill(1)]
    const skillTotals = new Map([
      [1, 3],
      [SKILL_SLOTS_UP_ID, 2],
    ])

    const result = determineActiveSkills(picks, skillTotals, skills, ZENITH_SKILLS)

    expect(result.rankedActive).toEqual([1])
  })

  it('orders active skills by priority rank, most-protected first', () => {
    const skills = [skill(1, { priorityRank: 50 }), skill(2, { priorityRank: 1 })]
    const skillTotals = new Map([
      [1, 3],
      [2, 3],
    ])

    const result = determineActiveSkills(picks, skillTotals, skills, ZENITH_SKILLS)

    expect(result.rankedActive).toEqual([2, 1])
  })

  it('sorts an unranked skill after every ranked skill', () => {
    const skills = [skill(1, { priorityRank: null }), skill(2, { priorityRank: 193 })]
    const skillTotals = new Map([
      [1, 3],
      [2, 3],
    ])

    const result = determineActiveSkills(picks, skillTotals, skills, ZENITH_SKILLS)

    expect(result.rankedActive).toEqual([2, 1])
  })

  it('force-disables active skills beyond the cap, lowest priority first', () => {
    const skills = Array.from({ length: 11 }, (_, i) => skill(i + 1, { priorityRank: i + 1 }))
    const skillTotals = new Map(skills.map((s) => [s.id, 3]))

    const result = determineActiveSkills(picks, skillTotals, skills, ZENITH_SKILLS)

    expect(result.cap).toBe(10)
    expect(result.rankedActive).toHaveLength(11)
    expect(result.disabled).toEqual([11])
  })
})
