import { useEffect, useRef, useState } from 'react'

export interface CategoryFilterOption {
  readonly key: string
  readonly label: string
}

export interface CategoryFilterGroup {
  readonly label: string
  readonly categories: readonly CategoryFilterOption[]
}

/** The maximum number of item names shown when a leaf's contents are
 * expanded -- some categories (e.g. a real armor slot's G-Rank leaf) run into
 * the thousands, far too many to usefully render or scroll through at once.
 * Same "cap and say how many more" convention as `FilterableOptions`'
 * `MAX_MATCHES_SHOWN`. */
const MAX_CATEGORY_CONTENTS_SHOWN = 100

export interface CategoryFilterProps {
  readonly groups: readonly CategoryFilterGroup[]
  /** Category keys currently excluded from search results. Empty means no
   * filtering -- every category is included, matching the reference
   * tool's all-checked-by-default checkbox tree. */
  readonly excludedCategories: ReadonlySet<string>
  readonly onChange: (next: Set<string>) => void
  /** Every item's own display name, grouped by the category key it belongs
   * to (docs/feedback.md Round 1 #2: "see what's actually in a category") --
   * when given, each leaf gets a "View" toggle that expands the names of
   * everything in it, so a filter's effect isn't a guess from its label
   * alone. Omitted entirely by a caller with nothing meaningful to show per
   * category (none exist today, but keeps this prop optional rather than
   * forcing every call site to pass an always-present but sometimes-pointless
   * map). */
  readonly itemsByCategory?: ReadonlyMap<string, readonly { readonly name: string }[]>
}

export function CategoryFilter({
  groups,
  excludedCategories,
  onChange,
  itemsByCategory,
}: CategoryFilterProps) {
  function setLeaf(key: string, included: boolean): void {
    const next = new Set(excludedCategories)
    if (included) next.delete(key)
    else next.add(key)
    onChange(next)
  }

  function setGroup(group: CategoryFilterGroup, included: boolean): void {
    const next = new Set(excludedCategories)
    for (const category of group.categories) {
      if (included) next.delete(category.key)
      else next.add(category.key)
    }
    onChange(next)
  }

  return (
    <div className="category-filter">
      {groups.map((group) => {
        const excludedCount = group.categories.filter((c) => excludedCategories.has(c.key)).length
        const allExcluded = excludedCount === group.categories.length
        const someExcluded = excludedCount > 0 && !allExcluded
        return (
          <div className="category-group" key={group.label}>
            <GroupCheckbox
              label={group.label}
              // Fully checked only when nothing in the group is excluded --
              // a partial selection renders unchecked-but-indeterminate, so a
              // click always lands on "include everything" first rather
              // than immediately excluding the rest (native checkboxes
              // toggle their own `checked` value on click regardless of
              // `indeterminate`, which is purely visual).
              checked={excludedCount === 0}
              indeterminate={someExcluded}
              onChange={(checked) => setGroup(group, checked)}
            />
            <div className="category-group-children">
              {group.categories.map((category) => (
                <CategoryLeaf
                  key={category.key}
                  category={category}
                  checked={!excludedCategories.has(category.key)}
                  onChange={(checked) => setLeaf(category.key, checked)}
                  items={itemsByCategory?.get(category.key)}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

interface CategoryLeafProps {
  readonly category: CategoryFilterOption
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
  readonly items: readonly { readonly name: string }[] | undefined
}

/** One leaf checkbox, plus (when `items` is given) a "View" toggle that
 * expands the names of everything in this category (docs/feedback.md Round 1
 * #2). Its own component, not inlined in `CategoryFilter`'s `.map`, so the
 * expanded/collapsed state belongs to this one leaf rather than needing a
 * `Set<string>` of expanded keys threaded through the parent. */
function CategoryLeaf({ category, checked, onChange, items }: CategoryLeafProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="category-leaf">
      <div className="form-check d-flex align-items-center gap-1">
        <input
          type="checkbox"
          className="form-check-input"
          id={`gear-category-${category.key}`}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <label className="form-check-label" htmlFor={`gear-category-${category.key}`}>
          {category.label}
        </label>
        {items && items.length > 0 && (
          <button
            type="button"
            className="btn btn-sm btn-link p-0 category-leaf-view-toggle"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
          >
            {expanded ? 'Hide' : `View (${items.length})`}
          </button>
        )}
      </div>
      {expanded && items && (
        <div className="category-leaf-contents small text-muted">
          {items
            .slice(0, MAX_CATEGORY_CONTENTS_SHOWN)
            .map((item) => item.name)
            .join(', ')}
          {items.length > MAX_CATEGORY_CONTENTS_SHOWN && (
            <> , and {items.length - MAX_CATEGORY_CONTENTS_SHOWN} more</>
          )}
        </div>
      )}
    </div>
  )
}

interface GroupCheckboxProps {
  readonly label: string
  readonly checked: boolean
  readonly indeterminate: boolean
  readonly onChange: (checked: boolean) => void
}

/** A checkbox whose `indeterminate` visual state (neither fully checked nor
 * unchecked) is DOM-only -- React has no prop for it, so it has to be set
 * imperatively via a ref, matching the platform's own checkbox behavior. */
function GroupCheckbox({ label, checked, indeterminate, onChange }: GroupCheckboxProps) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <div className="form-check">
      <label className="form-check-label fw-bold">
        <input
          ref={ref}
          type="checkbox"
          className="form-check-input"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          // A leaf category can legitimately share its group's display text
          // (e.g. group "Guild" has a plain "Guild" leaf) -- aria-label
          // keeps this checkbox's accessible name distinct from any leaf's,
          // without changing what's shown on screen.
          aria-label={`${label} (all)`}
        />
        {label}
      </label>
    </div>
  )
}
