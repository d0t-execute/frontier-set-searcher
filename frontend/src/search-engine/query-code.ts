/**
 * Encodes/decodes a `SearchFormState` as a compact, shareable text code
 * (docs/feedback.md Round 1 #18: "save a skill-set/query... a text input
 * mapped to a specific saved query"). Distinct from this module's sibling
 * `search-form-state.ts`'s own `localStorage` auto-persistence: that always
 * restores the player's single *last* search on reload; this lets them keep
 * and reuse *any number* of distinct searches, by pasting a code back in
 * whenever they want one of them again -- including sharing it with someone
 * else, the same way `shared-state.ts` already does for a solved result.
 *
 * Reuses `codec.ts`'s gzip + base64url codec (the same one `shared-state.ts`
 * uses for its own, much larger, build-result links) -- a `SearchFormState`
 * carries only search inputs, never a solved result, so it's already small;
 * no need for that module's own short-key wire-format tupling on top.
 */

import { fromBase64Url, gunzip, gzip, toBase64Url } from './codec'
import { validateSearchFormState } from './search-form-state'
import type { SearchFormState } from './search-form-state'

export async function encodeQueryCode(state: SearchFormState): Promise<string> {
  const json = JSON.stringify(state)
  const compressed = await gzip(new TextEncoder().encode(json))
  return toBase64Url(compressed)
}

/** Returns `null` for anything that doesn't decode into a usable
 * `SearchFormState` at all (malformed base64, not valid gzip, invalid JSON,
 * or a shape `validateSearchFormState` rejects) -- a pasted code is
 * user-facing input (possibly mistyped, truncated, or from before a
 * `SearchFormState` shape change), not trusted internal data, so this fails
 * soft rather than throwing -- same convention `decodeSharedState` already
 * follows for the exact same reasons. */
export async function decodeQueryCode(code: string): Promise<SearchFormState | null> {
  let json: string
  try {
    const compressed = fromBase64Url(code.trim())
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
  return validateSearchFormState(parsed)
}
