/**
 * The "show more" destination for a gear-level/cuff/decoration category
 * whose contents outgrow `CategoryFilter`'s own inline `MAX_CATEGORY_CONTENTS_SHOWN`
 * name list (see `components/CategoryFilter.tsx`'s "View" toggle and
 * `search-engine/category-route.ts`'s hash route) -- a full, sortable table
 * of every item in that one category, with every attribute the ETL exports
 * for it (2026-10-19, per the project owner: "a page with a sortable table
 * of the gear in that category that should show every exported attribute").
 *
 * Loads the data bundle itself (via the same `useDataBundle` cache `App`
 * uses) rather than requiring one be passed in -- this page can be reached
 * directly (a hard refresh, or a link someone shared), same reasoning as
 * `ResultPage.tsx`.
 *
 * Filterable by name and by skill (2026-10-20, per the project owner) --
 * the skill filter matches a skill's own name and its tier/threshold labels
 * (e.g. "BBQ Master"), the same "search by skill name and skill level/
 * threshold names" extension every other skill search box in the app
 * already makes. The armor table is also filterable by hunter type
 * (Blademaster/Gunner, both checked by default) -- unlike the main search
 * form's single-select `HunterTypeToggle` (which always needs exactly one
 * hunter type to solve against), these are independent checkboxes purely for
 * browsing, so a "common" (both-type) piece always stays visible regardless
 * of which boxes are checked.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useDataBundle } from './data/useDataBundle'
import type { CategoryTableKind } from './search-engine/category-route'
import { CUFF_CATEGORY_GROUPS } from './search-engine/cuff-categories'
import { DECORATION_CATEGORY_GROUPS } from './search-engine/decoration-categories'
import { GEAR_CATEGORY_GROUPS } from './search-engine/gear-categories'
import { CategoryFilter } from './components/CategoryFilter'
import type { CategoryFilterGroup } from './components/CategoryFilter'
import type {
  DataBundle,
  HunterType,
  NamedCandidate,
  NamedCuff,
  NamedDecoration,
} from './search-engine/load-bundle'
import type { SkillContribution } from './search-engine/types'

export interface CategoryTablePageProps {
  readonly kind: CategoryTableKind
  /** `null` shows every category of this kind at once (docs/feedback.md
   * Round 3 #5's "show all" link), with an added Category column and its own
   * category-tree filter instead of the single-category name/skill filters
   * alone. */
  readonly categoryKey: string | null
  readonly onBackToSearch: () => void
}

type SortDirection = 'asc' | 'desc'

interface Column<T> {
  readonly key: string
  readonly header: string
  /** The value sorted on, and (unless `render` overrides it) shown as-is. */
  readonly value: (item: T) => string | number
  readonly render?: (item: T) => string
}

const GROUPS_BY_KIND: Record<CategoryTableKind, readonly CategoryFilterGroup[]> = {
  gear: GEAR_CATEGORY_GROUPS,
  cuffs: CUFF_CATEGORY_GROUPS,
  decorations: DECORATION_CATEGORY_GROUPS,
}

/** Below this many rows, the table just renders every row directly -- the
 * windowing machinery below only pays for itself once a list is big enough
 * that rendering it all as real DOM nodes is itself the bottleneck (2026-10-24,
 * per a project owner report: the real "All Gear" view, ~62,000 rows, took
 * ~10s to open or re-filter -- confirmed via the real exported bundle that
 * this was DOM-reconciliation cost, not the plain-array filter/sort work,
 * which is sub-millisecond at that size). Comfortably above every normal
 * single-category table (the largest real decoration category is in the
 * high hundreds), so this never changes behavior for the common case. */
const VIRTUALIZE_ROW_THRESHOLD = 300

/** Matches `.category-table-scroll`'s CSS `max-height` -- kept as one named
 * constant instead of measuring the container with a `ResizeObserver`, since
 * a fixed-height scroll viewport is simplest and this page's layout never
 * resizes that element at runtime. */
const VIRTUALIZED_VIEWPORT_HEIGHT_PX = 600

/** `table-sm`'s own row height at this page's font size -- approximate (not
 * measured per-row), which only ever costs a few rows' worth of over/under
 * rendering at the very top/bottom of the scroll range, never a visible gap
 * (overscan below absorbs the error). */
const VIRTUALIZED_ROW_HEIGHT_PX = 32

/** Extra rows rendered beyond the visible viewport on each side, so a fast
 * scroll (or the row-height approximation above being slightly off) doesn't
 * flash empty space before the next render catches up. */
const OVERSCAN_ROWS = 15

function categoryLabel(kind: CategoryTableKind, categoryKey: string): string {
  for (const group of GROUPS_BY_KIND[kind]) {
    const match = group.categories.find((category) => category.key === categoryKey)
    if (match) return match.label
  }
  return categoryKey
}

const ALL_ITEMS_TITLE_BY_KIND: Record<CategoryTableKind, string> = {
  gear: 'All Gear',
  cuffs: 'All Poogie Cuffs',
  decorations: 'All Decorations',
}

function pageTitle(kind: CategoryTableKind, categoryKey: string | null): string {
  return categoryKey === null ? ALL_ITEMS_TITLE_BY_KIND[kind] : categoryLabel(kind, categoryKey)
}

const HUNTER_TYPE_LABEL: Record<HunterType, string> = {
  common: 'Both',
  blademaster: 'Blademaster',
  gunner: 'Gunner',
}

function formatSkills(
  skills: readonly SkillContribution[],
  skillNameById: ReadonlyMap<number, string>,
): string {
  if (skills.length === 0) return '—'
  return skills
    .map((s) => {
      const name = skillNameById.get(s.skillId) ?? `Skill ${s.skillId}`
      // A negative `points` already carries its own "-" -- prefixing a bare
      // "+" unconditionally produced "+-10" (2026-10-20, per the project
      // owner).
      const sign = s.points >= 0 ? '+' : ''
      return `${name} ${sign}${s.points}`
    })
    .join(', ')
}

function armorColumns(
  skillNameById: ReadonlyMap<number, string>,
): readonly Column<NamedCandidate>[] {
  return [
    { key: 'name', header: 'Name', value: (i) => i.name },
    {
      key: 'hunterType',
      header: 'Hunter Type',
      value: (i) => i.hunterType,
      render: (i) => HUNTER_TYPE_LABEL[i.hunterType],
    },
    {
      key: 'grankOrLater',
      header: 'G Rank or later',
      value: (i) => (i.grankOrLater ? 1 : 0),
      render: (i) => (i.grankOrLater ? 'Yes' : 'No'),
    },
    {
      key: 'defenseMax',
      header: 'Max Defense',
      value: (i) => i.defenseMax ?? -1,
      render: (i) => String(i.defenseMax ?? '—'),
    },
    { key: 'fire', header: 'Fire Res', value: (i) => i.resistances.fire },
    { key: 'water', header: 'Water Res', value: (i) => i.resistances.water },
    { key: 'thunder', header: 'Thunder Res', value: (i) => i.resistances.thunder },
    { key: 'ice', header: 'Ice Res', value: (i) => i.resistances.ice },
    { key: 'dragon', header: 'Dragon Res', value: (i) => i.resistances.dragon },
    { key: 'openSlotCount', header: 'Slots', value: (i) => i.openSlotCount ?? 0 },
    {
      key: 'exoticSkillId',
      header: 'Exotic Skill',
      value: (i) => (i.exoticSkillId !== null ? (skillNameById.get(i.exoticSkillId) ?? '') : ''),
      render: (i) =>
        i.exoticSkillId !== null
          ? (skillNameById.get(i.exoticSkillId) ?? `Skill ${i.exoticSkillId}`)
          : '—',
    },
    {
      key: 'skills',
      header: 'Skills',
      value: (i) => formatSkills(i.skills, skillNameById),
    },
    { key: 'id', header: 'ID', value: (i) => i.id },
  ]
}

function decorationColumns(
  skillNameById: ReadonlyMap<number, string>,
): readonly Column<NamedDecoration>[] {
  return [
    { key: 'name', header: 'Name', value: (i) => i.name },
    { key: 'slotSize', header: 'Slot Size', value: (i) => i.slotSize },
    {
      key: 'isTower',
      header: 'Tower Gem',
      value: (i) => (i.isTower ? 1 : 0),
      render: (i) => (i.isTower ? 'Yes' : 'No'),
    },
    {
      key: 'isSp',
      header: 'SP Decoration',
      value: (i) => (i.isSp ? 1 : 0),
      render: (i) => (i.isSp ? 'Yes' : 'No'),
    },
    { key: 'skills', header: 'Skills', value: (i) => formatSkills(i.skills, skillNameById) },
    { key: 'id', header: 'ID', value: (i) => i.id },
  ]
}

function cuffColumns(skillNameById: ReadonlyMap<number, string>): readonly Column<NamedCuff>[] {
  return [
    { key: 'name', header: 'Name', value: (i) => i.name },
    { key: 'slotSize', header: 'Slot Size', value: (i) => i.slotSize },
    { key: 'skills', header: 'Skills', value: (i) => formatSkills(i.skills, skillNameById) },
    { key: 'id', header: 'ID', value: (i) => i.id },
  ]
}

function itemsForKind(
  bundle: DataBundle,
  kind: CategoryTableKind,
  // `null` means every category of this kind (docs/feedback.md Round 3 #5)
  // -- the per-category `excludedCategories` filter applied afterward is
  // what actually narrows an "all items" view, not this function.
  categoryKey: string | null,
): readonly (NamedCandidate | NamedDecoration | NamedCuff)[] {
  const all =
    kind === 'gear'
      ? bundle.slots.flatMap((slot) => slot.candidates)
      : kind === 'cuffs'
        ? bundle.cuffs
        : bundle.decorations
  return categoryKey === null ? all : all.filter((item) => item.category === categoryKey)
}

/** Prepends a "Category" column naming which category an item belongs to
 * (docs/feedback.md Round 3 #5: "include a column that names the category
 * the piece is in") -- only meaningful on the "all items" view, since a
 * single-category table's column would just repeat the same value in every
 * row. */
function withCategoryColumn<T extends { readonly category: string }>(
  columns: readonly Column<T>[],
  kind: CategoryTableKind,
): readonly Column<T>[] {
  const categoryColumn: Column<T> = {
    key: 'category',
    header: 'Category',
    value: (i) => categoryLabel(kind, i.category),
  }
  return [columns[0], categoryColumn, ...columns.slice(1)]
}

function columnsForKind(
  bundle: DataBundle,
  kind: CategoryTableKind,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): readonly Column<any>[] {
  if (kind === 'gear') return armorColumns(bundle.skillNames)
  if (kind === 'cuffs') return cuffColumns(bundle.skillNames)
  return decorationColumns(bundle.skillNames)
}

export function CategoryTablePage({ kind, categoryKey, onBackToSearch }: CategoryTablePageProps) {
  const bundleQuery = useDataBundle()
  const bundle = bundleQuery.data

  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [nameFilter, setNameFilter] = useState('')
  const [skillFilter, setSkillFilter] = useState('')
  const [showBlademaster, setShowBlademaster] = useState(true)
  const [showGunner, setShowGunner] = useState(true)
  // Only consulted on the "all items" view (`categoryKey === null`) -- a
  // single-category page has nothing of its own to filter by category.
  const [excludedCategories, setExcludedCategories] = useState<ReadonlySet<string>>(new Set())
  // Windowed-rendering state -- see `VIRTUALIZE_ROW_THRESHOLD`'s own
  // docstring. Unused (and harmless) below that threshold.
  const [scrollTop, setScrollTop] = useState(0)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const columns = useMemo(() => {
    if (!bundle) return []
    const base = columnsForKind(bundle, kind)
    return categoryKey === null ? withCategoryColumn(base, kind) : base
  }, [bundle, kind, categoryKey])
  const items = useMemo(() => {
    const all = bundle ? itemsForKind(bundle, kind, categoryKey) : []
    return categoryKey === null ? all.filter((item) => !excludedCategories.has(item.category)) : all
  }, [bundle, kind, categoryKey, excludedCategories])

  // Every skill id's own name plus its tier labels, pre-joined and lowercased
  // -- same "search by skill name and skill level/threshold names" extension
  // every other skill search box in the app already makes (see App.tsx's own
  // `skillSearchTextById`), so filtering this table by skill matches a tier
  // name (e.g. "BBQ Master") too, not just the skill's own name (e.g.
  // "Cooking"). Falls back to `skillNameById` for a skill id with no tiers in
  // `bundle.skills`/`bundle.zenithSkills` (2026-10-20, per the project owner:
  // "filter by name and filter by skill" for these pages).
  const skillSearchTextById = useMemo(
    () =>
      new Map(
        [...(bundle?.skills ?? []), ...(bundle?.zenithSkills ?? [])].map((s) => [
          s.id,
          [s.name, ...s.tiers.map((t) => t.label)].join(' ').toLowerCase(),
        ]),
      ),
    [bundle],
  )

  const filteredItems = useMemo(() => {
    const nameQuery = nameFilter.trim().toLowerCase()
    const skillQuery = skillFilter.trim().toLowerCase()
    const skillNameById = bundle?.skillNames ?? new Map<number, string>()
    return items.filter((item) => {
      if (nameQuery.length > 0 && !item.name.toLowerCase().includes(nameQuery)) return false
      if (skillQuery.length > 0) {
        const matchesSkill = item.skills.some((s) => {
          const text = skillSearchTextById.get(s.skillId) ?? skillNameById.get(s.skillId) ?? ''
          return text.toLowerCase().includes(skillQuery)
        })
        if (!matchesSkill) return false
      }
      if (kind === 'gear' && 'hunterType' in item) {
        if (item.hunterType === 'blademaster' && !showBlademaster) return false
        if (item.hunterType === 'gunner' && !showGunner) return false
      }
      return true
    })
  }, [
    items,
    kind,
    nameFilter,
    skillFilter,
    skillSearchTextById,
    bundle,
    showBlademaster,
    showGunner,
  ])

  const sortedItems = useMemo(() => {
    const column = columns.find((c) => c.key === sortKey)
    if (!column) return filteredItems
    const sorted = [...filteredItems].sort((a, b) => {
      const av = column.value(a)
      const bv = column.value(b)
      if (typeof av === 'number' && typeof bv === 'number') return av - bv
      return String(av).localeCompare(String(bv))
    })
    if (sortDirection === 'desc') sorted.reverse()
    return sorted
  }, [filteredItems, columns, sortKey, sortDirection])

  // A new filter/sort/category selection can leave a previous scroll offset
  // pointing well past the end of a now-shorter list (or just somewhere
  // stale and confusing) -- snap back to the top whenever the row set itself
  // changes, not on every render (`sortedItems` only gets a new identity when
  // its content actually changes).
  useEffect(() => {
    setScrollTop(0)
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0
  }, [sortedItems])

  const isVirtualized = sortedItems.length > VIRTUALIZE_ROW_THRESHOLD
  const visibleRowCapacity =
    Math.ceil(VIRTUALIZED_VIEWPORT_HEIGHT_PX / VIRTUALIZED_ROW_HEIGHT_PX) + OVERSCAN_ROWS * 2
  const windowStart = isVirtualized
    ? Math.max(0, Math.floor(scrollTop / VIRTUALIZED_ROW_HEIGHT_PX) - OVERSCAN_ROWS)
    : 0
  const windowEnd = isVirtualized
    ? Math.min(sortedItems.length, windowStart + visibleRowCapacity)
    : sortedItems.length
  const visibleItems = isVirtualized ? sortedItems.slice(windowStart, windowEnd) : sortedItems
  const topSpacerHeight = windowStart * VIRTUALIZED_ROW_HEIGHT_PX
  const bottomSpacerHeight = (sortedItems.length - windowEnd) * VIRTUALIZED_ROW_HEIGHT_PX

  function handleSort(key: string): void {
    if (sortKey === key) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDirection('asc')
    }
  }

  return (
    <main className="app-shell">
      <h1>{pageTitle(kind, categoryKey)}</h1>
      <p className="app-intro">
        <button type="button" className="btn btn-link p-0" onClick={onBackToSearch}>
          ← Back to search
        </button>
      </p>

      {bundleQuery.isLoading && <p>Loading…</p>}
      {bundleQuery.isError && (
        <p role="alert">Couldn't load equipment data. Try reloading the page.</p>
      )}

      {bundle && (
        <>
          {categoryKey === null && (
            <div className="category-table-category-filter">
              <CategoryFilter
                groups={GROUPS_BY_KIND[kind]}
                excludedCategories={excludedCategories}
                onChange={setExcludedCategories}
                defaultCollapsed
              />
            </div>
          )}
          <div className="category-table-filters">
            <input
              type="text"
              className="form-control form-control-sm"
              aria-label="Filter by name"
              placeholder="Filter by name…"
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
            />
            <input
              type="text"
              className="form-control form-control-sm"
              aria-label="Filter by skill"
              placeholder="Filter by skill name or tier…"
              value={skillFilter}
              onChange={(e) => setSkillFilter(e.target.value)}
            />
            {kind === 'gear' && (
              <div className="category-table-hunter-type-filters">
                <div className="form-check form-check-inline">
                  <input
                    type="checkbox"
                    className="form-check-input"
                    id="category-table-show-blademaster"
                    checked={showBlademaster}
                    onChange={(e) => setShowBlademaster(e.target.checked)}
                  />
                  <label className="form-check-label" htmlFor="category-table-show-blademaster">
                    Blademaster
                  </label>
                </div>
                <div className="form-check form-check-inline">
                  <input
                    type="checkbox"
                    className="form-check-input"
                    id="category-table-show-gunner"
                    checked={showGunner}
                    onChange={(e) => setShowGunner(e.target.checked)}
                  />
                  <label className="form-check-label" htmlFor="category-table-show-gunner">
                    Gunner
                  </label>
                </div>
              </div>
            )}
          </div>
          <p className="form-text">{sortedItems.length} items.</p>
          <div
            className={`table-responsive${isVirtualized ? ' category-table-scroll' : ''}`}
            ref={scrollContainerRef}
            onScroll={isVirtualized ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}
          >
            <table className="table table-sm table-striped category-table">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={
                        sortKey === column.key
                          ? sortDirection === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : undefined
                      }
                      className="category-table-sortable-header"
                    >
                      <button
                        type="button"
                        className="btn btn-link p-0 text-decoration-none"
                        onClick={() => handleSort(column.key)}
                      >
                        {column.header}
                        {sortKey === column.key && (sortDirection === 'asc' ? ' ▲' : ' ▼')}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {topSpacerHeight > 0 && (
                  <tr aria-hidden="true" className="category-table-spacer-row">
                    <td colSpan={columns.length} style={{ height: topSpacerHeight }} />
                  </tr>
                )}
                {visibleItems.map((item) => (
                  <tr key={item.id}>
                    {columns.map((column) => (
                      <td key={column.key}>
                        {column.render ? column.render(item) : String(column.value(item))}
                      </td>
                    ))}
                  </tr>
                ))}
                {bottomSpacerHeight > 0 && (
                  <tr aria-hidden="true" className="category-table-spacer-row">
                    <td colSpan={columns.length} style={{ height: bottomSpacerHeight }} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  )
}
