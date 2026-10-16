/**
 * A type-to-filter `<select>`: renders nothing until `search` reaches
 * `MIN_SEARCH_LENGTH`, then at most `MAX_MATCHES_SHOWN` case-insensitive
 * substring matches, with a note when more exist than fit. Shared by
 * ArmorPicker and CuffPicker -- both need to pick one item out of a catalog
 * too large for a plain `<select>` to be usable (a real armor slot: tens of
 * thousands of pieces; the cuff catalog: thousands -- see ArmorPicker's own
 * docstring).
 *
 * Renders nothing at all below `MIN_SEARCH_LENGTH` (2026-10-15, per the
 * project owner) -- this used to print its own "Type at least 2 characters
 * to search" hint per field, which multiplied into a wall of identical text
 * once a page has several of these (ArmorPicker alone renders up to two per
 * armor slot). Callers state the hint once, in their own section intro,
 * instead.
 */

export const MIN_SEARCH_LENGTH = 2
export const MAX_MATCHES_SHOWN = 30

/** Default match rule: a case-insensitive substring of the item's own name --
 * overridden by a caller that wants to match on something else too (e.g.
 * `ArmorPicker`'s piece search also matching against the skills a piece
 * grants, 2026-10-16 per user feedback: "searching armor pieces by skills...
 * rather than by the armor piece name itself"). */
function defaultMatches<T extends { readonly name: string }>(item: T, query: string): boolean {
  return item.name.toLowerCase().includes(query)
}

export function FilterableOptions<T extends { readonly id: string; readonly name: string }>({
  items,
  search,
  onPick,
  ariaLabel,
  matches = defaultMatches,
}: {
  items: readonly T[]
  search: string
  onPick: (item: T) => void
  ariaLabel: string
  /** Overrides the default name-substring match rule -- `query` is already
   * trimmed and lowercased the same way the default rule's own check is. */
  matches?: (item: T, query: string) => boolean
}) {
  if (search.trim().length < MIN_SEARCH_LENGTH) {
    return null
  }

  const query = search.trim().toLowerCase()
  const allMatches = items.filter((item) => matches(item, query))
  const shown = allMatches.slice(0, MAX_MATCHES_SHOWN)

  if (allMatches.length === 0) {
    return <div className="form-text">No matches.</div>
  }

  return (
    <div>
      <select
        className="form-select"
        aria-label={ariaLabel}
        size={Math.max(2, Math.min(shown.length, 8))}
        value=""
        onChange={(e) => {
          const item = shown.find((i) => i.id === e.target.value)
          if (item) onPick(item)
        }}
      >
        <option value="" disabled hidden />
        {shown.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      {allMatches.length > shown.length && (
        <div className="form-text">
          {allMatches.length} matches -- showing the first {shown.length}. Keep typing to narrow it
          down.
        </div>
      )}
    </div>
  )
}
