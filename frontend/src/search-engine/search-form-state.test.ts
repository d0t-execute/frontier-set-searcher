import { afterEach, describe, expect, it } from 'vitest'
import { loadSearchFormState, saveSearchFormState } from './search-form-state'
import type { SearchFormState } from './search-form-state'

const STATE: SearchFormState = {
  requirements: [{ skillId: 1, minPoints: 10 }],
  zenithRequirements: [{ skillId: 1000001, minPoints: 1 }],
  excludedCategories: ['equip_unavailable'],
  excludedCuffCategories: ['cuff_standard_unavailable'],
  excludedDecorationCategories: ['tower'],
  excludedWeaponZenithSkillIds: null,
  weaponSlotCount: 2,
  hunterTypeFilter: 'gunner',
  pinnedArmor: [['head', { candidateId: 'head:0001', decorationIds: ['D001'] }]],
  pinnedCuffIds: ['cuff:C001'],
  pinnedSlotDecorationIds: [['chest', ['D002', 'D002']]],
  excludedArmorIds: ['head:0002'],
  excludedDecorationIds: ['D003'],
  excludedCuffIds: ['cuff:C002'],
  preferExactMatches: true,
  maxResults: 10,
}

afterEach(() => localStorage.clear())

describe('saveSearchFormState / loadSearchFormState', () => {
  it('round-trips every field exactly', () => {
    saveSearchFormState(STATE)
    expect(loadSearchFormState()).toEqual(STATE)
  })

  it('round-trips a non-null excludedWeaponZenithSkillIds too', () => {
    const withWeaponExclusions: SearchFormState = {
      ...STATE,
      excludedWeaponZenithSkillIds: ['1000002', 'none'],
    }
    saveSearchFormState(withWeaponExclusions)
    expect(loadSearchFormState()).toEqual(withWeaponExclusions)
  })

  it('returns null when nothing has been saved yet', () => {
    expect(loadSearchFormState()).toBeNull()
  })

  it('returns null for a malformed stored value rather than throwing', () => {
    localStorage.setItem('frontier-set-searcher:search-form-state:v1', 'not valid json at all')
    expect(loadSearchFormState()).toBeNull()
  })

  it('returns null for well-formed JSON missing required fields', () => {
    localStorage.setItem(
      'frontier-set-searcher:search-form-state:v1',
      JSON.stringify({ requirements: [] }),
    )
    expect(loadSearchFormState()).toBeNull()
  })

  it('returns null for an invalid hunterTypeFilter value', () => {
    localStorage.setItem(
      'frontier-set-searcher:search-form-state:v1',
      JSON.stringify({ ...STATE, hunterTypeFilter: 'either' }),
    )
    expect(loadSearchFormState()).toBeNull()
  })
})
