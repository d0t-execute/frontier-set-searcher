import { describe, expect, it } from 'vitest'
import { decodeQueryCode, encodeQueryCode } from './query-code'
import type { SearchFormState } from './search-form-state'

const state: SearchFormState = {
  requirements: [{ skillId: 1, minPoints: 10 }],
  zenithRequirements: [{ skillId: 1000001, minPoints: 1 }],
  excludedCategories: ['equip_unavailable'],
  excludedCuffCategories: ['cuff_standard_unavailable'],
  excludedDecorationCategories: ['tower'],
  excludedWeaponZenithSkillIds: null,
  weaponSlotCount: 2,
  hunterTypeFilter: 'blademaster',
  pinnedArmor: [['head', { candidateId: 'head:0001', decorationIds: ['D001'] }]],
  pinnedCuffIds: ['cuff:C001'],
  pinnedSlotDecorationIds: [['chest', ['D002', 'D002']]],
  excludedArmorIds: ['head:9999'],
  excludedDecorationIds: ['D099'],
  excludedCuffIds: ['cuff:C099'],
  nonNegativeResistances: ['water'],
  preferExactMatches: true,
  maxResults: 5,
}

describe('encodeQueryCode / decodeQueryCode', () => {
  it('round-trips every field exactly', async () => {
    const encoded = await encodeQueryCode(state)
    expect(await decodeQueryCode(encoded)).toEqual(state)
  })

  it('round-trips a non-null excludedWeaponZenithSkillIds too', async () => {
    const withWeaponExclusions: SearchFormState = {
      ...state,
      excludedWeaponZenithSkillIds: ['1000002', 'none'],
    }
    const encoded = await encodeQueryCode(withWeaponExclusions)
    expect(await decodeQueryCode(encoded)).toEqual(withWeaponExclusions)
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
      pinnedCuffIds: [],
      pinnedSlotDecorationIds: [],
      excludedArmorIds: [],
      excludedDecorationIds: [],
      excludedCuffIds: [],
      nonNegativeResistances: [],
      preferExactMatches: true,
      maxResults: 5,
    }
    const encoded = await encodeQueryCode(empty)
    expect(await decodeQueryCode(encoded)).toEqual(empty)
  })

  it('is URL-safe (no +, /, or = characters)', async () => {
    const encoded = await encodeQueryCode(state)
    expect(encoded).not.toMatch(/[+/=]/)
  })

  it('tolerates surrounding whitespace from a pasted code', async () => {
    const encoded = await encodeQueryCode(state)
    expect(await decodeQueryCode(`  ${encoded}\n`)).toEqual(state)
  })

  it('returns null for malformed base64', async () => {
    expect(await decodeQueryCode('not valid base64 at all!!!')).toBeNull()
  })

  it('returns null for data that base64-decodes but is not valid gzip', async () => {
    const notGzip = btoa('just some text, not a gzip stream')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(await decodeQueryCode(notGzip)).toBeNull()
  })

  it('returns null for well-formed JSON missing required fields', async () => {
    const badJsonBytes = new TextEncoder().encode(JSON.stringify({ requirements: [] }))
    const badJsonBuffer = badJsonBytes.slice().buffer as ArrayBuffer
    const compressed = await new Response(
      new Response(badJsonBuffer).body!.pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer()
    let binary = ''
    for (const byte of new Uint8Array(compressed)) binary += String.fromCharCode(byte)
    const bad = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

    expect(await decodeQueryCode(bad)).toBeNull()
  })
})
