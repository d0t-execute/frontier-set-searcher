/**
 * Encodes/decodes everything a shared build-result link needs to reproduce
 * one exact result, into a compact string fit for a URL hash fragment -- see
 * docs/skill-system-roadmap.md TODO #9. This is a client-only app (static
 * `frontend/public/data/*.json`, no backend -- see TODO #9's own research
 * note), so "generated link" means a self-contained URL that encodes the
 * query inputs directly, not a server-issued id pointing at stored state.
 *
 * Deliberately encodes the *query* (every `QueryFormState` field, the skill
 * requirements, `preferExactMatches`, and which ranked result index to take)
 * rather than the solved `BuildResult` itself: the link already has to carry
 * the full query anyway for the result page's "use as a base for a new
 * search" button (TODO #9's other half), so re-running the solver for just
 * that one index on load is free -- no second, heavier encoding of the
 * result data itself is needed. Trade-off, accepted per TODO #9's own open
 * note: a result index isn't stable across a future data re-export (ids or
 * ranking could shift), so an old link could resolve to a different ranked
 * result index, or none, if opened long after the bundle changed -- no worse
 * than this app's existing lack of any cross-session stability guarantee
 * elsewhere (e.g. pinned armor/cuff ids already carry the same risk).
 */

import type { PinnedSlot } from './pinned-armor'
import type { SkillRequirement } from './types'

export interface SharedSearchState {
  readonly requirements: readonly SkillRequirement[]
  readonly zenithRequirements: readonly SkillRequirement[]
  readonly excludedCategories: readonly string[]
  readonly excludedCuffCategories: readonly string[]
  readonly excludedDecorationCategories: readonly string[]
  /** `null` means "use the app's own default" (the user never touched the
   * weapon Zenith-skill checklist) -- mirrors `App.tsx`'s own
   * `excludedWeaponZenithSkillIds` state, so a shared link doesn't have to
   * freeze in a default that might later change. */
  readonly excludedWeaponZenithSkillIds: readonly string[] | null
  readonly weaponSlotCount: number
  readonly pinnedArmor: readonly (readonly [string, PinnedSlot])[]
  readonly pinnedCuffIds: readonly string[]
  readonly preferExactMatches: boolean
  /** Which of the (possibly several) ranked results a plain re-run of this
   * exact query would yield is the one this link points at -- 0-based. */
  readonly resultIndex: number
}

/** `btoa`/`atob` only handle Latin1, so UTF-16 code points outside that range
 * (none expected in practice -- every string field here is an id, a category
 * key, or a skill id -- but skill/category *names* never flow through this,
 * only machine ids) are escaped first via `encodeURIComponent`, matching the
 * standard browser-safe base64-of-arbitrary-text recipe. */
function toBase64Url(json: string): string {
  const base64 = btoa(encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  ))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(encoded: string): string {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const percentEncoded = [...binary]
    .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
    .join('')
  return decodeURIComponent(percentEncoded)
}

export function encodeSharedState(state: SharedSearchState): string {
  return toBase64Url(JSON.stringify(state))
}

/** Returns `null` for anything that doesn't decode into a usable
 * `SharedSearchState` (malformed base64, invalid JSON, or missing/wrong-typed
 * fields) rather than throwing -- a shared link is user-facing input (pasted,
 * possibly truncated or hand-edited), so this follows the same
 * fail-soft-with-null convention as `resolvePinnedCuffs`'s "drop ids that no
 * longer resolve" rather than crashing the page. */
export function decodeSharedState(encoded: string): SharedSearchState | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(fromBase64Url(encoded))
  } catch {
    return null
  }
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
    !Array.isArray(p.pinnedArmor) ||
    !Array.isArray(p.pinnedCuffIds) ||
    typeof p.preferExactMatches !== 'boolean' ||
    typeof p.resultIndex !== 'number'
  ) {
    return null
  }

  return {
    requirements: p.requirements as SkillRequirement[],
    zenithRequirements: p.zenithRequirements as SkillRequirement[],
    excludedCategories: p.excludedCategories as string[],
    excludedCuffCategories: p.excludedCuffCategories as string[],
    excludedDecorationCategories: p.excludedDecorationCategories as string[],
    excludedWeaponZenithSkillIds: p.excludedWeaponZenithSkillIds as string[] | null,
    weaponSlotCount: p.weaponSlotCount,
    pinnedArmor: p.pinnedArmor as (readonly [string, PinnedSlot])[],
    pinnedCuffIds: p.pinnedCuffIds as string[],
    preferExactMatches: p.preferExactMatches,
    resultIndex: p.resultIndex,
  }
}

/** The hash-fragment prefix a shared-result link uses (`#/result/<encoded>`)
 * -- a hash route rather than a real path, since this is a static SPA with
 * no server-side rewrite rule to fall back to `index.html` for a deep path on
 * refresh or direct navigation (see this module's own docstring). */
export const RESULT_HASH_PREFIX = '#/result/'

export function buildResultUrl(state: SharedSearchState): string {
  const { origin, pathname } = window.location
  return `${origin}${pathname}${RESULT_HASH_PREFIX}${encodeSharedState(state)}`
}

/** Reads the currently-shared state out of `window.location.hash`, or `null`
 * if the hash isn't a shared-result link at all (the common case: a plain
 * visit to the main search page). */
export function readSharedStateFromLocation(): SharedSearchState | null {
  const { hash } = window.location
  if (!hash.startsWith(RESULT_HASH_PREFIX)) return null
  return decodeSharedState(hash.slice(RESULT_HASH_PREFIX.length))
}
