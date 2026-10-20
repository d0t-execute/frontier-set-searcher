import { describe, expect, it } from 'vitest'
import {
  GEAR_CATEGORY_GROUPS,
  GEAR_LEVEL_GRANK_CATEGORIES,
  GEAR_LEVEL_PRE_GRANK_CATEGORIES,
  GEAR_LEVEL_ZENITH_CATEGORIES,
} from './gear-categories'

describe('gear-level category partition', () => {
  it('covers every leaf category exactly once across Pre-G-Rank/G-Rank/Zenith', () => {
    const allLeafKeys = GEAR_CATEGORY_GROUPS.flatMap((group) => group.categories.map((c) => c.key))
    const combined = [
      ...GEAR_LEVEL_PRE_GRANK_CATEGORIES,
      ...GEAR_LEVEL_GRANK_CATEGORIES,
      ...GEAR_LEVEL_ZENITH_CATEGORIES,
    ]

    expect(new Set(combined)).toEqual(new Set(allLeafKeys))
    expect(combined).toHaveLength(allLeafKeys.length)
  })

  it('does not overlap between G-Rank and Zenith', () => {
    const grank = new Set(GEAR_LEVEL_GRANK_CATEGORIES)
    const overlap = GEAR_LEVEL_ZENITH_CATEGORIES.filter((key) => grank.has(key))

    expect(overlap).toEqual([])
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
