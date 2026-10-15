import { describe, expect, it } from 'vitest'
import { buildSearchQuery, filterOutTowerDecorations } from './build-query'
import type { QueryFormState } from './build-query'
import type { DataBundle, NamedDecoration } from './load-bundle'

function deco(id: string, isTower: boolean): NamedDecoration {
  return { id, name: id, slotSize: 1, skills: [], isTower }
}

const EMPTY_FORM_STATE: QueryFormState = {
  excludedCategories: new Set(),
  excludedCuffCategories: new Set(),
  excludedWeaponZenithSkillIds: new Set(),
  weaponSlotCount: 0,
  pinnedArmor: new Map(),
  pinnedCuffIds: [],
}

const BUNDLE: DataBundle = {
  slots: [{ slotId: 'head', candidates: [] }],
  decorations: [deco('regular', false), deco('tower', true)],
  cuffs: [],
  skills: [],
  zenithSkills: [],
  skillNames: new Map(),
  weaponZenithSkillIds: [],
}

describe('filterOutTowerDecorations', () => {
  it('drops every decoration flagged isTower, keeping the rest', () => {
    const result = filterOutTowerDecorations([deco('a', false), deco('b', true), deco('c', false)])

    expect(result.map((d) => d.id)).toEqual(['a', 'c'])
  })

  it('returns an empty array when every decoration is a Tower Gem', () => {
    expect(filterOutTowerDecorations([deco('a', true)])).toEqual([])
  })
})

describe('buildSearchQuery', () => {
  it("excludes Tower Gems from the decorations it hands to the solver, even though they're in the bundle", () => {
    const query = buildSearchQuery(BUNDLE, EMPTY_FORM_STATE)

    expect(query.decorations.map((d) => d.id)).toEqual(['regular'])
  })
})
