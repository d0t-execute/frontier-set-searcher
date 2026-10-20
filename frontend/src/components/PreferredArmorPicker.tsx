/**
 * Lets the player name specific armor pieces the solver should favor using
 * whenever it can -- a *pool* it draws from freely, not a fixed per-slot
 * assignment the way "Pin specific armor" (`ArmorPicker.tsx`) forces
 * (docs/feedback.md Round 2 #2, confirmed by the project owner 2026-10-19:
 * "the preferred pieces should always win out over any other valid result...
 * meant to allow people to optimize with existing gear, similarly to
 * pinning pieces, but with a pool of gear that can be overruled if it's not
 * possible to reach the goal with it"). A flat set of piece ids, threaded
 * straight through to `SearchOptions.preferredCandidateIds` (see
 * `ilp-model.ts`'s own docstring for how this dominates every other ranking
 * factor, including `OPEN_SLOT_WEIGHT`, and `build-query.ts`'s
 * `QueryFormState.preferredArmorIds`). Still never a hard requirement the
 * way a pin is: a build using none of these pieces is still returned (and
 * correctly ranked) once using any of them would make a requirement
 * unreachable -- the pool is overruled, not enforced.
 *
 * Same flat "search to add, badge list to remove" interaction as
 * `EquipmentExclusionPicker.tsx`'s own Armor list (reusing `FilterableOptions`,
 * including its skill-name/tier-label search extension, docs/feedback.md
 * Round 2 #8) -- only the semantics (favor using, not rule out entirely)
 * differ, so this is its own small component rather than a third mode
 * bolted onto that one.
 */

import { useCallback, useMemo, useState } from 'react'
import { contributionSummary } from '../search-engine/contribution-summary'
import type { SkillContribution, SkillId } from '../search-engine/types'
import { FilterableOptions, MIN_SEARCH_LENGTH } from './FilterableOptions'
import { HoveredSkillSummary } from './HoveredSkillSummary'
import { handleEnterToPickFirst } from './pick-first-match'

interface NamedArmorPiece {
  readonly id: string
  readonly name: string
  readonly skills: readonly SkillContribution[]
}

export interface PreferredArmorPickerProps {
  readonly armorCandidates: readonly NamedArmorPiece[]
  readonly preferredIds: ReadonlySet<string>
  readonly onChange: (next: Set<string>) => void
  readonly skillNameById: ReadonlyMap<SkillId, string>
  /** Every skill id's own name plus its tier labels, pre-joined and
   * lowercased -- same tier/threshold search extension
   * `EquipmentExclusionPicker.tsx` has (docs/feedback.md Round 2 #8). */
  readonly skillSearchTextById: ReadonlyMap<SkillId, string>
}

export function PreferredArmorPicker({
  armorCandidates,
  preferredIds,
  onChange,
  skillNameById,
  skillSearchTextById,
}: PreferredArmorPickerProps) {
  const [search, setSearch] = useState('')
  const [hovered, setHovered] = useState<NamedArmorPiece | null>(null)
  const itemsById = useMemo(() => new Map(armorCandidates.map((c) => [c.id, c])), [armorCandidates])

  const matchesNameOrSkill = useCallback(
    (item: NamedArmorPiece, query: string) => {
      if (item.name.toLowerCase().includes(query)) return true
      return item.skills.some((c) => (skillSearchTextById.get(c.skillId) ?? '').includes(query))
    },
    [skillSearchTextById],
  )

  const pickableMatches = useCallback(
    (item: NamedArmorPiece, query: string) =>
      !preferredIds.has(item.id) && matchesNameOrSkill(item, query),
    [preferredIds, matchesNameOrSkill],
  )
  const pickableItems = useMemo(
    () => armorCandidates.filter((c) => !preferredIds.has(c.id)),
    [armorCandidates, preferredIds],
  )

  function add(id: string): void {
    const next = new Set(preferredIds)
    next.add(id)
    onChange(next)
  }

  function remove(id: string): void {
    const next = new Set(preferredIds)
    next.delete(id)
    onChange(next)
  }

  return (
    <div>
      {preferredIds.size > 0 && (
        <div className="mb-1">
          {[...preferredIds].map((id) => {
            const item = itemsById.get(id)
            const name = item?.name ?? id
            return (
              <span
                key={id}
                className="badge text-bg-secondary me-1"
                title={item && contributionSummary(item.skills, skillNameById)}
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
        aria-label="Search armor pieces to prefer"
        placeholder="Type to search…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) =>
          handleEnterToPickFirst(
            e,
            pickableItems,
            search,
            (item) => add(item.id),
            matchesNameOrSkill,
          )
        }
      />
      <FilterableOptions
        items={armorCandidates}
        search={search}
        ariaLabel="Armor pieces matching search to prefer"
        matches={pickableMatches}
        describe={(item) => contributionSummary(item.skills, skillNameById)}
        onPick={(item) => add(item.id)}
        onHoverChange={setHovered}
      />
      {search.trim().length >= MIN_SEARCH_LENGTH && (
        <HoveredSkillSummary
          hovered={hovered}
          skillNameById={skillNameById}
          skillSearchTextById={skillSearchTextById}
          query={search}
        />
      )}
    </div>
  )
}
