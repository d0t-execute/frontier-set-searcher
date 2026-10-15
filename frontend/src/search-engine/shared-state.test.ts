import { describe, expect, it } from 'vitest'
import {
  buildResultUrl,
  decodeSharedState,
  encodedResultFromLocation,
  encodeSharedState,
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
  it('round-trips every field exactly', async () => {
    const encoded = await encodeSharedState(state)
    expect(await decodeSharedState(encoded)).toEqual(state)
  })

  it('round-trips a non-null excludedWeaponZenithSkillIds too', async () => {
    const withWeaponExclusions: SharedSearchState = {
      ...state,
      excludedWeaponZenithSkillIds: ['1000002', 'none'],
    }
    const encoded = await encodeSharedState(withWeaponExclusions)
    expect(await decodeSharedState(encoded)).toEqual(withWeaponExclusions)
  })

  it('is URL-safe (no +, /, or = characters)', async () => {
    const encoded = await encodeSharedState(state)
    expect(encoded).not.toMatch(/[+/=]/)
  })

  it('is meaningfully shorter than a plain JSON/base64 encoding of the same state', async () => {
    const encoded = await encodeSharedState(state)
    const uncompressedBaseline = btoa(JSON.stringify(state))
    expect(encoded.length).toBeLessThan(uncompressedBaseline.length)
  })

  it('returns null for malformed base64', async () => {
    expect(await decodeSharedState('not valid base64 at all!!!')).toBeNull()
  })

  it('returns null for data that base64-decodes but is not valid gzip', async () => {
    const notGzip = btoa('just some text, not a gzip stream')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(await decodeSharedState(notGzip)).toBeNull()
  })

  it('returns null for well-formed JSON missing required fields', async () => {
    const encoded = await encodeSharedState(state)
    const badJson = JSON.stringify({ r: [] })
    const badJsonBytes = new TextEncoder().encode(badJson)
    const badJsonBuffer = badJsonBytes.slice().buffer as ArrayBuffer
    const compressed = await new Response(
      new Response(badJsonBuffer).body!.pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer()
    let binary = ''
    for (const byte of new Uint8Array(compressed)) binary += String.fromCharCode(byte)
    const bad = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

    expect(await decodeSharedState(bad)).toBeNull()
    expect(await decodeSharedState(encoded)).not.toBeNull()
  })
})

describe('buildResultUrl / encodedResultFromLocation', () => {
  it('builds a URL whose hash round-trips back to the same state', async () => {
    const url = await buildResultUrl(state)
    const hash = new URL(url).hash
    expect(hash.startsWith(RESULT_HASH_PREFIX)).toBe(true)

    window.location.hash = hash
    const encoded = encodedResultFromLocation()
    expect(encoded).not.toBeNull()
    expect(await decodeSharedState(encoded!)).toEqual(state)
  })

  it('returns null when the location hash is not a shared-result link', () => {
    window.location.hash = ''
    expect(encodedResultFromLocation()).toBeNull()

    window.location.hash = '#something-else'
    expect(encodedResultFromLocation()).toBeNull()
  })
})
