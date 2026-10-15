import { useEffect, useRef } from 'react'

export interface CategoryFilterOption {
  readonly key: string
  readonly label: string
}

export interface CategoryFilterGroup {
  readonly label: string
  readonly categories: readonly CategoryFilterOption[]
}

export interface CategoryFilterProps {
  readonly groups: readonly CategoryFilterGroup[]
  /** Category keys currently excluded from search results. Empty means no
   * filtering -- every category is included, matching the reference
   * tool's all-checked-by-default checkbox tree. */
  readonly excludedCategories: ReadonlySet<string>
  readonly onChange: (next: Set<string>) => void
}

export function CategoryFilter({ groups, excludedCategories, onChange }: CategoryFilterProps) {
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
                <div className="form-check category-leaf" key={category.key}>
                  <input
                    type="checkbox"
                    className="form-check-input"
                    id={`gear-category-${category.key}`}
                    checked={!excludedCategories.has(category.key)}
                    onChange={(e) => setLeaf(category.key, e.target.checked)}
                  />
                  <label className="form-check-label" htmlFor={`gear-category-${category.key}`}>
                    {category.label}
                  </label>
                </div>
              ))}
            </div>
          </div>
        )
      })}
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
