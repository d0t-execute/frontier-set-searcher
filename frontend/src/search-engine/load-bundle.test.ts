import { describe, expect, it } from 'vitest'
import { loadBundle } from './load-bundle'
import type { FetchLike } from './load-bundle'

const manifest = { formatVersion: 1, slotTypes: ['head', 'chest'] }
const skills = [{ id: 1, name: 'Attack Up (Small)', category: 'offense' }]
const decorations = [
  { id: 'D001', name: 'Attack Jewel', slotSize: 1, skills: [{ skillId: 1, points: 3 }] },
]
const headEquipment = [
  { id: 'head:0001', name: 'Leather Helm', skills: [{ skillId: 1, points: 5 }], openSlotCount: 1 },
]
const chestEquipment = [{ id: 'body:0001', name: 'Leather Vest', skills: [], openSlotCount: 0 }]

function fakeFetch(files: Record<string, unknown>): FetchLike {
  return async (url: string) => {
    const path = url.replace(/^.*\/data\//, '')
    if (!(path in files)) {
      return { ok: false, status: 404, json: () => Promise.reject(new Error('not found')) }
    }
    return { ok: true, status: 200, json: () => Promise.resolve(files[path]) }
  }
}

const allFiles = {
  'manifest.json': manifest,
  'skills.json': skills,
  'decorations.json': decorations,
  'equipment/head.json': headEquipment,
  'equipment/chest.json': chestEquipment,
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

  it('builds a skill id -> name lookup', async () => {
    const bundle = await loadBundle('/data', fakeFetch(allFiles))

    expect(bundle.skillNames.get(1)).toBe('Attack Up (Small)')
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
