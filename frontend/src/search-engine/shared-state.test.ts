import { describe, expect, it } from 'vitest'
import {
  buildResultUrl,
  decodeSharedState,
  encodeSharedState,
  readSharedStateFromLocation,
  RESULT_HASH_PREFIX,
} from './shared-state'
import type { SharedSearchState } from './shared-state'

const state: SharedSearchState = {
  requirements: [{ skillId: 1, minPoints: 10 }],
  zenithRequirements: [{ skillId: 1000001, minPoints: 1 }],
  excludedCategories: ['equip_unavailable'],
  excludedCuffCategories: ['cuff_standard_unavailable'],
  excludedDecorationCategories: ['tower'],
  excludedWeaponZenithSkillIds: null,
  weaponSlotCount: 2,
  pinnedArmor: [['head', { candidateId: 'head:0001', decorationIds: ['D001'] }]],
  pinnedCuffIds: ['cuff:C001', 'cuff:C001'],
  preferExactMatches: true,
  resultIndex: 2,
}

describe('encodeSharedState / decodeSharedState', () => {
  it('round-trips every field exactly', () => {
    const encoded = encodeSharedState(state)
    expect(decodeSharedState(encoded)).toEqual(state)
  })

  it('round-trips a non-null excludedWeaponZenithSkillIds too', () => {
    const withWeaponExclusions: SharedSearchState = {
      ...state,
      excludedWeaponZenithSkillIds: ['1000002', 'none'],
    }
    const encoded = encodeSharedState(withWeaponExclusions)
    expect(decodeSharedState(encoded)).toEqual(withWeaponExclusions)
  })

  it('is URL-safe (no +, /, or = characters)', () => {
    const encoded = encodeSharedState(state)
    expect(encoded).not.toMatch(/[+/=]/)
  })

  it('returns null for malformed base64', () => {
    expect(decodeSharedState('not valid base64 at all!!!')).toBeNull()
  })

  it('returns null for well-formed JSON missing required fields', () => {
    const encoded = encodeSharedState(state)
    // Corrupt it by decoding, stripping a field, and re-encoding by hand
    // would require exposing the base64 helpers -- simpler to just assert
    // against a hand-built bad payload through the same encode path.
    const badJson = JSON.stringify({ requirements: [] })
    const bad = btoa(badJson).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(decodeSharedState(bad)).toBeNull()
    expect(decodeSharedState(encoded)).not.toBeNull()
  })
})

describe('buildResultUrl / readSharedStateFromLocation', () => {
  it('builds a URL whose hash round-trips back to the same state', () => {
    const url = buildResultUrl(state)
    const hash = new URL(url).hash
    expect(hash.startsWith(RESULT_HASH_PREFIX)).toBe(true)

    window.location.hash = hash
    expect(readSharedStateFromLocation()).toEqual(state)
  })

  it('returns null when the location hash is not a shared-result link', () => {
    window.location.hash = ''
    expect(readSharedStateFromLocation()).toBeNull()

    window.location.hash = '#something-else'
    expect(readSharedStateFromLocation()).toBeNull()
  })
})
