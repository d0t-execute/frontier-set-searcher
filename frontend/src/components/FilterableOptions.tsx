/**
 * A type-to-filter result list: renders nothing until `search` reaches
 * `MIN_SEARCH_LENGTH`, then at most `MAX_MATCHES_SHOWN` case-insensitive
 * substring matches, with a note when more exist than fit. Shared by
 * ArmorPicker, CuffPicker and EquipmentExclusionPicker -- all three need to
 * pick one item out of a catalog too large for a plain `<select>` to be
 * usable (a real armor slot: tens of thousands of pieces; the cuff catalog:
 * thousands -- see ArmorPicker's own docstring).
 *
 * Renders a custom clickable/hoverable `listbox`/`option` list rather than a
 * native `<select>` -- a native `<option>` cannot be meaningfully CSS-styled
 * on hover across browsers, which made it hard to tell what you were about
 * to pick when scanning a long list (2026-10-18, per the project owner,
 * contrasting this with SkillPicker's custom list, which already had working
 * hover/active styling). Mirrors SkillPicker's `.skill-add-option` pattern.
 *
 * Renders nothing at all below `MIN_SEARCH_LENGTH` (2026-10-15, per the
 * project owner) -- this used to print its own "Type at least 2 characters
 * to search" hint per field, which multiplied into a wall of identical text
 * once a page has several of these (ArmorPicker alone renders up to two per
 * armor slot). Callers state the hint once, in their own section intro,
 * instead.
 */

export const MIN_SEARCH_LENGTH = 2
// Only bounds how many of the already-computed matches get rendered as DOM
// options -- the expensive part (scanning the whole catalog for matches) runs
// regardless of this number, so raising it costs rendering ~170 more small
// `<div>`s, not more scanning. Raised from 30 (2026-10-19, per the project
// owner: 30 felt low against catalogs this large, especially when searching
// by skill name where many pieces can share one skill).
export const MAX_MATCHES_SHOWN = 200

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
  describe,
  onHoverChange,
}: {
  items: readonly T[]
  search: string
  onPick: (item: T) => void
  ariaLabel: string
  /** Overrides the default name-substring match rule -- `query` is already
   * trimmed and lowercased the same way the default rule's own check is. */
  matches?: (item: T, query: string) => boolean
  /** Rendered as each option's `title`, shown on hover -- e.g. the skills a
   * piece/decoration/cuff grants (2026-10-17, per user feedback: "hovering
   * over it would also show the skills that it has"). Omitted entirely by a
   * caller with nothing meaningful to show (e.g. no skill catalog in
   * scope). */
  describe?: (item: T) => string | undefined
  /** Fired with the item under the pointer, and with `null` once the pointer
   * leaves it -- lets a caller (e.g. ArmorSlotPicker) show a persistent,
   * always-visible summary of the hovered item instead of relying on the
   * one-at-a-time native tooltip from `describe` (2026-10-18, per the
   * project owner: tedious to hover each piece individually to see its
   * skills when scanning a long list). */
  onHoverChange?: (item: T | null) => void
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
      <div className="filterable-options" role="listbox" aria-label={ariaLabel}>
        {shown.map((item) => (
          <div
            key={item.id}
            role="option"
            aria-selected="false"
            className="filterable-option"
            title={describe?.(item)}
            onMouseEnter={() => onHoverChange?.(item)}
            onMouseLeave={() => onHoverChange?.(null)}
            onClick={() => onPick(item)}
          >
            {item.name}
          </div>
        ))}
      </div>
      {allMatches.length > shown.length && (
        <div className="form-text">
          {allMatches.length} matches -- showing the first {shown.length}. Keep typing to narrow it
          down.
        </div>
      )}
    </div>
  )
}
