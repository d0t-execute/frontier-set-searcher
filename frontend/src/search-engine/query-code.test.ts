import { describe, expect, it } from 'vitest'
import { decodeQueryCode, encodeQueryCode } from './query-code'
import type { QueryCodeCatalog } from './query-code'
import type { SearchFormState } from './search-form-state'

const catalog: QueryCodeCatalog = {
  skills: [
    { id: 1, name: 'Attack' },
    { id: 2, name: 'Sharpness' },
  ],
  zenithSkills: [{ id: 1000001, name: 'Zenith Attack' }],
  armorCandidates: [
    { id: 'head:0001', name: 'Leather Helm' },
    { id: 'head:9999', name: 'Iron Helm' },
    // Two different pieces sharing a display name -- forces the
    // disambiguating "(id)" suffix.
    { id: 'chest:0001', name: 'Duplicate Mail' },
    { id: 'chest:0002', name: 'Duplicate Mail' },
  ],
  decorations: [
    { id: 'D001', name: 'Attack Jewel' },
    { id: 'D002', name: 'Defense Jewel' },
    { id: 'D099', name: 'Guard Jewel' },
  ],
  cuffs: [
    { id: 'cuff:C001', name: 'Sharpening PC1' },
    { id: 'cuff:C099', name: 'Guard Up SZ' },
  ],
  gearCategories: [
    { label: 'Unavailable', categories: [{ key: 'unavailable_not_implemented', label: 'Not Implemented' }] },
  ],
  cuffCategories: [
    {
      label: 'Standard Poogie Cuffs',
      // A real label that itself contains parentheses -- must round-trip
      // as plain text, not be mistaken for the disambiguation suffix.
      categories: [{ key: 'cuff_standard_unavailable', label: 'Standard (Unavailable)' }],
    },
  ],
  decorationCategories: [
    { label: 'Tower', categories: [{ key: 'deco_tower', label: 'Tower' }] },
  ],
}

const state: SearchFormState = {
  requirements: [{ skillId: 1, minPoints: 10 }],
  zenithRequirements: [{ skillId: 1000001, minPoints: 1 }],
  excludedCategories: ['unavailable_not_implemented'],
  excludedCuffCategories: ['cuff_standard_unavailable'],
  excludedDecorationCategories: ['deco_tower'],
  excludedWeaponZenithSkillIds: null,
  weaponSlotCount: 2,
  hunterTypeFilter: 'blademaster',
  pinnedArmor: [['head', { candidateId: 'head:0001', decorationIds: ['D001'] }]],
  pinnedCuffSlots: [
    { mode: 'exact', cuffId: 'cuff:C001' },
    { mode: 'skill', skillId: 1000001 },
  ],
  pinnedSlotDecorationIds: [['chest', ['D002', 'D002']]],
  excludedArmorIds: ['head:9999'],
  excludedDecorationIds: ['D099'],
  excludedCuffIds: ['cuff:C099'],
  excludedSkillIds: ['2'],
  nonNegativeResistances: ['fire', 'dragon'],
  preferExactMatches: true,
  maxResults: 5,
}

describe('encodeQueryCode / decodeQueryCode', () => {
  it('round-trips every field exactly', async () => {
    const encoded = await encodeQueryCode(state, catalog)
    expect(await decodeQueryCode(encoded, catalog)).toEqual(state)
  })

  it('round-trips a non-null excludedWeaponZenithSkillIds, including the "no Zenith skill" sentinel', async () => {
    const withWeaponExclusions: SearchFormState = {
      ...state,
      excludedWeaponZenithSkillIds: ['1000001', 'none'],
    }
    const encoded = await encodeQueryCode(withWeaponExclusions, catalog)
    expect(await decodeQueryCode(encoded, catalog)).toEqual(withWeaponExclusions)
  })

  it('round-trips a non-null but entirely empty excludedWeaponZenithSkillIds, distinct from null', async () => {
    const explicitlyNone: SearchFormState = { ...state, excludedWeaponZenithSkillIds: [] }
    const encoded = await encodeQueryCode(explicitlyNone, catalog)
    expect(encoded).toContain('Excluded weapon Zenith skills:')
    expect(await decodeQueryCode(encoded, catalog)).toEqual(explicitlyNone)
  })

  it('round-trips an entirely empty search', async () => {
    const empty: SearchFormState = {
      requirements: [],
      zenithRequirements: [],
      excludedCategories: [],
      excludedCuffCategories: [],
      excludedDecorationCategories: [],
      excludedWeaponZenithSkillIds: null,
      weaponSlotCount: 0,
      hunterTypeFilter: 'blademaster',
      pinnedArmor: [],
      pinnedCuffSlots: [],
      pinnedSlotDecorationIds: [],
      excludedArmorIds: [],
      excludedDecorationIds: [],
      excludedCuffIds: [],
      excludedSkillIds: [],
      nonNegativeResistances: [],
      preferExactMatches: true,
      maxResults: 5,
    }
    const encoded = await encodeQueryCode(empty, catalog)
    expect(await decodeQueryCode(encoded, catalog)).toEqual(empty)
  })

  it('resolves ids to real, readable names rather than base64/JSON', async () => {
    const encoded = await encodeQueryCode(state, catalog)
    expect(encoded).toContain('Attack: 10')
    expect(encoded).toContain('Leather Helm')
    expect(encoded).toContain('Not Implemented')
    expect(encoded).not.toMatch(/[A-Za-z0-9+/]{40,}={0,2}/) // no long base64-looking blob
  })

  it('resolves an excluded skill id to its real name', async () => {
    const encoded = await encodeQueryCode(state, catalog)
    expect(encoded).toContain('Excluded skills:')
    expect(encoded).toContain('- Sharpness')
  })

  it('disambiguates two items that share a display name with their own id, and keeps a legitimate parenthetical label intact', async () => {
    const withDuplicateName: SearchFormState = { ...state, excludedArmorIds: ['chest:0001', 'chest:0002'] }
    const encoded = await encodeQueryCode(withDuplicateName, catalog)

    expect(encoded).toContain('Duplicate Mail (chest:0001)')
    expect(encoded).toContain('Duplicate Mail (chest:0002)')
    // "Standard (Unavailable)" is a real label, not a collision -- round-trips plain.
    expect(encoded).toContain('Standard (Unavailable)')
    expect(encoded).not.toContain('Standard (Unavailable) (cuff_standard_unavailable)')

    expect(await decodeQueryCode(encoded, catalog)).toEqual(withDuplicateName)
  })

  it('preserves a colon embedded in an armor piece name (e.g. a real "Plug Head:01"-style piece)', async () => {
    const colonCatalog: QueryCodeCatalog = {
      ...catalog,
      armorCandidates: [...catalog.armorCandidates, { id: 'head:plug01', name: 'Plug Head:01' }],
    }
    const withColonName: SearchFormState = { ...state, excludedArmorIds: ['head:plug01'] }
    const encoded = await encodeQueryCode(withColonName, colonCatalog)

    expect(encoded).toContain('- Plug Head:01')
    expect(await decodeQueryCode(encoded, colonCatalog)).toEqual(withColonName)
  })

  it('tolerates surrounding whitespace from a pasted code', async () => {
    const encoded = await encodeQueryCode(state, catalog)
    expect(await decodeQueryCode(`  ${encoded}\n`, catalog)).toEqual(state)
  })

  it('tolerates missing blank lines between sections', async () => {
    const encoded = await encodeQueryCode(state, catalog)
    const squashed = encoded.replace(/\n\n/g, '\n')
    expect(await decodeQueryCode(squashed, catalog)).toEqual(state)
  })

  it('returns null for completely unrecognized text', async () => {
    expect(await decodeQueryCode('this is not a query code at all', catalog)).toBeNull()
  })

  it('returns null when a required line is missing', async () => {
    const encoded = await encodeQueryCode(state, catalog)
    const withoutHunterType = encoded
      .split('\n')
      .filter((line) => !line.startsWith('Hunter type:'))
      .join('\n')
    expect(await decodeQueryCode(withoutHunterType, catalog)).toBeNull()
  })

  it('returns null for a skill name that is not in the catalog', async () => {
    const encoded = (await encodeQueryCode(state, catalog)).replace('Attack: 10', 'Nonexistent Skill: 10')
    expect(await decodeQueryCode(encoded, catalog)).toBeNull()
  })

  it('returns null for an ambiguous name with no disambiguating id', async () => {
    const withDuplicateName: SearchFormState = { ...state, excludedArmorIds: ['chest:0001'] }
    const encoded = await encodeQueryCode(withDuplicateName, catalog)
    const withoutId = encoded.replace('Duplicate Mail (chest:0001)', 'Duplicate Mail')
    expect(await decodeQueryCode(withoutId, catalog)).toBeNull()
  })
})
