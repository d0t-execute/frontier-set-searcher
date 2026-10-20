/**
 * Lets the player name one or more gear categories the solver should favor
 * using several pieces from, and how many (1-5) -- same soft-preference
 * family as `PreferredArmorPicker.tsx`'s own named-piece pool (2026-10-20,
 * per the project owner: "a strong benefit from using exactly one piece from
 * a specific category", generalized to any count and to several categories
 * at once, e.g. "2 from category A and 3 from category B"). Threaded
 * straight through to `SearchOptions.preferredCategoryCounts` (see its own
 * docstring for the solver-side mechanics, and why this needs a `count`
 * where `PreferredArmorPicker` doesn't).
 *
 * Same flat "search to add, list to remove" interaction as
 * `PreferredArmorPicker.tsx`, but searching the static gear-category tree
 * (every leaf's own label) instead of the live armor-candidate pool, and
 * with an extra per-entry count control `PreferredArmorPicker` has no
 * equivalent of.
 */

import { useCallback, useMemo, useState } from 'react'
import { GEAR_CATEGORY_GROUPS } from '../search-engine/gear-categories'
import { FilterableOptions } from './FilterableOptions'
import { handleEnterToPickFirst } from './pick-first-match'

/** Every piece-count the game's own armor slots allow favoring at once
 * (head/chest/arms/waist/legs) -- see `PreferredCategoryCount.count`'s own
 * docstring. */
export const MAX_PREFERRED_CATEGORY_COUNT = 5

interface NamedCategory {
  readonly id: string
  readonly name: string
}

// Flattened once at module load -- `GEAR_CATEGORY_GROUPS` is static data, not
// per-query, so there's nothing to recompute per render (same reasoning the
// module itself is a top-level constant, not a hook).
const ALL_GEAR_CATEGORIES: readonly NamedCategory[] = GEAR_CATEGORY_GROUPS.flatMap((group) =>
  group.categories.map((c) => ({ id: c.key, name: c.label })),
)

export interface PreferredCategoryPickerProps {
  readonly counts: ReadonlyMap<string, number>
  readonly onChange: (next: Map<string, number>) => void
}

export function PreferredCategoryPicker({ counts, onChange }: PreferredCategoryPickerProps) {
  const [search, setSearch] = useState('')
  const labelById = useMemo(() => new Map(ALL_GEAR_CATEGORIES.map((c) => [c.id, c.name])), [])

  const pickableMatches = useCallback(
    (item: NamedCategory, query: string) =>
      !counts.has(item.id) && item.name.toLowerCase().includes(query),
    [counts],
  )
  const pickableCategories = useMemo(
    () => ALL_GEAR_CATEGORIES.filter((c) => !counts.has(c.id)),
    [counts],
  )

  function add(category: string): void {
    const next = new Map(counts)
    next.set(category, 1)
    onChange(next)
    setSearch('')
  }

  function remove(category: string): void {
    const next = new Map(counts)
    next.delete(category)
    onChange(next)
  }

  function setCount(category: string, count: number): void {
    const next = new Map(counts)
    next.set(category, count)
    onChange(next)
  }

  return (
    <div>
      {counts.size > 0 && (
        <div className="mb-1">
          {[...counts].map(([category, count]) => (
            <div
              key={category}
              className="d-flex align-items-center gap-2 mb-1 preferred-category-row"
            >
              <span className="flex-grow-1">{labelById.get(category) ?? category}</span>
              <select
                className="form-select form-select-sm w-auto"
                aria-label={`Number of pieces to prefer from ${labelById.get(category) ?? category}`}
                value={count}
                onChange={(e) => setCount(category, Number(e.target.value))}
              >
                {Array.from({ length: MAX_PREFERRED_CATEGORY_COUNT }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label={`Remove ${labelById.get(category) ?? category}`}
                className="btn-close"
                style={{ fontSize: '0.65rem' }}
                onClick={() => remove(category)}
              />
            </div>
          ))}
        </div>
      )}
      <input
        type="text"
        className="form-control form-control-sm decoration-search-input d-inline-block"
        aria-label="Search gear categories to prefer"
        placeholder="Type to search…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) =>
          handleEnterToPickFirst(e, pickableCategories, search, (item) => add(item.id))
        }
      />
      <FilterableOptions
        items={ALL_GEAR_CATEGORIES}
        search={search}
        ariaLabel="Gear categories matching search to prefer"
        matches={pickableMatches}
        onPick={(item) => add(item.id)}
      />
    </div>
  )
}
