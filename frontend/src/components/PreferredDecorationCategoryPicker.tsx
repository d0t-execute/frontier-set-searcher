/**
 * Lets the player mark whole decoration categories as preferred (2026-11-08):
 * every decoration in a picked leaf counts as preferred, on top of any
 * individually named in the decoration list beside it -- see build-query.ts's
 * `QueryFormState.preferredDecorationCategories`. Same "search to add, badge
 * list to remove" interaction as `PreferredArmorPicker`, over the static
 * `DECORATION_CATEGORY_GROUPS` leaves. No per-entry count the way
 * `PreferredCategoryPicker` has: decorations aren't limited to one per slot,
 * so "how many from this category" has no natural ceiling to aim for.
 */

import { useCallback, useMemo, useState } from 'react'
import { DECORATION_CATEGORY_GROUPS } from '../search-engine/decoration-categories'
import { FilterableOptions } from './FilterableOptions'
import { handleEnterToPickFirst } from './pick-first-match'

interface NamedCategory {
  readonly id: string
  readonly name: string
}

// Leaf labels alone are ambiguous ("Rafan", "Heruto"), so each carries its
// group's label unless the two already say the same thing.
const ALL_DECORATION_CATEGORIES: readonly NamedCategory[] = DECORATION_CATEGORY_GROUPS.flatMap(
  (group) =>
    group.categories.map((c) => ({
      id: c.key,
      name: c.label === group.label ? c.label : `${group.label}: ${c.label}`,
    })),
)

export interface PreferredDecorationCategoryPickerProps {
  readonly selected: ReadonlySet<string>
  readonly onChange: (next: Set<string>) => void
}

export function PreferredDecorationCategoryPicker({
  selected,
  onChange,
}: PreferredDecorationCategoryPickerProps) {
  const [search, setSearch] = useState('')
  const labelById = useMemo(() => new Map(ALL_DECORATION_CATEGORIES.map((c) => [c.id, c.name])), [])
  const pickableMatches = useCallback(
    (item: NamedCategory, query: string) =>
      !selected.has(item.id) && item.name.toLowerCase().includes(query),
    [selected],
  )
  const pickable = useMemo(
    () => ALL_DECORATION_CATEGORIES.filter((c) => !selected.has(c.id)),
    [selected],
  )

  function add(id: string): void {
    onChange(new Set(selected).add(id))
    setSearch('')
  }

  function remove(id: string): void {
    const next = new Set(selected)
    next.delete(id)
    onChange(next)
  }

  return (
    <div>
      {selected.size > 0 && (
        <div className="mb-1">
          {[...selected].map((id) => {
            const name = labelById.get(id) ?? id
            return (
              <span key={id} className="badge text-bg-secondary me-1">
                {name}{' '}
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  className="btn-close btn-close-white"
                  style={{ fontSize: '0.5rem' }}
                  onClick={() => remove(id)}
                />
              </span>
            )
          })}
        </div>
      )}
      <input
        type="text"
        className="form-control form-control-sm decoration-search-input d-inline-block"
        aria-label="Search decoration categories to prefer"
        placeholder="Type to search…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => handleEnterToPickFirst(e, pickable, search, (item) => add(item.id))}
      />
      <FilterableOptions
        items={ALL_DECORATION_CATEGORIES}
        search={search}
        ariaLabel="Decoration categories matching search to prefer"
        matches={pickableMatches}
        onPick={(item) => add(item.id)}
      />
    </div>
  )
}
