/**
 * Encodes/decodes everything a shared build-result link needs, into a
 * compact string fit for a URL hash fragment -- see
 * docs/skill-system-roadmap.md TODO #9 (and TODO #15 for why this no longer
 * re-derives the result by re-solving).
 *
 * **Encodes the solved `BuildResult` directly** (`result` below), not just
 * the query that produced it. This is a deliberate reversal of this module's
 * original design (which encoded the query plus a `resultIndex` and had
 * `ResultPage.tsx` re-run the solver to reconstruct it) -- see TODO #15's
 * investigation write-up for why: opening a link always re-solved against
 * *today's* data bundle and *today's* default category exclusions, so any
 * bundle re-export or default-exclusion change between sharing and opening
 * (both routine during this project's active development -- this same
 * session changed both more than once) could silently change which build a
 * link resolved to, or whether it resolved at all. Encoding the result
 * itself makes a link's display immune to all of that: nothing about it
 * depends on the solver, the current bundle, or today's defaults ever
 * running again.
 *
 * Still separately encodes `requirements`/`zenithRequirements`/
 * `excludedCategories`/`excludedCuffCategories`/`excludedDecorationCategories`/
 * `excludedWeaponZenithSkillIds`/`weaponSlotCount`/`preferExactMatches` --
 * not needed to *display* the result anymore, but kept so the result page's
 * "use as a base for a new search" button can still restore the original
 * search's own category filters and preferences, not just the result's own
 * picks (which it derives straight from `result`, not from any of these).
 *
 * Encoding (docs/skill-system-roadmap.md TODO #14): the project owner
 * reported real links coming out longer than Discord allows a non-Nitro user
 * to post in one message (2000 characters). The wire format below combines
 * the two cheapest wins that don't require giving up the "fully static, no
 * backend" property: short field names/tuple-shaped arrays instead of
 * `JSON.stringify`ing `SharedSearchState` verbatim (see `toWireFormat`/
 * `fromWireFormat`), and gzip compression of the resulting JSON via the
 * browser's native `CompressionStream`/`DecompressionStream` (no new
 * dependency; supported in every current evergreen browser). Encoding the
 * full result (this module's TODO #15 change) makes a link heavier than the
 * query-only encoding it replaces -- accepted, since there's no way to
 * guarantee exact reproducibility without carrying the result itself, and
 * these same two compression wins still apply on top of it.
 *
 * Breaking change, not versioned: a link encoded before this change (or any
 * other `SharedSearchState` shape change -- see TODO #11's own note) cannot
 * be decoded afterwards; no migration attempted.
 */

import type { HunterTypeFilter } from './build-query'
import { fromBase64Url, gunzip, gzip, toBase64Url } from './codec'
import type { ResistanceElement, SkillContribution, SkillRequirement } from './types'

const RESISTANCE_ELEMENTS: readonly ResistanceElement[] = ['fire', 'water', 'thunder', 'ice', 'dragon']

/** One of a result's armor/weapon-slot picks -- just enough of `NamedCandidate`
 * to render `ResultCard` and feed `active-skill-cap.ts`'s piece-counting rule
 * (`grankOrLater`) and its Exotic-armor cap exemption (`exoticSkillId`)
 * without resolving anything against the live data bundle. `category` is
 * deliberately left out -- nothing on the display path (nor
 * `determineActiveSkills`) reads a pick's category. `hunterType` is also left
 * out -- it only matters pre-solve (`slotsAfterHunterTypeFilter`), never on
 * an already-solved result's own display or cap logic. */
/** Mirrors `NamedResistances` (load-bundle.ts) structurally rather than
 * importing it -- this module otherwise has no dependency on load-bundle.ts,
 * encoding/decoding only plain data. */
export interface SharedResistances {
  readonly fire: number
  readonly water: number
  readonly thunder: number
  readonly ice: number
  readonly dragon: number
}

export interface SharedPick {
  readonly slotId: string
  readonly id: string
  readonly name: string
  readonly openSlotCount: number | null
  readonly grankOrLater: boolean
  readonly exoticSkillId: number | null
  /** A piece's display-only stats (docs/skill-system-roadmap.md's result-
   * card-redesign spec) -- kept here, unlike `category`/`hunterType`, since
   * `ResultCard` now sums these across a result's picks for its Stats
   * column. */
  readonly defenseMax: number | null
  readonly resistances: SharedResistances
}

export interface SharedDecoration {
  readonly id: string
  readonly name: string
  readonly slotSize: number
}

export interface SharedSlotDecorations {
  readonly slotId: string
  readonly decorations: readonly SharedDecoration[]
}

/** `skills` is kept (unlike a pick's) because `active-skill-cap.ts`'s
 * Hiden/cuff-exemption rule reads a cuff's own skill contributions
 * directly. */
export interface SharedCuff {
  readonly id: string
  readonly name: string
  readonly skills: readonly SkillContribution[]
}

export interface SharedBuildResult {
  readonly picks: readonly SharedPick[]
  readonly decorations: readonly SharedSlotDecorations[]
  readonly cuffs: readonly SharedCuff[]
  readonly skillTotals: readonly (readonly [number, number])[]
}

export interface SharedSearchState {
  readonly requirements: readonly SkillRequirement[]
  readonly zenithRequirements: readonly SkillRequirement[]
  readonly excludedCategories: readonly string[]
  readonly excludedCuffCategories: readonly string[]
  readonly excludedDecorationCategories: readonly string[]
  /** `null` means "use the app's own default" (the user never touched the
   * weapon Zenith-skill checklist) -- mirrors `App.tsx`'s own
   * `excludedWeaponZenithSkillIds` state, so a shared link doesn't have to
   * freeze in a default that might later change. Only read by "use as a base
   * for a new search" -- the result's own weapon pick is what the display
   * itself shows. */
  readonly excludedWeaponZenithSkillIds: readonly string[] | null
  readonly weaponSlotCount: number
  readonly hunterTypeFilter: HunterTypeFilter
  /** Armor/decoration/cuff ids excluded by id (docs/skill-system-roadmap.md's
   * equipment-exclusion feature) -- same "use as a base for a new search"-only
   * role as the category exclusions above; the result's own picks already
   * came from whatever these were at share time regardless. */
  readonly excludedArmorIds: readonly string[]
  readonly excludedDecorationIds: readonly string[]
  readonly excludedCuffIds: readonly string[]
  readonly excludedSkillIds: readonly string[]
  /** Elements the original search required to stay at or above zero
   * (docs/feedback.md Round 1 #4) -- same "use as a base for a new
   * search"-only role as the exclusions above. */
  readonly nonNegativeResistances: readonly ResistanceElement[]
  readonly preferExactMatches: boolean
  readonly result: SharedBuildResult
}

/** The on-the-wire shape `SharedSearchState` is transcoded to/from --
 * short, order-dependent keys/tuples instead of the full interface's own
 * descriptive names, since every byte here gets repeated in a URL a person
 * might have to paste somewhere space-constrained (see this module's own
 * docstring). Internal to this module; nothing outside ever sees this
 * shape directly. */
interface WireFormat {
  readonly r: readonly (readonly [number, number])[]
  readonly zr: readonly (readonly [number, number])[]
  readonly ec: readonly string[]
  readonly ecc: readonly string[]
  readonly edc: readonly string[]
  readonly ewz: readonly string[] | null
  readonly wsc: number
  readonly htf: HunterTypeFilter
  readonly eai: readonly string[]
  readonly edi: readonly string[]
  readonly eci: readonly string[]
  readonly esi: readonly string[]
  readonly nnr: readonly ResistanceElement[]
  readonly pem: boolean
  readonly rp: readonly (readonly [
    string,
    string,
    string,
    number | null,
    boolean,
    number | null,
    number | null,
    readonly [number, number, number, number, number],
  ])[]
  readonly rd: readonly (readonly [string, readonly (readonly [string, string, number])[]])[]
  readonly rc: readonly (readonly [string, string, readonly (readonly [number, number])[]])[]
  readonly rt: readonly (readonly [number, number])[]
}

function toWireFormat(state: SharedSearchState): WireFormat {
  return {
    r: state.requirements.map((req) => [req.skillId, req.minPoints]),
    zr: state.zenithRequirements.map((req) => [req.skillId, req.minPoints]),
    ec: state.excludedCategories,
    ecc: state.excludedCuffCategories,
    edc: state.excludedDecorationCategories,
    ewz: state.excludedWeaponZenithSkillIds,
    wsc: state.weaponSlotCount,
    htf: state.hunterTypeFilter,
    eai: state.excludedArmorIds,
    edi: state.excludedDecorationIds,
    eci: state.excludedCuffIds,
    esi: state.excludedSkillIds,
    nnr: state.nonNegativeResistances,
    pem: state.preferExactMatches,
    rp: state.result.picks.map((p) => [
      p.slotId,
      p.id,
      p.name,
      p.openSlotCount,
      p.grankOrLater,
      p.exoticSkillId,
      p.defenseMax,
      [p.resistances.fire, p.resistances.water, p.resistances.thunder, p.resistances.ice, p.resistances.dragon],
    ]),
    rd: state.result.decorations.map((d) => [
      d.slotId,
      d.decorations.map((dec) => [dec.id, dec.name, dec.slotSize]),
    ]),
    rc: state.result.cuffs.map((c) => [
      c.id,
      c.name,
      c.skills.map((s) => [s.skillId, s.points]),
    ]),
    rt: state.result.skillTotals,
  }
}

/** Returns `null` for anything that doesn't decode into a usable
 * `SharedSearchState` (missing/wrong-typed fields) rather than throwing --
 * `decodeSharedState` follows the same fail-soft-with-null convention as
 * `resolvePinnedCuffs`'s "drop ids that no longer resolve", since a shared
 * link is user-facing input (pasted, possibly truncated or from before a
 * wire-format change) rather than trusted internal data. */
function fromWireFormat(parsed: unknown): SharedSearchState | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const p = parsed as Record<string, unknown>

  if (
    !Array.isArray(p.r) ||
    !Array.isArray(p.zr) ||
    !Array.isArray(p.ec) ||
    !Array.isArray(p.ecc) ||
    !Array.isArray(p.edc) ||
    (p.ewz !== null && !Array.isArray(p.ewz)) ||
    typeof p.wsc !== 'number' ||
    (p.htf !== 'blademaster' && p.htf !== 'gunner') ||
    !Array.isArray(p.eai) ||
    !Array.isArray(p.edi) ||
    !Array.isArray(p.eci) ||
    !Array.isArray(p.esi) ||
    !Array.isArray(p.nnr) ||
    !p.nnr.every((e) => RESISTANCE_ELEMENTS.includes(e)) ||
    typeof p.pem !== 'boolean' ||
    !Array.isArray(p.rp) ||
    !Array.isArray(p.rd) ||
    !Array.isArray(p.rc) ||
    !Array.isArray(p.rt)
  ) {
    return null
  }
  const w = p as unknown as WireFormat

  return {
    requirements: w.r.map(([skillId, minPoints]) => ({ skillId, minPoints })),
    zenithRequirements: w.zr.map(([skillId, minPoints]) => ({ skillId, minPoints })),
    excludedCategories: w.ec,
    excludedCuffCategories: w.ecc,
    excludedDecorationCategories: w.edc,
    excludedWeaponZenithSkillIds: w.ewz,
    weaponSlotCount: w.wsc,
    hunterTypeFilter: w.htf,
    excludedArmorIds: w.eai,
    excludedDecorationIds: w.edi,
    excludedCuffIds: w.eci,
    excludedSkillIds: w.esi,
    nonNegativeResistances: w.nnr,
    preferExactMatches: w.pem,
    result: {
      picks: w.rp.map(
        ([slotId, id, name, openSlotCount, grankOrLater, exoticSkillId, defenseMax, resistances]) => ({
          slotId,
          id,
          name,
          openSlotCount,
          grankOrLater,
          exoticSkillId,
          defenseMax,
          resistances: {
            fire: resistances[0],
            water: resistances[1],
            thunder: resistances[2],
            ice: resistances[3],
            dragon: resistances[4],
          },
        }),
      ),
      decorations: w.rd.map(([slotId, decorations]) => ({
        slotId,
        decorations: decorations.map(([id, name, slotSize]) => ({ id, name, slotSize })),
      })),
      cuffs: w.rc.map(([id, name, skills]) => ({
        id,
        name,
        skills: skills.map(([skillId, points]) => ({ skillId, points })),
      })),
      skillTotals: w.rt,
    },
  }
}

export async function encodeSharedState(state: SharedSearchState): Promise<string> {
  const json = JSON.stringify(toWireFormat(state))
  const compressed = await gzip(new TextEncoder().encode(json))
  return toBase64Url(compressed)
}

/** Returns `null` for anything that doesn't decode into a usable
 * `SharedSearchState` at all (malformed base64, not valid gzip, invalid
 * JSON, or a shape `fromWireFormat` rejects) -- see `fromWireFormat`'s own
 * docstring on why this fails soft instead of throwing. */
export async function decodeSharedState(encoded: string): Promise<SharedSearchState | null> {
  let json: string
  try {
    const compressed = fromBase64Url(encoded)
    const decompressed = await gunzip(compressed)
    json = new TextDecoder().decode(decompressed)
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  return fromWireFormat(parsed)
}

/** The hash-fragment prefix a shared-result link uses (`#/result/<encoded>`)
 * -- a hash route rather than a real path, since this is a static SPA with
 * no server-side rewrite rule to fall back to `index.html` for a deep path on
 * refresh or direct navigation (see this module's own docstring). */
export const RESULT_HASH_PREFIX = '#/result/'

export async function buildResultUrl(state: SharedSearchState): Promise<string> {
  const { origin, pathname } = window.location
  return `${origin}${pathname}${RESULT_HASH_PREFIX}${await encodeSharedState(state)}`
}

/** `true` when `window.location.hash` looks like a shared-result link --
 * purely a prefix check, resolvable synchronously (unlike decoding the
 * payload itself, see this module's own docstring on why decoding is now
 * async) so `AppRoot.tsx` can still make its "which page" decision
 * synchronously on mount. */
export function hasSharedResultHash(): boolean {
  return window.location.hash.startsWith(RESULT_HASH_PREFIX)
}

/** The encoded payload following `RESULT_HASH_PREFIX` in the current
 * location hash, or `null` if the hash isn't a shared-result link at all.
 * Doesn't decode it -- see `hasSharedResultHash`'s own docstring; callers
 * that need the decoded state call `decodeSharedState` themselves. */
export function encodedResultFromLocation(): string | null {
  const { hash } = window.location
  if (!hash.startsWith(RESULT_HASH_PREFIX)) return null
  return hash.slice(RESULT_HASH_PREFIX.length)
}
