/**
 * A type-to-filter `<select>`: renders nothing until `search` reaches
 * `MIN_SEARCH_LENGTH`, then at most `MAX_MATCHES_SHOWN` case-insensitive
 * substring matches, with a note when more exist than fit. Shared by
 * ArmorPicker and CuffPicker -- both need to pick one item out of a catalog
 * too large for a plain `<select>` to be usable (a real armor slot: tens of
 * thousands of pieces; the cuff catalog: thousands -- see ArmorPicker's own
 * docstring).
 */

export const MIN_SEARCH_LENGTH = 2
export const MAX_MATCHES_SHOWN = 30

export function FilterableOptions<T extends { readonly id: string; readonly name: string }>({
  items,
  search,
  onPick,
  ariaLabel,
}: {
  items: readonly T[]
  search: string
  onPick: (item: T) => void
  ariaLabel: string
}) {
  if (search.trim().length < MIN_SEARCH_LENGTH) {
    return (
      <div className="form-text">Type at least {MIN_SEARCH_LENGTH} characters to search.</div>
    )
  }

  const query = search.trim().toLowerCase()
  const matches = items.filter((item) => item.name.toLowerCase().includes(query))
  const shown = matches.slice(0, MAX_MATCHES_SHOWN)

  if (matches.length === 0) {
    return <div className="form-text">No matches.</div>
  }

  return (
    <div>
      <select
        className="form-select"
        aria-label={ariaLabel}
        size={Math.min(shown.length, 8)}
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
      {matches.length > shown.length && (
        <div className="form-text">
          {matches.length} matches -- showing the first {shown.length}. Keep typing to narrow it
          down.
        </div>
      )}
    </div>
  )
}
