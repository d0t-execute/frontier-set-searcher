import { describe, expect, it } from 'vitest'
import {
  GEAR_CATEGORY_GROUPS,
  GEAR_LEVEL_GRANK_CATEGORIES,
  GEAR_LEVEL_PRE_GRANK_CATEGORIES,
  GEAR_LEVEL_ZENITH_CATEGORIES,
  GEAR_LEVEL_ZP_CATEGORIES,
} from './gear-categories'

describe('gear-level category partition', () => {
  it('covers every leaf category exactly once across Pre-G-Rank/G-Rank/Zenith/ZP', () => {
    const allLeafKeys = GEAR_CATEGORY_GROUPS.flatMap((group) => group.categories.map((c) => c.key))
    const combined = [
      ...GEAR_LEVEL_PRE_GRANK_CATEGORIES,
      ...GEAR_LEVEL_GRANK_CATEGORIES,
      ...GEAR_LEVEL_ZENITH_CATEGORIES,
      ...GEAR_LEVEL_ZP_CATEGORIES,
    ]

    expect(new Set(combined)).toEqual(new Set(allLeafKeys))
    expect(combined).toHaveLength(allLeafKeys.length)
  })

  it('does not overlap between G-Rank, Zenith, and ZP', () => {
    const grank = new Set(GEAR_LEVEL_GRANK_CATEGORIES)
    const zenith = new Set(GEAR_LEVEL_ZENITH_CATEGORIES)

    expect(GEAR_LEVEL_ZENITH_CATEGORIES.filter((key) => grank.has(key))).toEqual([])
    expect(GEAR_LEVEL_ZP_CATEGORIES.filter((key) => grank.has(key))).toEqual([])
    expect(GEAR_LEVEL_ZP_CATEGORIES.filter((key) => zenith.has(key))).toEqual([])
  })
})

describe('Exotic leaves (2026-10-20: only the plain leaf is Pre-G-Rank / moved under Standard Armor)', () => {
  const preGrankExoticKeys = ['grank_exotic']
  const grankExoticKeys = ['grank_exotic_g', 'grank_exotic_gf', 'grank_exotic_gx']

  it("the plain leaf is classified Pre-G-Rank; its G/GF/GX tiers stay G-Rank", () => {
    for (const key of preGrankExoticKeys) {
      expect(GEAR_LEVEL_GRANK_CATEGORIES).not.toContain(key)
      expect(GEAR_LEVEL_PRE_GRANK_CATEGORIES).toContain(key)
    }
    for (const key of grankExoticKeys) {
      expect(GEAR_LEVEL_GRANK_CATEGORIES).toContain(key)
      expect(GEAR_LEVEL_PRE_GRANK_CATEGORIES).not.toContain(key)
    }
    expect(GEAR_LEVEL_GRANK_CATEGORIES).not.toContain('paid_gachapon_exotic')
    expect(GEAR_LEVEL_PRE_GRANK_CATEGORIES).toContain('paid_gachapon_exotic')
  })

  it('the plain leaf lives under Standard Armor; its G/GF/GX tiers stay under G Rank Armor', () => {
    const standardArmor = GEAR_CATEGORY_GROUPS.find((g) => g.label === 'Standard Armor')
    const gRankArmor = GEAR_CATEGORY_GROUPS.find((g) => g.label === 'G Rank Armor')

    for (const key of preGrankExoticKeys) {
      expect(standardArmor?.categories.map((c) => c.key)).toContain(key)
      expect(gRankArmor?.categories.map((c) => c.key)).not.toContain(key)
    }
    for (const key of grankExoticKeys) {
      expect(gRankArmor?.categories.map((c) => c.key)).toContain(key)
      expect(standardArmor?.categories.map((c) => c.key)).not.toContain(key)
    }
  })
})

describe('gear category sections (third tree level)', () => {
  it("every sectioned group's flat categories exactly match the union of its sections", () => {
    for (const group of GEAR_CATEGORY_GROUPS) {
      if (!group.sections) continue

      const fromSections = group.sections.flatMap((section) => section.categories.map((c) => c.key))
      const flat = group.categories.map((c) => c.key)

      expect(fromSections).toEqual(flat)
    }
  })

  it('has at least one sectioned group (the feature is actually in use)', () => {
    expect(GEAR_CATEGORY_GROUPS.some((group) => group.sections)).toBe(true)
  })
})
