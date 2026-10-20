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

import { useMemo, useState } from 'react'
import { useDataBundle } from './data/useDataBundle'
import type { CategoryTableKind } from './search-engine/category-route'
import { CUFF_CATEGORY_GROUPS } from './search-engine/cuff-categories'
import { DECORATION_CATEGORY_GROUPS } from './search-engine/decoration-categories'
import { GEAR_CATEGORY_GROUPS } from './search-engine/gear-categories'
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
  readonly categoryKey: string
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

function categoryLabel(kind: CategoryTableKind, categoryKey: string): string {
  for (const group of GROUPS_BY_KIND[kind]) {
    const match = group.categories.find((category) => category.key === categoryKey)
    if (match) return match.label
  }
  return categoryKey
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
  categoryKey: string,
): readonly (NamedCandidate | NamedDecoration | NamedCuff)[] {
  if (kind === 'gear') {
    return bundle.slots.flatMap((slot) => slot.candidates).filter((c) => c.category === categoryKey)
  }
  if (kind === 'cuffs') {
    return bundle.cuffs.filter((c) => c.category === categoryKey)
  }
  return bundle.decorations.filter((d) => d.category === categoryKey)
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

  const columns = useMemo(() => (bundle ? columnsForKind(bundle, kind) : []), [bundle, kind])
  const items = useMemo(
    () => (bundle ? itemsForKind(bundle, kind, categoryKey) : []),
    [bundle, kind, categoryKey],
  )

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
          const text = skillSearchTextById.get(s.skillId) ?? (skillNameById.get(s.skillId) ?? '')
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
  }, [items, kind, nameFilter, skillFilter, skillSearchTextById, bundle, showBlademaster, showGunner])

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
      <h1>{categoryLabel(kind, categoryKey)}</h1>
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
          <div className="table-responsive">
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
                {sortedItems.map((item) => (
                  <tr key={item.id}>
                    {columns.map((column) => (
                      <td key={column.key}>
                        {column.render ? column.render(item) : String(column.value(item))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  )
}
