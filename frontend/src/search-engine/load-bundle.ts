/**
 * Loads the static data bundle produced by the ETL export step (see
 * docs/PLAN.md §4 "the only artifact that crosses from offline to online",
 * and etl/src/etl/export.py) into the shapes the search engine consumes.
 * Takes an injectable fetch function so this is testable against canned
 * responses, with no live network access (per docs/PLAN.md §3).
 */

import type { Candidate, Decoration, SkillContribution } from './types'

/** The slice of the global `fetch` this module relies on. */
export type FetchLike = (
  url: string,
) => Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>

const SUPPORTED_FORMAT_VERSION = 1

interface Manifest {
  readonly formatVersion: number
  readonly slotTypes: readonly string[]
}

export interface SkillTierRecord {
  readonly label: string
  readonly minPoints: number
  readonly description: string | null
}

export interface NamedSkill {
  readonly id: number
  readonly name: string
  readonly category: string | null
  readonly tiers: readonly SkillTierRecord[]
}

/** A Candidate as exported (see etl/src/etl/export.py) also carries a
 * display name and a gear-level category -- the search engine itself never
 * needs either (Candidate doesn't declare them), but the UI does: `name` for
 * display, `category` for the gear-level filter (see
 * docs/gear-category-taxonomy.md). */
export interface NamedCandidate extends Candidate {
  readonly name: string
  readonly category: string
}

export interface NamedDecoration extends Decoration {
  readonly name: string
}

/** A Cuff is shaped exactly like a Decoration (id, slotSize, skills) -- see
 * etl/src/etl/export.py's `_export_cuffs` -- but is a separate equipment
 * category with its own "Poogie slot" budget, not an armor decoration (see
 * docs/data-format-notes.md's "Cuffs" section). Kept as its own type rather
 * than aliased to NamedDecoration so the two can't be mixed up at a call
 * site even though the shape matches today. `category` mirrors
 * `NamedCandidate`'s -- the Premium/Standard split (and finer leaves within
 * each) the UI's cuff category filter needs (see
 * docs/gear-category-taxonomy.md's "Tree 2"). */
export interface NamedCuff {
  readonly id: string
  readonly name: string
  readonly slotSize: number
  readonly skills: readonly SkillContribution[]
  readonly category: string
}

export interface NamedSlotQuery {
  readonly slotId: string
  readonly candidates: readonly NamedCandidate[]
}

export interface DataBundle {
  readonly slots: readonly NamedSlotQuery[]
  readonly decorations: readonly NamedDecoration[]
  readonly cuffs: readonly NamedCuff[]
  readonly skills: readonly NamedSkill[]
  /** Zenith skills (see etl/src/etl/export.py's module docstring) -- a
   * separate catalog from `skills`, but shaped identically (same
   * `NamedSkill`) and consumed through the exact same `SkillRequirement`/
   * `SkillContribution` machinery: every family's exported id is offset well
   * clear of `skills`' id space, so a Zenith skill requirement is just
   * another entry in the same requirements list passed to `search()`. Always
   * has empty `tiers` (see the export module's docstring for why) -- the UI
   * picks a point value with a free-entry number input, not a tier
   * dropdown. */
  readonly zenithSkills: readonly NamedSkill[]
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

  const [skills, zenithSkills, decorations, cuffs, equipmentBySlotType] = await Promise.all([
    fetchJson<NamedSkill[]>(fetchImpl, `${baseUrl}/skills.json`),
    fetchJson<NamedSkill[]>(fetchImpl, `${baseUrl}/zenith-skills.json`),
    fetchJson<NamedDecoration[]>(fetchImpl, `${baseUrl}/decorations.json`),
    fetchJson<NamedCuff[]>(fetchImpl, `${baseUrl}/cuffs.json`),
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
    cuffs,
    skills,
    zenithSkills,
    skillNames: new Map([...skills, ...zenithSkills].map((skill) => [skill.id, skill.name])),
  }
}

async function fetchJson<T>(fetchImpl: FetchLike, url: string): Promise<T> {
  const response = await fetchImpl(url)
  if (!response.ok) {
    throw new Error(`Failed to load data bundle file ${url}: HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}
