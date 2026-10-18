/**
 * Loads the static data bundle produced by the ETL export step (see
 * docs/PLAN.md §4 "the only artifact that crosses from offline to online",
 * and etl/src/etl/export.py) into the shapes the search engine consumes.
 * Takes an injectable fetch function so this is testable against canned
 * responses, with no live network access (per docs/PLAN.md §3).
 */

import type { Candidate, Decoration, Resistances, SkillContribution } from './types'

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
  /** This skill's rank in the game's active-skill-cap priority list (lower
   * survives longer once a build's simultaneously-active normal-skill count
   * exceeds its cap) -- see active-skill-cap.ts. `null` means this skill
   * never matched a row on the priority source page, not that it has no
   * priority in-game -- treated as the lowest priority (first disabled).
   * Zenith skills (loaded through this same type for `zenithSkills`) are
   * never subject to the cap and always have `priorityRank: null`. */
  readonly priorityRank: number | null
  readonly tiers: readonly SkillTierRecord[]
}

/** A Candidate as exported (see etl/src/etl/export.py) also carries a
 * display name, a gear-level category, and a G-Rank-or-later flag -- the
 * search engine itself never needs any of these (Candidate doesn't declare
 * them), but the UI does: `name` for display, `category` for the gear-level
 * filter (see docs/gear-category-taxonomy.md), `grankOrLater` for the
 * active-skill-cap piece-count bonus (see active-skill-cap.ts). `category`
 * alone can't answer the latter -- several display categories (every "Paid
 * and Premium" one, plus a few route-level "plain"/Festival/Event buckets)
 * mix below-G-rank and G-Rank-or-later pieces together. */
/** A piece's Hunter Type restriction (etl's `hunter_type`, from the raw
 * TYPE field) -- "blademaster" and "gunner" pieces can't be mixed in the
 * same build (confirmed by the project owner, 2026-10-15); "common" pieces
 * (nearly all head pieces, plus a minority of other slots) fit either. */
export type HunterType = 'common' | 'blademaster' | 'gunner'

/** A piece's elemental resistances (etl's `resistance_*` columns, from the
 * raw F/W/T/D/I fields) -- flat per piece, not forge-level scaled (see
 * docs/data-format-notes.md's column table). A plain alias for `types.ts`'s
 * own `Resistances`, kept under its own Named* name for consistency with
 * this module's other Named* types -- unlike `defenseMax` on `NamedCandidate`
 * (still purely display-only), resistances are now also a real solver
 * constraint (`SearchOptions.resistanceFloors`, docs/feedback.md Round 1 #4),
 * so this alias is what lets `NamedCandidate.resistances` satisfy
 * `Candidate.resistances?` with no cast. */
export type NamedResistances = Resistances

export interface NamedCandidate extends Candidate {
  readonly name: string
  readonly category: string
  readonly grankOrLater: boolean
  readonly hunterType: HunterType
  /** The normal-skill id this piece's Exotic-armor bonus grant targets (see
   * docs/skill-system-roadmap.md TODO #3), if any -- `null` for a non-Exotic
   * piece. Kept separate from this piece's own `skills` entries (which
   * already include the grant's points, merged in at ETL time) so the
   * active-skill-cap exemption (active-skill-cap.ts) can tell an
   * Exotic-granted skill apart from the piece's normal contributions. */
  readonly exoticSkillId: number | null
  /** Fully-forged defense (etl/src/etl/export.py's `_export_equipment`) --
   * display-only, for the result card's Stats column (docs/skill-system-
   * roadmap.md's result-card-redesign spec). `null` for a piece with no
   * defense progression (shouldn't happen for real armor, but the ETL
   * column itself is nullable). */
  readonly defenseMax: number | null
  readonly resistances: NamedResistances
}

export interface NamedDecoration extends Decoration {
  readonly name: string
  /** A "Tower Gem" (etl/src/etl/export.py's `_export_decorations`) -- these
   * and regular decorations are strictly exclusive with each other in both
   * directions in-game (docs/data-format-notes.md's "Decorations" section:
   * Tower armor can only take Tower Gems, and regular armor can't take them
   * at all). The search engine itself has no concept of this -- see
   * `build-query.ts`'s `decorationsAfterCategoryFilter`, which (by default)
   * keeps Tower Gems out of the general pool this flag alone doesn't stop
   * the engine from freely mixing in. */
  readonly isTower: boolean
  /** An "SP Decoration" (etl/src/etl/export.py's `_export_decorations`) --
   * restricted to usable-only-in-SP-armor by the project owner (2026-10-18),
   * the same restriction `isTower` enforces for Tower Gems and via the same
   * mechanism: `build-query.ts`'s `decorationsAfterCategoryFilter` drops
   * every `isSp` decoration from the general pool unconditionally. */
  readonly isSp: boolean
  /** The reference set-searcher's decoration-tree category leaf (see
   * docs/gear-category-taxonomy.md's "Decorations" table) -- mirrors
   * `NamedCandidate`/`NamedCuff`'s own `category` field. Entirely separate
   * from `isTower` above: Tower Gems get their own category leaf too
   * (`deco_tower`), but it's never surfaced as a selectable option in this
   * tree -- Tower stays governed by the pre-existing `isTower` toggle (see
   * `decoration-categories.ts`'s own docstring). */
  readonly category: string
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
  /** Exported (family-level) ids of every Zenith skill at least one weapon
   * can carry (see etl/src/etl/export.py's module docstring) -- the weapon
   * slot's own candidates aren't exported at all (a weapon's identity never
   * matters to this tool, only this), so the UI builds that slot's
   * `SlotQuery` itself from this list plus its own include/exclude and
   * slot-count controls (see App.tsx). */
  readonly weaponZenithSkillIds: readonly number[]
}

export async function loadBundle(baseUrl: string, fetchImpl: FetchLike): Promise<DataBundle> {
  const manifest = await fetchJson<Manifest>(fetchImpl, `${baseUrl}/manifest.json`)
  if (manifest.formatVersion !== SUPPORTED_FORMAT_VERSION) {
    throw new Error(
      `Unsupported data bundle format version ${manifest.formatVersion} ` +
        `(this build understands version ${SUPPORTED_FORMAT_VERSION})`,
    )
  }

  const [skills, zenithSkills, decorations, cuffs, equipmentBySlotType, weaponZenithSkillIds] =
    await Promise.all([
      fetchJson<NamedSkill[]>(fetchImpl, `${baseUrl}/skills.json`),
      fetchJson<NamedSkill[]>(fetchImpl, `${baseUrl}/zenith-skills.json`),
      fetchJson<NamedDecoration[]>(fetchImpl, `${baseUrl}/decorations.json`),
      fetchJson<NamedCuff[]>(fetchImpl, `${baseUrl}/cuffs.json`),
      Promise.all(
        manifest.slotTypes.map((slotType) =>
          fetchJson<NamedCandidate[]>(fetchImpl, `${baseUrl}/equipment/${slotType}.json`),
        ),
      ),
      fetchJson<number[]>(fetchImpl, `${baseUrl}/weapon-zenith-skills.json`),
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
    weaponZenithSkillIds,
  }
}

async function fetchJson<T>(fetchImpl: FetchLike, url: string): Promise<T> {
  const response = await fetchImpl(url)
  if (!response.ok) {
    throw new Error(`Failed to load data bundle file ${url}: HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}
