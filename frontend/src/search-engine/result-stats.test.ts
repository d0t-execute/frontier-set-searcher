import { describe, expect, it } from 'vitest'
import type { NamedCandidate, NamedResistances } from './load-bundle'
import { computeResultStats, resistanceScore } from './result-stats'

function resistances(overrides: Partial<NamedResistances> = {}): NamedResistances {
  return { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0, ...overrides }
}

function candidate(overrides: Partial<NamedCandidate> = {}): NamedCandidate {
  return {
    id: 'c:1',
    name: 'Piece',
    category: 'standard_plain',
    grankOrLater: false,
    hunterType: 'common',
    exoticSkillId: null,
    defenseMax: null,
    resistances: resistances(),
    skills: [],
    ...overrides,
  }
}

describe('resistanceScore', () => {
  it('averages all five resistances when none are negative', () => {
    const score = resistanceScore(
      resistances({ fire: 5, water: 10, thunder: 0, ice: 0, dragon: 0 }),
    )

    expect(score).toBeCloseTo((5 + 10) / 5)
  })

  it('weighs a negative resistance several times more heavily than a positive one', () => {
    // docs/feedback.md Round 2 #3, confirmed 2026-10-19: "penalize negative
    // values strongly." A -5 should hurt the score more than a +5 of the
    // same build would help it.
    const positiveScore = resistanceScore(resistances({ fire: 5 }))
    const negativeScore = resistanceScore(resistances({ fire: -5 }))

    expect(negativeScore).toBeLessThan(-positiveScore)
  })

  it('sorts a build with one bad negative resistance below one with merely mediocre positives', () => {
    const mediocre = resistances({ fire: 2, water: 2, thunder: 2, ice: 2, dragon: 2 })
    const oneBadNegative = resistances({ fire: 15, water: 0, thunder: 0, ice: 0, dragon: -15 })

    expect(resistanceScore(oneBadNegative)).toBeLessThan(resistanceScore(mediocre))
  })
})

describe('computeResultStats', () => {
  it('sums defense and resistances across every pick', () => {
    const picks = new Map([
      ['head', candidate({ defenseMax: 100, resistances: resistances({ fire: 5 }) })],
      ['chest', candidate({ defenseMax: 150, resistances: resistances({ fire: 3, water: -2 }) })],
    ])

    const stats = computeResultStats(picks, new Map(), [], [], [])

    expect(stats.totalDefense).toBe(250)
    expect(stats.resistances).toEqual(resistances({ fire: 8, water: -2 }))
  })

  it('reports disabledCount from the active-skill cap', () => {
    const picks = new Map([['head', candidate()]])

    const stats = computeResultStats(picks, new Map(), [], [], [])

    expect(stats.disabledCount).toBe(0)
  })
})
