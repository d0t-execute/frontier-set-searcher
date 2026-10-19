import { describe, expect, it } from 'vitest'
import {
  buildSearchQuery,
  cuffsAfterExcludedIds,
  decorationsAfterCategoryFilter,
  decorationsAfterExcludedIds,
  resolvePinnedSlotDecorations,
  slotsAfterExcludedIds,
  slotsAfterHunterTypeFilter,
} from './build-query'
import type { QueryFormState } from './build-query'
import type {
  DataBundle,
  HunterType,
  NamedCandidate,
  NamedCuff,
  NamedDecoration,
  NamedSlotQuery,
} from './load-bundle'
import type { SkillContribution } from './types'

function cuffFixture(
  id: string,
  category = 'cuff_standard_tier1',
  skills: readonly SkillContribution[] = [],
): NamedCuff {
  return { id, name: id, slotSize: 1, skills, category }
}

function deco(
  id: string,
  isTower: boolean,
  category = 'deco_standard',
  skills: readonly SkillContribution[] = [],
  isSp = false,
): NamedDecoration {
  return { id, name: id, slotSize: 1, skills, isTower, isSp, category }
}

function candidate(
  id: string,
  hunterType: HunterType,
  openSlotCount = 0,
  skills: readonly SkillContribution[] = [],
): NamedCandidate {
  return {
    id,
    name: id,
    category: 'standard_plain',
    grankOrLater: false,
    hunterType,
    exoticSkillId: null,
    defenseMax: null,
    resistances: { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 },
    skills,
    openSlotCount,
  }
}

const EMPTY_FORM_STATE: QueryFormState = {
  excludedCategories: new Set(),
  excludedCuffCategories: new Set(),
  excludedDecorationCategories: new Set(),
  excludedWeaponZenithSkillIds: new Set(),
  weaponSlotCount: 0,
  hunterTypeFilter: 'blademaster',
  pinnedArmor: new Map(),
  pinnedCuffSlots: [],
  pinnedSlotDecorationIds: new Map(),
  excludedArmorIds: new Set(),
  excludedDecorationIds: new Set(),
  excludedCuffIds: new Set(),
  excludedSkillIds: new Set(),
  preferredArmorIds: new Set(),
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

  it('drops every decoration flagged isSp unconditionally, the same as isTower', () => {
    const result = decorationsAfterCategoryFilter(
      [deco('a', false), deco('b', false, 'deco_sp', [], true), deco('c', false)],
      new Set(),
    )

    expect(result.map((d) => d.id)).toEqual(['a', 'c'])
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

describe('slotsAfterHunterTypeFilter', () => {
  const slots: readonly NamedSlotQuery[] = [
    {
      slotId: 'body',
      candidates: [
        candidate('common', 'common'),
        candidate('blade', 'blademaster'),
        candidate('gun', 'gunner'),
      ],
    },
  ]

  it('keeps common pieces plus only the matching Hunter Type, for blademaster', () => {
    const result = slotsAfterHunterTypeFilter(slots, 'blademaster')
    expect(result[0].candidates.map((c) => c.id)).toEqual(['common', 'blade'])
  })

  it('keeps common pieces plus only the matching Hunter Type, for gunner', () => {
    const result = slotsAfterHunterTypeFilter(slots, 'gunner')
    expect(result[0].candidates.map((c) => c.id)).toEqual(['common', 'gun'])
  })
})

describe('slotsAfterExcludedIds', () => {
  const slots: readonly NamedSlotQuery[] = [
    { slotId: 'body', candidates: [candidate('a', 'common'), candidate('b', 'common')] },
  ]

  it('drops candidates whose id is excluded', () => {
    const result = slotsAfterExcludedIds(slots, new Set(['a']))
    expect(result[0].candidates.map((c) => c.id)).toEqual(['b'])
  })

  it('returns an equivalent copy when nothing is excluded', () => {
    const result = slotsAfterExcludedIds(slots, new Set())
    expect(result[0].candidates.map((c) => c.id)).toEqual(['a', 'b'])
  })
})

describe('decorationsAfterExcludedIds', () => {
  it('drops decorations whose id is excluded', () => {
    const result = decorationsAfterExcludedIds([deco('a', false), deco('b', false)], new Set(['a']))
    expect(result.map((d) => d.id)).toEqual(['b'])
  })
})

describe('cuffsAfterExcludedIds', () => {
  it('drops cuffs whose id is excluded', () => {
    const result = cuffsAfterExcludedIds([cuffFixture('a'), cuffFixture('b')], new Set(['a']))
    expect(result.map((c) => c.id)).toEqual(['b'])
  })
})

describe('buildSearchQuery', () => {
  it("excludes Tower Gems from the decorations it hands to the solver, even though they're in the bundle", () => {
    const query = buildSearchQuery(BUNDLE, EMPTY_FORM_STATE)

    expect(query.decorations.map((d) => d.id)).toEqual(['regular'])
  })

  it('drops candidates of the opposing Hunter Type from the solver pool', () => {
    const bundleWithTypes: DataBundle = {
      ...BUNDLE,
      slots: [
        {
          slotId: 'body',
          candidates: [
            candidate('common', 'common'),
            candidate('blade', 'blademaster'),
            candidate('gun', 'gunner'),
          ],
        },
      ],
    }

    const query = buildSearchQuery(bundleWithTypes, {
      ...EMPTY_FORM_STATE,
      hunterTypeFilter: 'gunner',
    })

    const bodySlot = query.slots.find((s) => s.slotId === 'body')
    expect(bodySlot?.candidates.map((c) => c.id)).toEqual(['common', 'gun'])
  })

  it('resolves pinnedSlotDecorationIds into the pinnedSlotDecorations option', () => {
    const query = buildSearchQuery(BUNDLE, {
      ...EMPTY_FORM_STATE,
      pinnedSlotDecorationIds: new Map([['head', ['regular']]]),
    })

    expect(query.pinnedSlotDecorations.get('head')?.map((d) => d.id)).toEqual(['regular'])
  })

  it('drops an excluded armor piece from the solver pool', () => {
    const bundleWithArmor: DataBundle = {
      ...BUNDLE,
      slots: [{ slotId: 'head', candidates: [candidate('a', 'common'), candidate('b', 'common')] }],
    }
    const query = buildSearchQuery(bundleWithArmor, {
      ...EMPTY_FORM_STATE,
      excludedArmorIds: new Set(['a']),
    })

    expect(query.slots.find((s) => s.slotId === 'head')?.candidates.map((c) => c.id)).toEqual(['b'])
  })

  it('still pins an excluded armor piece into its slot, since a pin always wins', () => {
    const bundleWithArmor: DataBundle = {
      ...BUNDLE,
      slots: [{ slotId: 'head', candidates: [candidate('a', 'common'), candidate('b', 'common')] }],
    }
    const query = buildSearchQuery(bundleWithArmor, {
      ...EMPTY_FORM_STATE,
      excludedArmorIds: new Set(['a']),
      pinnedArmor: new Map([['head', { candidateId: 'a', decorationIds: [] }]]),
    })

    const headSlot = query.slots.find((s) => s.slotId === 'head')
    expect(headSlot?.candidates.map((c) => c.id)).toEqual(['a'])
  })

  it('drops an excluded decoration from the solver pool', () => {
    const query = buildSearchQuery(BUNDLE, {
      ...EMPTY_FORM_STATE,
      excludedDecorationIds: new Set(['regular']),
    })

    expect(query.decorations.map((d) => d.id)).toEqual([])
  })

  it('still bakes an excluded decoration into a slot pin, since a pin always wins', () => {
    const bundleWithArmor: DataBundle = {
      ...BUNDLE,
      slots: [{ slotId: 'head', candidates: [candidate('a', 'common', 1)] }],
    }
    const query = buildSearchQuery(bundleWithArmor, {
      ...EMPTY_FORM_STATE,
      excludedDecorationIds: new Set(['regular']),
      pinnedArmor: new Map([['head', { candidateId: 'a', decorationIds: ['regular'] }]]),
    })

    const headSlot = query.slots.find((s) => s.slotId === 'head')
    expect(headSlot?.candidates[0]?.name).toContain('regular')
  })

  it('still resolves an excluded decoration forced into a slot without a piece pin', () => {
    const query = buildSearchQuery(BUNDLE, {
      ...EMPTY_FORM_STATE,
      excludedDecorationIds: new Set(['regular']),
      pinnedSlotDecorationIds: new Map([['head', ['regular']]]),
    })

    expect(query.pinnedSlotDecorations.get('head')?.map((d) => d.id)).toEqual(['regular'])
  })

  it('drops an excluded cuff from the free pool but keeps resolving it when pinned', () => {
    const bundleWithCuffs: DataBundle = {
      ...BUNDLE,
      cuffs: [cuffFixture('a'), cuffFixture('b')],
    }
    const query = buildSearchQuery(bundleWithCuffs, {
      ...EMPTY_FORM_STATE,
      excludedCuffIds: new Set(['a']),
      pinnedCuffSlots: [{ mode: 'exact', cuffId: 'a' }],
    })

    expect(query.cuffs.map((c) => c.id)).toEqual(['b'])
    expect(query.pinnedCuffs.map((c) => c.id)).toEqual(['a'])
  })

  it("doesn't drop any piece/decoration/cuff that grants an excluded skill from the solver pool (TODO #37: a hard solver constraint, not a pool filter)", () => {
    const bundleWithSkills: DataBundle = {
      ...BUNDLE,
      slots: [
        {
          slotId: 'head',
          candidates: [
            candidate('a', 'common', 0, [{ skillId: 1, points: 5 }]),
            candidate('b', 'common'),
          ],
        },
      ],
      decorations: [
        deco('regular', false, 'deco_standard', [{ skillId: 1, points: 3 }]),
        deco('tower', true),
      ],
      cuffs: [cuffFixture('a', undefined, [{ skillId: 1, points: 5 }]), cuffFixture('b')],
    }
    const query = buildSearchQuery(bundleWithSkills, {
      ...EMPTY_FORM_STATE,
      excludedSkillIds: new Set(['1']),
    })

    expect(query.slots.find((s) => s.slotId === 'head')?.candidates.map((c) => c.id)).toEqual([
      'a',
      'b',
    ])
    expect(query.decorations.map((d) => d.id)).toEqual(['regular'])
    expect(query.cuffs.map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('parses excludedSkillIds into numeric excludedActiveSkillIds for the solver', () => {
    const query = buildSearchQuery(BUNDLE, {
      ...EMPTY_FORM_STATE,
      excludedSkillIds: new Set(['1', '2']),
    })

    expect(query.excludedActiveSkillIds).toEqual([1, 2])
  })

  it('passes preferredArmorIds straight through as preferredCandidateIds (docs/feedback.md Round 2 #2)', () => {
    const query = buildSearchQuery(BUNDLE, {
      ...EMPTY_FORM_STATE,
      preferredArmorIds: new Set(['head:0001']),
    })

    expect(query.preferredCandidateIds).toEqual(new Set(['head:0001']))
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
    const resolved = resolvePinnedSlotDecorations(
      decorations,
      new Map([['head', ['gone']]]),
      new Map(),
    )

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
