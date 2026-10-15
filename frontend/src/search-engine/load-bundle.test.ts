import { describe, expect, it } from 'vitest'
import { loadBundle } from './load-bundle'
import type { FetchLike } from './load-bundle'

const manifest = { formatVersion: 1, slotTypes: ['head', 'chest'] }
const skills = [
  {
    id: 1,
    name: 'Attack Up (Small)',
    category: 'offense',
    priorityRank: 16,
    tiers: [{ label: 'Attack Up (Small)', minPoints: 10, description: null }],
  },
]
const decorations = [
  { id: 'D001', name: 'Attack Jewel', slotSize: 1, skills: [{ skillId: 1, points: 3 }] },
]
const cuffs = [
  {
    id: 'cuff:C001',
    name: 'Sharpening PC1',
    slotSize: 1,
    skills: [{ skillId: 1, points: 2 }],
    category: 'cuff_premium_tier1',
  },
]
const zenithSkills = [
  { id: 1000001, name: 'Dissolver Up', category: null, priorityRank: null, tiers: [] },
]
const headEquipment = [
  {
    id: 'head:0001',
    name: 'Leather Helm',
    skills: [{ skillId: 1, points: 5 }],
    openSlotCount: 1,
    category: 'standard_plain',
    grankOrLater: false,
  },
]
const chestEquipment = [
  {
    id: 'body:0001',
    name: 'Leather Vest',
    skills: [],
    openSlotCount: 0,
    category: 'standard_plain',
    grankOrLater: false,
  },
]

function fakeFetch(files: Record<string, unknown>): FetchLike {
  return async (url: string) => {
    const path = url.replace(/^.*\/data\//, '')
    if (!(path in files)) {
      return { ok: false, status: 404, json: () => Promise.reject(new Error('not found')) }
    }
    return { ok: true, status: 200, json: () => Promise.resolve(files[path]) }
  }
}

const weaponZenithSkillIds = [1000001]

const allFiles = {
  'manifest.json': manifest,
  'skills.json': skills,
  'zenith-skills.json': zenithSkills,
  'decorations.json': decorations,
  'cuffs.json': cuffs,
  'equipment/head.json': headEquipment,
  'equipment/chest.json': chestEquipment,
  'weapon-zenith-skills.json': weaponZenithSkillIds,
}

describe('loadBundle', () => {
  it('assembles one SlotQuery per slot type named in the manifest', async () => {
    const bundle = await loadBundle('/data', fakeFetch(allFiles))

    expect(bundle.slots.map((s) => s.slotId)).toEqual(['head', 'chest'])
    expect(bundle.slots[0].candidates).toEqual(headEquipment)
    expect(bundle.slots[1].candidates).toEqual(chestEquipment)
  })

  it('exposes the decoration catalog as-is', async () => {
    const bundle = await loadBundle('/data', fakeFetch(allFiles))

    expect(bundle.decorations).toEqual(decorations)
  })

  it('exposes the cuff catalog as-is', async () => {
    const bundle = await loadBundle('/data', fakeFetch(allFiles))

    expect(bundle.cuffs).toEqual(cuffs)
  })

  it('builds a skill id -> name lookup spanning both normal and Zenith skills', async () => {
    const bundle = await loadBundle('/data', fakeFetch(allFiles))

    expect(bundle.skillNames.get(1)).toBe('Attack Up (Small)')
    expect(bundle.skillNames.get(1000001)).toBe('Dissolver Up')
  })

  it('exposes the full skill catalog, including category and tiers', async () => {
    const bundle = await loadBundle('/data', fakeFetch(allFiles))

    expect(bundle.skills).toEqual(skills)
  })

  it('exposes the Zenith skill catalog as-is', async () => {
    const bundle = await loadBundle('/data', fakeFetch(allFiles))

    expect(bundle.zenithSkills).toEqual(zenithSkills)
  })

  it('exposes the weapon-eligible Zenith skill id list as-is', async () => {
    const bundle = await loadBundle('/data', fakeFetch(allFiles))

    expect(bundle.weaponZenithSkillIds).toEqual(weaponZenithSkillIds)
  })

  it('rejects a bundle whose format version this build does not understand', async () => {
    const files = { ...allFiles, 'manifest.json': { formatVersion: 999, slotTypes: [] } }

    await expect(loadBundle('/data', fakeFetch(files))).rejects.toThrow(/format version/i)
  })

  it('surfaces a clear error when a bundle file is missing', async () => {
    const files = { ...allFiles }
    delete (files as Record<string, unknown>)['equipment/chest.json']

    await expect(loadBundle('/data', fakeFetch(files))).rejects.toThrow(/equipment\/chest\.json/)
  })
})
