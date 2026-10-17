/**
 * Persists the main search page's own form inputs (skills, category filters,
 * pinned armor/cuffs, Hunter Type, etc. -- everything `App.tsx`'s
 * `AppInitialState` already describes) to `localStorage`, so refreshing the
 * page restores the last search instead of resetting to defaults (see
 * docs/skill-system-roadmap.md TODO #18).
 *
 * Deliberately a thin JSON-safe mirror of `AppInitialState`, not that type
 * itself -- `Set`/`Map` aren't `JSON.stringify`-safe, so every such field is
 * stored as a plain array (same conversion `shared-state.ts` already does for
 * its own wire format, though without that module's compression/short-key
 * concerns: this never leaves the browser, so there's no URL-length budget to
 * economize for).
 *
 * Never persists `results` or any other transient search-in-progress state --
 * only the inputs that produce a search, same scope as "use as a base for a
 * new search" already restores via `AppInitialState`. A stale/malformed
 * stored value (e.g. from before a shape change) is treated as absent rather
 * than crashing or partially applying -- same fail-soft convention
 * `shared-state.ts`'s `fromWireFormat` already established, and for the same
 * reason: this is a convenience restore, not data the user would notice
 * losing if it silently falls back to defaults.
 */

import type { HunterTypeFilter } from './build-query'
import type { PinnedSlot } from './pinned-armor'
import type { ResistanceElement, SkillRequirement } from './types'

const RESISTANCE_ELEMENTS: readonly ResistanceElement[] = ['fire', 'water', 'thunder', 'ice', 'dragon']

const STORAGE_KEY = 'frontier-set-searcher:search-form-state:v1'

/** Every field is required (no `?`, unlike `AppInitialState`'s few optional
 * ones) -- this is always written as one complete snapshot, so there's never
 * a partially-filled stored value to default individual fields out of. */
export interface SearchFormState {
  readonly requirements: readonly SkillRequirement[]
  readonly zenithRequirements: readonly SkillRequirement[]
  readonly excludedCategories: readonly string[]
  readonly excludedCuffCategories: readonly string[]
  readonly excludedDecorationCategories: readonly string[]
  readonly excludedWeaponZenithSkillIds: readonly string[] | null
  readonly weaponSlotCount: number
  readonly hunterTypeFilter: HunterTypeFilter
  readonly pinnedArmor: readonly (readonly [string, PinnedSlot])[]
  readonly pinnedCuffIds: readonly string[]
  readonly pinnedSlotDecorationIds: readonly (readonly [string, readonly string[]])[]
  readonly excludedArmorIds: readonly string[]
  readonly excludedDecorationIds: readonly string[]
  readonly excludedCuffIds: readonly string[]
  readonly excludedSkillIds: readonly string[]
  readonly nonNegativeResistances: readonly ResistanceElement[]
  readonly preferExactMatches: boolean
  readonly maxResults: number
}

/** Returns `null` for anything that doesn't decode into a usable
 * `SearchFormState` (missing/wrong-typed fields, e.g. a stored value from
 * before this shape last changed) -- see this module's own docstring on why
 * this fails soft instead of throwing. Exported for `query-code.ts`'s own
 * save/load-a-search-by-code feature (docs/feedback.md #18), which decodes
 * into this exact shape and needs the same validation this module already
 * does for its own `localStorage` value. */
export function validateSearchFormState(parsed: unknown): SearchFormState | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const p = parsed as Record<string, unknown>

  if (
    !Array.isArray(p.requirements) ||
    !Array.isArray(p.zenithRequirements) ||
    !Array.isArray(p.excludedCategories) ||
    !Array.isArray(p.excludedCuffCategories) ||
    !Array.isArray(p.excludedDecorationCategories) ||
    (p.excludedWeaponZenithSkillIds !== null && !Array.isArray(p.excludedWeaponZenithSkillIds)) ||
    typeof p.weaponSlotCount !== 'number' ||
    (p.hunterTypeFilter !== 'blademaster' && p.hunterTypeFilter !== 'gunner') ||
    !Array.isArray(p.pinnedArmor) ||
    !Array.isArray(p.pinnedCuffIds) ||
    !Array.isArray(p.pinnedSlotDecorationIds) ||
    !Array.isArray(p.excludedArmorIds) ||
    !Array.isArray(p.excludedDecorationIds) ||
    !Array.isArray(p.excludedCuffIds) ||
    !Array.isArray(p.excludedSkillIds) ||
    !Array.isArray(p.nonNegativeResistances) ||
    !p.nonNegativeResistances.every((e) => RESISTANCE_ELEMENTS.includes(e)) ||
    typeof p.preferExactMatches !== 'boolean' ||
    typeof p.maxResults !== 'number'
  ) {
    return null
  }
  return p as unknown as SearchFormState
}

/** Reads the last-saved form state, or `null` if there isn't one, it's
 * corrupted, or `localStorage` itself is unavailable (private browsing,
 * exhausted quota, or disabled entirely -- all of which throw rather than
 * just returning `null`, hence the `try`). */
export function loadSearchFormState(): SearchFormState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    return validateSearchFormState(JSON.parse(raw))
  } catch {
    return null
  }
}

/** Saves the given form state as the one to restore on next load, replacing
 * whatever was saved before. Silently does nothing if `localStorage` throws
 * (same unavailable-storage cases as `loadSearchFormState`) -- losing this
 * convenience feature is never worth surfacing as an error to the user. */
export function saveSearchFormState(state: SearchFormState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Unavailable storage -- see this function's own docstring.
  }
}
