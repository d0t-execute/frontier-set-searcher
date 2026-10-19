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
