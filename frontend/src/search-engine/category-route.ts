/**
 * The hash route for a "show every item in this category" table page (see
 * CategoryTablePage.tsx) -- a sibling to shared-state.ts's own
 * `RESULT_HASH_PREFIX` hash route, same reasoning (no server-side rewrite to
 * fall back on in this static SPA, so a real path would 404 on a hard
 * refresh or a shared link).
 */

export type CategoryTableKind = 'gear' | 'cuffs' | 'decorations'

export interface CategoryRoute {
  readonly kind: CategoryTableKind
  readonly categoryKey: string
}

export const CATEGORY_HASH_PREFIX = '#/category/'

function isCategoryTableKind(value: string): value is CategoryTableKind {
  return value === 'gear' || value === 'cuffs' || value === 'decorations'
}

/** The hash a "show more" link should point at for a given category --
 * `CategoryFilter`'s own link-building, kept here instead so it doesn't need
 * to know this route's own encoding. */
export function categoryRouteHash(kind: CategoryTableKind, categoryKey: string): string {
  return `${CATEGORY_HASH_PREFIX}${kind}/${encodeURIComponent(categoryKey)}`
}

/** Parses the current location hash into a `CategoryRoute`, or `null` if it
 * doesn't point at one -- mirrors `shared-state.ts`'s
 * `encodedResultFromLocation`. */
export function categoryRouteFromLocation(): CategoryRoute | null {
  const { hash } = window.location
  if (!hash.startsWith(CATEGORY_HASH_PREFIX)) return null
  const rest = hash.slice(CATEGORY_HASH_PREFIX.length)
  const slashIndex = rest.indexOf('/')
  if (slashIndex === -1) return null
  const kind = rest.slice(0, slashIndex)
  if (!isCategoryTableKind(kind)) return null
  return { kind, categoryKey: decodeURIComponent(rest.slice(slashIndex + 1)) }
}
