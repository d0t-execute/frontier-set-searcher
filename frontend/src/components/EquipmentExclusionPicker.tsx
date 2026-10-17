/**
 * Lets the player permanently rule out specific armor pieces, decorations, or
 * cuffs by id -- a stronger, per-item version of the existing category
 * filters (Gear levels/Poogie cuffs/Decorations), for something the player
 * simply doesn't own or doesn't want suggested regardless of category (docs/
 * skill-system-roadmap.md's equipment-exclusion feature, 2026-10-16, per the
 * project owner). An excluded item never appears in a search result -- except
 * that pinning always wins over exclusion, the same way a pin already
 * overrides every other filter on this page (`build-query.ts`'s
 * `buildSearchQuery`): a pinned piece or decoration stays usable even after
 * being added here, so excluding e.g. "Ice Atk G" doesn't strip it back out
 * of a slot the player explicitly pinned it into.
 *
 * Reuses `FilterableOptions`' type-to-filter search (same convention as
 * `ArmorPicker`/`CuffPicker`, needed for the same reason -- these catalogs run
 * into the tens of thousands) for all three lists, since armor candidates,
 * decorations, and cuffs all already share the `{id, name}` shape it needs.
 */

import { useMemo, useState } from 'react'
import { contributionSummary } from '../search-engine/contribution-summary'
import type { SkillContribution, SkillId } from '../search-engine/types'
import { FilterableOptions } from './FilterableOptions'
import { handleEnterToPickFirst } from './pick-first-match'

interface Named {
  readonly id: string
  readonly name: string
  /** Absent for a catalog with nothing to show here (none exist today) --
   * when present, shown as a hover tooltip (2026-10-17, per user feedback). */
  readonly skills?: readonly SkillContribution[]
}

export interface EquipmentExclusionPickerProps {
  readonly armorCandidates: readonly Named[]
  readonly decorations: readonly Named[]
  readonly cuffs: readonly Named[]
  readonly excludedArmorIds: ReadonlySet<string>
  readonly onChangeExcludedArmorIds: (next: Set<string>) => void
  readonly excludedDecorationIds: ReadonlySet<string>
  readonly onChangeExcludedDecorationIds: (next: Set<string>) => void
  readonly excludedCuffIds: ReadonlySet<string>
  readonly onChangeExcludedCuffIds: (next: Set<string>) => void
  readonly skillNameById: ReadonlyMap<SkillId, string>
}

export function EquipmentExclusionPicker({
  armorCandidates,
  decorations,
  cuffs,
  excludedArmorIds,
  onChangeExcludedArmorIds,
  excludedDecorationIds,
  onChangeExcludedDecorationIds,
  excludedCuffIds,
  onChangeExcludedCuffIds,
  skillNameById,
}: EquipmentExclusionPickerProps) {
  return (
    <div className="d-flex flex-column gap-3">
      <ExclusionList
        label="Armor"
        searchAriaLabel="Search armor pieces to exclude"
        items={armorCandidates}
        excludedIds={excludedArmorIds}
        onChange={onChangeExcludedArmorIds}
        skillNameById={skillNameById}
      />
      <ExclusionList
        label="Decorations"
        searchAriaLabel="Search decorations to exclude"
        items={decorations}
        excludedIds={excludedDecorationIds}
        onChange={onChangeExcludedDecorationIds}
        skillNameById={skillNameById}
      />
      <ExclusionList
        label="Cuffs"
        searchAriaLabel="Search cuffs to exclude"
        items={cuffs}
        excludedIds={excludedCuffIds}
        onChange={onChangeExcludedCuffIds}
        skillNameById={skillNameById}
      />
    </div>
  )
}

function ExclusionList<T extends Named>({
  label,
  searchAriaLabel,
  items,
  excludedIds,
  onChange,
  skillNameById,
}: {
  label: string
  searchAriaLabel: string
  items: readonly T[]
  excludedIds: ReadonlySet<string>
  onChange: (next: Set<string>) => void
  skillNameById: ReadonlyMap<SkillId, string>
}) {
  const [search, setSearch] = useState('')
  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  // Already-excluded items are left out of the search results -- nothing
  // useful comes from letting the player "exclude" the same id twice.
  const pickableItems = useMemo(
    () => items.filter((i) => !excludedIds.has(i.id)),
    [items, excludedIds],
  )

  function add(id: string): void {
    const next = new Set(excludedIds)
    next.add(id)
    onChange(next)
    setSearch('')
  }

  function remove(id: string): void {
    const next = new Set(excludedIds)
    next.delete(id)
    onChange(next)
  }

  return (
    <div>
      <div className="fw-bold mb-1">{label}</div>
      {excludedIds.size > 0 && (
        <div className="mb-1">
          {[...excludedIds].map((id) => {
            const item = itemsById.get(id)
            const name = item?.name ?? id
            return (
              <span
                key={id}
                className="badge text-bg-secondary me-1"
                title={item?.skills && contributionSummary(item.skills, skillNameById)}
              >
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
        aria-label={searchAriaLabel}
        placeholder="Type to search…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => handleEnterToPickFirst(e, pickableItems, search, (item) => add(item.id))}
      />
      <FilterableOptions
        items={pickableItems}
        search={search}
        ariaLabel={`${label} matching search`}
        describe={(item) => item.skills && contributionSummary(item.skills, skillNameById)}
        onPick={(item) => add(item.id)}
      />
    </div>
  )
}
