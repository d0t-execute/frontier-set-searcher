import { useEffect, useRef, useState } from 'react'

export interface CategoryFilterOption {
  readonly key: string
  readonly label: string
}

/** An optional third tree level, nested between a group and its leaves, for
 * a group whose leaves naturally cluster into named sub-families (2026-10-20,
 * per the project owner: e.g. Guild -> Diva Defense -> Diva Defense Zenith
 * ZX). A group's own `categories` stays the full, flat list either way --
 * `sections` is purely a display grouping on top of it, so every "all
 * excluded"/"some excluded" computation and `setGroup` keep working
 * unchanged whether or not a group uses sections. */
export interface CategoryFilterSection {
  readonly label: string
  readonly categories: readonly CategoryFilterOption[]
}

export interface CategoryFilterGroup {
  readonly label: string
  readonly categories: readonly CategoryFilterOption[]
  readonly sections?: readonly CategoryFilterSection[]
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
  /** Builds the hash link a leaf's "Table" link points at --
   * CategoryTablePage.tsx's own route. Shown next to every leaf's "View"
   * toggle regardless of category size (2026-10-19, per the project owner:
   * a consistent link/button on every leaf, not just one conditionally
   * embedded in a "show more" overflow note). Takes just the category key
   * (not the item kind), so this component doesn't need to know about
   * `category-route.ts`'s `CategoryTableKind` strings itself -- a caller
   * with nothing meaningful to link to (e.g. the weapon Zenith skill tree,
   * which has no `itemsByCategory` at all) simply omits it. */
  readonly tableLinkHash?: (categoryKey: string) => string
  /** Starts every group (and, for a group with `sections`, every section)
   * collapsed instead of expanded (2026-10-20, per the project owner: with
   * the gear taxonomy now well past 150 leaves, "categories should start
   * collapsed"). Opt-in per caller rather than a global default, so the
   * smaller Poogie cuffs/Decorations/Weapon Zenith-skill trees keep their
   * original always-expanded behavior unless they ask for this too. */
  readonly defaultCollapsed?: boolean
}

/** A section's collapse state is tracked alongside its group's own, under a
 * `${groupLabel}::${sectionLabel}` key -- composite so two groups can each
 * have a same-named section (none do today) without colliding. */
function sectionKey(groupLabel: string, sectionLabel: string): string {
  return `${groupLabel}::${sectionLabel}`
}

export function CategoryFilter({
  groups,
  excludedCategories,
  onChange,
  itemsByCategory,
  tableLinkHash,
  defaultCollapsed = false,
}: CategoryFilterProps) {
  // Collapsed-by-label, not a boolean-per-group array, so a group's collapse
  // state survives `groups` changing identity (e.g. a parent re-render) as
  // long as its label doesn't. The initializer only runs once per mount, so
  // `defaultCollapsed` only affects a tree's *initial* shape -- the user is
  // still free to expand/collapse individual groups and sections afterward.
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() =>
    defaultCollapsed ? new Set(groups.map((group) => group.label)) : new Set(),
  )
  const [collapsedSections, setCollapsedSections] = useState<ReadonlySet<string>>(() =>
    defaultCollapsed
      ? new Set(
          groups.flatMap((group) =>
            (group.sections ?? []).map((section) => sectionKey(group.label, section.label)),
          ),
        )
      : new Set(),
  )

  function toggleGroupCollapsed(label: string): void {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  function toggleSectionCollapsed(key: string): void {
    setCollapsedSections((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function setLeaf(key: string, included: boolean): void {
    const next = new Set(excludedCategories)
    if (included) next.delete(key)
    else next.add(key)
    onChange(next)
  }

  function setCategories(categories: readonly CategoryFilterOption[], included: boolean): void {
    const next = new Set(excludedCategories)
    for (const category of categories) {
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
        const collapsed = collapsedGroups.has(group.label)
        return (
          <div className="category-group" key={group.label}>
            <div className="category-group-header">
              <button
                type="button"
                className="category-group-collapse-toggle"
                onClick={() => toggleGroupCollapsed(group.label)}
                aria-expanded={!collapsed}
                aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${group.label}`}
              >
                {collapsed ? '▸' : '▾'}
              </button>
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
                onChange={(checked) => setCategories(group.categories, checked)}
              />
            </div>
            {!collapsed && (
              <div className="category-group-children">
                {group.sections
                  ? group.sections.map((section) => {
                      const key = sectionKey(group.label, section.label)
                      const sectionCollapsed = collapsedSections.has(key)
                      const sectionExcludedCount = section.categories.filter((c) =>
                        excludedCategories.has(c.key),
                      ).length
                      const sectionAllExcluded = sectionExcludedCount === section.categories.length
                      const sectionSomeExcluded = sectionExcludedCount > 0 && !sectionAllExcluded
                      return (
                        <div className="category-section" key={section.label}>
                          <div className="category-section-header">
                            <button
                              type="button"
                              className="category-group-collapse-toggle"
                              onClick={() => toggleSectionCollapsed(key)}
                              aria-expanded={!sectionCollapsed}
                              // Composite, not just `${section.label}` --
                              // several groups re-use short section labels
                              // like "Base" (2026-10-20), so a bare label
                              // would produce more than one same-named
                              // "Expand Base" button once their groups are
                              // both open.
                              aria-label={`${sectionCollapsed ? 'Expand' : 'Collapse'} ${group.label}: ${section.label}`}
                            >
                              {sectionCollapsed ? '▸' : '▾'}
                            </button>
                            <GroupCheckbox
                              label={section.label}
                              checked={sectionExcludedCount === 0}
                              indeterminate={sectionSomeExcluded}
                              onChange={(checked) => setCategories(section.categories, checked)}
                              // Composite, not just `${section.label} (all)` --
                              // guards against the same cross-group label
                              // reuse described above.
                              ariaLabel={`${group.label}: ${section.label} (all)`}
                            />
                          </div>
                          {!sectionCollapsed && (
                            <div className="category-section-children">
                              {section.categories.map((category) => (
                                <CategoryLeaf
                                  key={category.key}
                                  category={category}
                                  checked={!excludedCategories.has(category.key)}
                                  onChange={(checked) => setLeaf(category.key, checked)}
                                  items={itemsByCategory?.get(category.key)}
                                  tableHref={tableLinkHash?.(category.key)}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })
                  : group.categories.map((category) => (
                      <CategoryLeaf
                        key={category.key}
                        category={category}
                        checked={!excludedCategories.has(category.key)}
                        onChange={(checked) => setLeaf(category.key, checked)}
                        items={itemsByCategory?.get(category.key)}
                        tableHref={tableLinkHash?.(category.key)}
                      />
                    ))}
              </div>
            )}
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
  /** Pre-built hash link for this leaf specifically (`tableLinkHash` already
   * applied to `category.key`), or `undefined` when the caller gave no
   * `tableLinkHash` at all. */
  readonly tableHref: string | undefined
}

/** One leaf checkbox, plus (when `items` is given) a "View" toggle that
 * expands the names of everything in this category (docs/feedback.md Round 1
 * #2). Its own component, not inlined in `CategoryFilter`'s `.map`, so the
 * expanded/collapsed state belongs to this one leaf rather than needing a
 * `Set<string>` of expanded keys threaded through the parent. */
function CategoryLeaf({ category, checked, onChange, items, tableHref }: CategoryLeafProps) {
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
        {items && items.length > 0 && tableHref && (
          <a href={tableHref} className="btn btn-sm btn-link p-0 category-leaf-table-link">
            Table
          </a>
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
  /** Overrides the default `${label} (all)` accessible name -- needed only
   * when a leaf doesn't share the group's own display text (e.g.
   * `App.tsx`'s "Resistances" toggle-all checkbox, 2026-10-17 per user
   * feedback, whose leaves are "Fire"/"Water"/etc, not "Resistances"). */
  readonly ariaLabel?: string
}

/** A checkbox whose `indeterminate` visual state (neither fully checked nor
 * unchecked) is DOM-only -- React has no prop for it, so it has to be set
 * imperatively via a ref, matching the platform's own checkbox behavior.
 * Exported for reuse anywhere else a "toggle every leaf below" control over
 * a flat set of checkboxes is needed, not just a `CategoryFilter` group. */
export function GroupCheckbox({
  label,
  checked,
  indeterminate,
  onChange,
  ariaLabel,
}: GroupCheckboxProps) {
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
          aria-label={ariaLabel ?? `${label} (all)`}
        />
        {label}
      </label>
    </div>
  )
}
