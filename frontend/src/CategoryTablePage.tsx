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
    .map((s) => `${skillNameById.get(s.skillId) ?? `Skill ${s.skillId}`} +${s.points}`)
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

  const columns = useMemo(() => (bundle ? columnsForKind(bundle, kind) : []), [bundle, kind])
  const items = useMemo(
    () => (bundle ? itemsForKind(bundle, kind, categoryKey) : []),
    [bundle, kind, categoryKey],
  )

  const sortedItems = useMemo(() => {
    const column = columns.find((c) => c.key === sortKey)
    if (!column) return items
    const sorted = [...items].sort((a, b) => {
      const av = column.value(a)
      const bv = column.value(b)
      if (typeof av === 'number' && typeof bv === 'number') return av - bv
      return String(av).localeCompare(String(bv))
    })
    if (sortDirection === 'desc') sorted.reverse()
    return sorted
  }, [items, columns, sortKey, sortDirection])

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
