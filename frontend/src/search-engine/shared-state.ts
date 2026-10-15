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
 *
 * Encoding (docs/skill-system-roadmap.md TODO #14): the project owner
 * reported real links coming out longer than Discord allows a non-Nitro user
 * to post in one message (2000 characters). The wire format below combines
 * the two cheapest wins that don't require giving up the "fully static, no
 * backend" property: short field names/tuple-shaped arrays instead of
 * `JSON.stringify`ing `SharedSearchState` verbatim (see `toWireFormat`/
 * `fromWireFormat`), and gzip compression of the resulting JSON via the
 * browser's native `CompressionStream`/`DecompressionStream` (no new
 * dependency; supported in every current evergreen browser). A disposable
 * size-check script comparing both against the previous plain-base64
 * encoding showed short-keys-alone roughly halving link size, and adding
 * gzip on top roughly halving it again. Compression makes encode/decode
 * inherently `async` (`DecompressionStream` is a streams API) -- this
 * ripples into `buildResultUrl`/`readSharedStateFromLocation`'s own callers
 * (`AppRoot.tsx` now only checks the hash prefix synchronously and hands the
 * still-encoded string to `ResultPage.tsx`, which decodes it itself
 * alongside its own already-async solver reconstruction; `App.tsx`'s
 * "Get shareable link" button awaits the encode before showing the link).
 *
 * Breaking change, not versioned: a link encoded before this change cannot
 * be decoded afterwards (same as any other `SharedSearchState` shape change
 * -- see TODO #11's own note on this; no migration attempted).
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
  readonly pa: readonly (readonly [string, string, readonly string[]])[]
  readonly pc: readonly string[]
  readonly pem: boolean
  readonly ri: number
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
    pa: state.pinnedArmor.map(([slotId, pin]) => [slotId, pin.candidateId, pin.decorationIds]),
    pc: state.pinnedCuffIds,
    pem: state.preferExactMatches,
    ri: state.resultIndex,
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
    !Array.isArray(p.pa) ||
    !Array.isArray(p.pc) ||
    typeof p.pem !== 'boolean' ||
    typeof p.ri !== 'number'
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
    pinnedArmor: w.pa.map(([slotId, candidateId, decorationIds]) => [
      slotId,
      { candidateId, decorationIds },
    ]),
    pinnedCuffIds: w.pc,
    preferExactMatches: w.pem,
    resultIndex: w.ri,
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(encoded: string): Uint8Array {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// A `Uint8Array`'s own `.buffer` is typed as the wider `ArrayBufferLike`
// (it could in principle be a `SharedArrayBuffer`) -- `BodyInit`/`Blob` only
// accept a concrete `ArrayBuffer`, and the DOM lib's generic
// `Uint8Array<ArrayBuffer>` vs. `Uint8Array<ArrayBufferLike>` typings don't
// reconcile cleanly here. An explicit copy into a fresh `ArrayBuffer`
// sidesteps that without an unsound cast.
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer
}

// Routed through `Response` rather than `Blob.stream()` (jsdom's own `Blob`
// polyfill -- the test environment this runs under -- doesn't implement
// `.stream()`, unlike every real browser's). `Response`'s body is always
// present for a body constructed from bytes, never null -- the `!` reflects
// that, not an assumption this could fail silently.
async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const compressed = new Response(toArrayBuffer(bytes)).body!.pipeThrough(
    new CompressionStream('gzip'),
  )
  return new Uint8Array(await new Response(compressed).arrayBuffer())
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const decompressed = new Response(toArrayBuffer(bytes)).body!.pipeThrough(
    new DecompressionStream('gzip'),
  )
  return new Uint8Array(await new Response(decompressed).arrayBuffer())
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
