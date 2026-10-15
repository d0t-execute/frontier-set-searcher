import { describe, expect, it } from 'vitest'
import {
  buildSearchQuery,
  decorationsAfterCategoryFilter,
  resolvePinnedSlotDecorations,
} from './build-query'
import type { QueryFormState } from './build-query'
import type { DataBundle, NamedDecoration } from './load-bundle'

function deco(id: string, isTower: boolean, category = 'deco_standard'): NamedDecoration {
  return { id, name: id, slotSize: 1, skills: [], isTower, category }
}

const EMPTY_FORM_STATE: QueryFormState = {
  excludedCategories: new Set(),
  excludedCuffCategories: new Set(),
  excludedDecorationCategories: new Set(),
  excludedWeaponZenithSkillIds: new Set(),
  weaponSlotCount: 0,
  pinnedArmor: new Map(),
  pinnedCuffIds: [],
  pinnedSlotDecorationIds: new Map(),
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
  it('drops every decoration flagged isTower unconditionally, even with no categories excluded', () => {
    const result = decorationsAfterCategoryFilter(
      [deco('a', false), deco('b', true), deco('c', false)],
      new Set(),
    )

    expect(result.map((d) => d.id)).toEqual(['a', 'c'])
  })

  it('returns an empty array when every decoration is a Tower Gem', () => {
    expect(decorationsAfterCategoryFilter([deco('a', true)], new Set())).toEqual([])
  })

  it('drops decorations whose own category is excluded, independent of isTower', () => {
    const result = decorationsAfterCategoryFilter(
      [
        deco('a', false, 'deco_standard'),
        deco('b', false, 'deco_musou_elzelion'),
        deco('c', false, 'deco_keoaruboru'),
      ],
      new Set(['deco_musou_elzelion']),
    )

    expect(result.map((d) => d.id)).toEqual(['a', 'c'])
  })

  it('applies both the Tower check and the category check together', () => {
    const result = decorationsAfterCategoryFilter(
      [
        deco('a', false, 'deco_standard'),
        deco('b', true, 'deco_tower'),
        deco('c', false, 'deco_keoaruboru'),
      ],
      new Set(['deco_keoaruboru']),
    )

    expect(result.map((d) => d.id)).toEqual(['a'])
  })
})

describe('buildSearchQuery', () => {
  it("excludes Tower Gems from the decorations it hands to the solver, even though they're in the bundle", () => {
    const query = buildSearchQuery(BUNDLE, EMPTY_FORM_STATE)

    expect(query.decorations.map((d) => d.id)).toEqual(['regular'])
  })

  it('resolves pinnedSlotDecorationIds into the pinnedSlotDecorations option', () => {
    const query = buildSearchQuery(BUNDLE, {
      ...EMPTY_FORM_STATE,
      pinnedSlotDecorationIds: new Map([['head', ['regular']]]),
    })

    expect(query.pinnedSlotDecorations.get('head')?.map((d) => d.id)).toEqual(['regular'])
  })
})

describe('resolvePinnedSlotDecorations', () => {
  const decorations = [deco('a', false), deco('b', false)]

  it('resolves ids to their full decoration data, duplicates preserved', () => {
    const resolved = resolvePinnedSlotDecorations(
      decorations,
      new Map([['head', ['a', 'a', 'b']]]),
      new Map(),
    )

    expect(resolved.get('head')?.map((d) => d.id)).toEqual(['a', 'a', 'b'])
  })

  it('drops ids that no longer resolve in the catalog', () => {
    const resolved = resolvePinnedSlotDecorations(
      decorations,
      new Map([['head', ['a', 'gone']]]),
      new Map(),
    )

    expect(resolved.get('head')?.map((d) => d.id)).toEqual(['a'])
  })

  it('omits a slot entirely once every one of its ids fails to resolve', () => {
    const resolved = resolvePinnedSlotDecorations(decorations, new Map([['head', ['gone']]]), new Map())

    expect(resolved.has('head')).toBe(false)
  })

  it('ignores a slot that already has a full piece pin', () => {
    const resolved = resolvePinnedSlotDecorations(
      decorations,
      new Map([['head', ['a']]]),
      new Map([['head', { candidateId: 'head:0001', decorationIds: [] }]]),
    )

    expect(resolved.has('head')).toBe(false)
  })
})
