/**
 * Loads the static data bundle produced by the ETL export step (see
 * docs/PLAN.md §4 "the only artifact that crosses from offline to online",
 * and etl/src/etl/export.py) into the shapes the search engine consumes.
 * Takes an injectable fetch function so this is testable against canned
 * responses, with no live network access (per docs/PLAN.md §3).
 */

import type { Candidate, Decoration } from './types'

/** The slice of the global `fetch` this module relies on. */
export type FetchLike = (
  url: string,
) => Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>

const SUPPORTED_FORMAT_VERSION = 1

interface Manifest {
  readonly formatVersion: number
  readonly slotTypes: readonly string[]
}

interface SkillRecord {
  readonly id: number
  readonly name: string
  readonly category: string | null
}

/** A Candidate as exported (see etl/src/etl/export.py) also carries a
 * display name -- the search engine itself never needs it (Candidate
 * doesn't declare it), but the UI does. */
export interface NamedCandidate extends Candidate {
  readonly name: string
}

export interface NamedDecoration extends Decoration {
  readonly name: string
}

export interface NamedSlotQuery {
  readonly slotId: string
  readonly candidates: readonly NamedCandidate[]
}

export interface DataBundle {
  readonly slots: readonly NamedSlotQuery[]
  readonly decorations: readonly NamedDecoration[]
  readonly skillNames: ReadonlyMap<number, string>
}

export async function loadBundle(baseUrl: string, fetchImpl: FetchLike): Promise<DataBundle> {
  const manifest = await fetchJson<Manifest>(fetchImpl, `${baseUrl}/manifest.json`)
  if (manifest.formatVersion !== SUPPORTED_FORMAT_VERSION) {
    throw new Error(
      `Unsupported data bundle format version ${manifest.formatVersion} ` +
        `(this build understands version ${SUPPORTED_FORMAT_VERSION})`,
    )
  }

  const [skills, decorations, equipmentBySlotType] = await Promise.all([
    fetchJson<SkillRecord[]>(fetchImpl, `${baseUrl}/skills.json`),
    fetchJson<NamedDecoration[]>(fetchImpl, `${baseUrl}/decorations.json`),
    Promise.all(
      manifest.slotTypes.map((slotType) =>
        fetchJson<NamedCandidate[]>(fetchImpl, `${baseUrl}/equipment/${slotType}.json`),
      ),
    ),
  ])

  return {
    slots: manifest.slotTypes.map((slotType, i): NamedSlotQuery => ({
      slotId: slotType,
      candidates: equipmentBySlotType[i],
    })),
    decorations,
    skillNames: new Map(skills.map((skill) => [skill.id, skill.name])),
  }
}

async function fetchJson<T>(fetchImpl: FetchLike, url: string): Promise<T> {
  const response = await fetchImpl(url)
  if (!response.ok) {
    throw new Error(`Failed to load data bundle file ${url}: HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}
