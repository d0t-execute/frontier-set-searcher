import { describe, expect, it } from 'vitest'
import { buildSearchQuery, decorationsAfterCategoryFilter } from './build-query'
import type { QueryFormState } from './build-query'
import { TOWER_DECORATION_CATEGORY_KEY } from './decoration-categories'
import type { DataBundle, NamedDecoration } from './load-bundle'

function deco(id: string, isTower: boolean): NamedDecoration {
  return { id, name: id, slotSize: 1, skills: [], isTower }
}

const EMPTY_FORM_STATE: QueryFormState = {
  excludedCategories: new Set(),
  excludedCuffCategories: new Set(),
  excludedDecorationCategories: new Set([TOWER_DECORATION_CATEGORY_KEY]),
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

describe('decorationsAfterCategoryFilter', () => {
  it('drops every decoration flagged isTower when the Tower category is excluded', () => {
    const result = decorationsAfterCategoryFilter(
      [deco('a', false), deco('b', true), deco('c', false)],
      new Set([TOWER_DECORATION_CATEGORY_KEY]),
    )

    expect(result.map((d) => d.id)).toEqual(['a', 'c'])
  })

  it('returns an empty array when every decoration is a Tower Gem and Tower is excluded', () => {
    expect(
      decorationsAfterCategoryFilter([deco('a', true)], new Set([TOWER_DECORATION_CATEGORY_KEY])),
    ).toEqual([])
  })

  it('keeps Tower Gems when the Tower category is not excluded', () => {
    const result = decorationsAfterCategoryFilter([deco('a', false), deco('b', true)], new Set())

    expect(result.map((d) => d.id)).toEqual(['a', 'b'])
  })
})

describe('buildSearchQuery', () => {
  it("excludes Tower Gems from the decorations it hands to the solver, even though they're in the bundle", () => {
    const query = buildSearchQuery(BUNDLE, EMPTY_FORM_STATE)

    expect(query.decorations.map((d) => d.id)).toEqual(['regular'])
  })
})
