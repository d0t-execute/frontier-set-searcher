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
  hunterTypeFilter: 'blademaster',
  excludedArmorIds: ['head:9999'],
  excludedDecorationIds: ['D099'],
  excludedCuffIds: ['cuff:C099'],
  excludedSkillIds: ['5'],
  preferredArmorIds: ['head:0002'],
  preferredCategoryCounts: [{ category: 'equip_g_rank', count: 2 }],
  nonNegativeResistances: ['ice', 'thunder'],
  preferExactMatches: true,
  result: {
    picks: [
      {
        slotId: 'head',
        id: 'head:0001',
        name: 'Leather Helm',
        openSlotCount: 3,
        grankOrLater: false,
        exoticSkillId: 83,
        defenseMax: 10,
        resistances: { fire: 4, water: -1, thunder: 0, ice: 3, dragon: 2 },
      },
    ],
    decorations: [
      { slotId: 'head', decorations: [{ id: 'D001', name: 'Attack Jewel', slotSize: 1 }] },
    ],
    cuffs: [{ id: 'cuff:C001', name: 'Sharpening PC1', skills: [{ skillId: 4, points: 3 }] }],
    skillTotals: [[1, 15]],
  },
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

  it('round-trips a null openSlotCount and an empty decorations/cuffs result', async () => {
    const minimal: SharedSearchState = {
      ...state,
      result: {
        picks: [
          {
            slotId: 'head',
            id: 'head:0001',
            name: 'Leather Helm',
            openSlotCount: null,
            grankOrLater: false,
            exoticSkillId: null,
            defenseMax: null,
            resistances: { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 },
          },
        ],
        decorations: [],
        cuffs: [],
        skillTotals: [],
      },
    }
    const encoded = await encodeSharedState(minimal)
    expect(await decodeSharedState(encoded)).toEqual(minimal)
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
