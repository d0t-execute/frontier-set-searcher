/**
 * Lets a search `<input>` paired with `FilterableOptions` be driven entirely
 * from the keyboard -- "type a skill name, enter, type a skill name, enter"
 * (2026-10-17, per the project owner), rather than needing to tab into (or
 * click) the `<select>` listbox `FilterableOptions` renders as a sibling
 * element. Kept out of `FilterableOptions.tsx` itself so that file only
 * exports the one component (React Fast Refresh requirement, enforced by
 * this project's lint config -- see `pinned-armor.ts`'s own docstring for
 * the same convention elsewhere).
 */

import type { KeyboardEvent } from 'react'
import { MIN_SEARCH_LENGTH } from './FilterableOptions'

function defaultMatches<T extends { readonly name: string }>(item: T, query: string): boolean {
  return item.name.toLowerCase().includes(query)
}

/** The first match `FilterableOptions` itself would render for the same
 * `items`/`search`/`matches`, or `undefined` if there isn't one (below
 * `MIN_SEARCH_LENGTH`, or no match at all). */
export function firstMatch<T extends { readonly id: string; readonly name: string }>(
  items: readonly T[],
  search: string,
  matches: (item: T, query: string) => boolean = defaultMatches,
): T | undefined {
  if (search.trim().length < MIN_SEARCH_LENGTH) return undefined
  const query = search.trim().toLowerCase()
  return items.find((item) => matches(item, query))
}

/** `onKeyDown` handler for a search `<input>` paired with a sibling
 * `FilterableOptions`: Enter picks `firstMatch`'s result. Every
 * `ArmorPicker`/`CuffPicker`/`EquipmentExclusionPicker` search shares this
 * one handler rather than each re-deriving the top match itself. */
export function handleEnterToPickFirst<T extends { readonly id: string; readonly name: string }>(
  e: KeyboardEvent<HTMLInputElement>,
  items: readonly T[],
  search: string,
  onPick: (item: T) => void,
  matches?: (item: T, query: string) => boolean,
): void {
  if (e.key !== 'Enter') return
  const match = firstMatch(items, search, matches)
  if (match) {
    e.preventDefault()
    onPick(match)
  }
}
