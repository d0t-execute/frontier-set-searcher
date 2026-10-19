/**
 * Lets the player permanently rule out specific armor pieces, decorations,
 * cuffs, or skills -- a stronger, per-item version of the existing category
 * filters (Gear levels/Poogie cuffs/Decorations), for something the player
 * simply doesn't own or doesn't want suggested regardless of category (docs/
 * skill-system-roadmap.md's equipment-exclusion feature, 2026-10-16, per the
 * project owner). An excluded armor piece, decoration, or cuff never appears
 * in a search result -- except that pinning always wins over exclusion, the
 * same way a pin already overrides every other filter on this page
 * (`build-query.ts`'s `buildSearchQuery`): a pinned piece or decoration stays
 * usable even after being added here, so excluding e.g. "Ice Atk G" doesn't
 * strip it back out of a slot the player explicitly pinned it into.
 *
 * Excluding a *skill* works differently (TODO #37, replacing this feature's
 * original TODO #32 behavior, 2026-10-17 per the project owner): rather than
 * dropping every piece/decoration/cuff that happens to grant it, the solver
 * is simply never allowed to let that skill become "active" in the final
 * result (`build-query.ts`'s `excludedSkillIds`, threaded through as
 * `SearchOptions.excludedActiveSkillIds`) -- equipment granting it stays
 * fully eligible, so e.g. a decoration also granting a wanted skill is never
 * needlessly ruled out just because its other skill was excluded.
 *
 * Reuses `FilterableOptions`' type-to-filter search (same convention as
 * `ArmorPicker`/`CuffPicker`, needed for the same reason -- these catalogs run
 * into the tens of thousands) for all four lists, since armor candidates,
 * decorations, cuffs, and skills all already share (or can be mapped onto)
 * the `{id, name}` shape it needs.
 *
 * Each of the armor/decoration/cuff lists also matches on a granted skill's
 * name, not just the item's own name -- the same "search armor pieces by
 * skill" behavior `ArmorPicker.tsx`'s `candidateMatches` already has (TODO
 * #26's #19), extended here too (2026-10-18, per the project owner). Every
 * list (including Skills) also matches a skill's tier/threshold labels, not
 * just its own name (docs/feedback.md Round 2 #8, 2026-10-19) -- e.g. typing
 * "BBQ Master" surfaces "Cooking" everywhere, including in the Skills list
 * itself, where there's no separate "granted skill" to look up.
 *
 * Also shows the same persistent hover-skill-summary line `ArmorPicker.tsx`
 * has below its own piece search (2026-10-19, per the project owner), on the
 * armor/decoration/cuff lists only -- the Skills list's items have nothing to
 * show there, since they already *are* the skill.
 */

import { useCallback, useMemo, useState } from 'react'
import { contributionSummary } from '../search-engine/contribution-summary'
import type { SkillContribution, SkillId } from '../search-engine/types'
import { FilterableOptions, MIN_SEARCH_LENGTH } from './FilterableOptions'
import { HoveredSkillSummary } from './HoveredSkillSummary'
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
  /** `{id, name}` pairs for every normal (non-Zenith) skill -- Zenith skills
   * are only ever granted by the weapon slot, which isn't part of the
   * armor/decoration/cuff pools this exclusion list filters, so they're left
   * out here rather than offered as a dead-end exclusion. */
  readonly skills: readonly Named[]
  readonly excludedArmorIds: ReadonlySet<string>
  readonly onChangeExcludedArmorIds: (next: Set<string>) => void
  readonly excludedDecorationIds: ReadonlySet<string>
  readonly onChangeExcludedDecorationIds: (next: Set<string>) => void
  readonly excludedCuffIds: ReadonlySet<string>
  readonly onChangeExcludedCuffIds: (next: Set<string>) => void
  readonly excludedSkillIds: ReadonlySet<string>
  readonly onChangeExcludedSkillIds: (next: Set<string>) => void
  readonly skillNameById: ReadonlyMap<SkillId, string>
  /** Every skill id's own name plus its tier labels, pre-joined and
   * lowercased -- lets the armor/decoration/cuff lists below match a
   * tier/threshold name too, not just a skill's own name (docs/feedback.md
   * Round 2 #8, 2026-10-19). */
  readonly skillSearchTextById: ReadonlyMap<SkillId, string>
}

export function EquipmentExclusionPicker({
  armorCandidates,
  decorations,
  cuffs,
  skills,
  excludedArmorIds,
  onChangeExcludedArmorIds,
  excludedDecorationIds,
  onChangeExcludedDecorationIds,
  excludedCuffIds,
  onChangeExcludedCuffIds,
  excludedSkillIds,
  onChangeExcludedSkillIds,
  skillNameById,
  skillSearchTextById,
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
        skillSearchTextById={skillSearchTextById}
        showSkillSummary
      />
      <ExclusionList
        label="Decorations"
        searchAriaLabel="Search decorations to exclude"
        items={decorations}
        excludedIds={excludedDecorationIds}
        onChange={onChangeExcludedDecorationIds}
        skillNameById={skillNameById}
        skillSearchTextById={skillSearchTextById}
        showSkillSummary
      />
      <ExclusionList
        label="Cuffs"
        searchAriaLabel="Search cuffs to exclude"
        items={cuffs}
        excludedIds={excludedCuffIds}
        onChange={onChangeExcludedCuffIds}
        skillNameById={skillNameById}
        skillSearchTextById={skillSearchTextById}
        showSkillSummary
      />
      <ExclusionList
        label="Skills"
        searchAriaLabel="Search skills to exclude"
        items={skills}
        excludedIds={excludedSkillIds}
        onChange={onChangeExcludedSkillIds}
        skillNameById={skillNameById}
        skillSearchTextById={skillSearchTextById}
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
  skillSearchTextById,
  showSkillSummary = false,
}: {
  label: string
  searchAriaLabel: string
  items: readonly T[]
  excludedIds: ReadonlySet<string>
  onChange: (next: Set<string>) => void
  skillNameById: ReadonlyMap<SkillId, string>
  /** Every skill id's own name plus its tier labels, pre-joined and
   * lowercased -- optional since the Skills list (whose items already *are*
   * skills, matched on `item.name` directly) has no use for it. */
  skillSearchTextById?: ReadonlyMap<SkillId, string>
  /** Renders the persistent hover-skill-summary line below the results --
   * left off for the Skills list, whose items have nothing to show there. */
  showSkillSummary?: boolean
}) {
  const [search, setSearch] = useState('')
  const [hovered, setHovered] = useState<T | null>(null)
  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  // Matches an item by its own name, by a skill it grants, or by one of that
  // skill's tier/threshold labels (docs/feedback.md Round 2 #8, 2026-10-19)
  // -- lets "exclude every piece granting Ice Atk G" work without knowing a
  // single piece's name up front, the same reason `ArmorPicker.tsx`'s own
  // piece search matches by skill name (and now tier label) too.
  const matchesNameOrSkill = useCallback(
    (item: T, query: string) => {
      if (item.name.toLowerCase().includes(query)) return true
      if (item.skills) {
        return item.skills.some((c) =>
          skillSearchTextById
            ? (skillSearchTextById.get(c.skillId) ?? '').includes(query)
            : (skillNameById.get(c.skillId) ?? '').toLowerCase().includes(query),
        )
      }
      // This item has no "skills it grants" list of its own -- it IS a
      // skill (the Skills list itself) -- match its own tier labels too, so
      // e.g. typing "BBQ Master" still surfaces "Cooking" here.
      return (skillSearchTextById?.get(Number(item.id)) ?? '').includes(query)
    },
    [skillNameById, skillSearchTextById],
  )

  // Already-excluded items are left out of the search results -- nothing
  // useful comes from letting the player "exclude" the same id twice. Folded
  // into the search's own match rule (a single pass over `items`) rather than
  // pre-filtering a separate `pickableItems` array first (a second full pass)
  // -- halves the work redone on every pick, most noticeable on the ~62,000-
  // row armor catalog (2026-10-18, after the project owner reported a visible
  // delay between picking an item and it disappearing from the list).
  const pickableMatches = useCallback(
    (item: T, query: string) => !excludedIds.has(item.id) && matchesNameOrSkill(item, query),
    [excludedIds, matchesNameOrSkill],
  )
  // `handleEnterToPickFirst` below still needs an actual array of pickable
  // items (not just a match predicate) to find its own top match against.
  const pickableItems = useMemo(
    () => items.filter((i) => !excludedIds.has(i.id)),
    [items, excludedIds],
  )

  function add(id: string): void {
    const next = new Set(excludedIds)
    next.add(id)
    onChange(next)
    // Deliberately doesn't clear `search` -- picking an item used to close
    // the results and empty the field, forcing a retype for every single
    // piece when excluding several at once (2026-10-18, per the project
    // owner). The picked item drops out of `pickableItems` on its own once
    // excluded, so the remaining matches stay visible for the next pick.
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
        items={items}
        search={search}
        ariaLabel={`${label} matching search`}
        matches={pickableMatches}
        describe={(item) => item.skills && contributionSummary(item.skills, skillNameById)}
        onPick={(item) => add(item.id)}
        onHoverChange={showSkillSummary ? setHovered : undefined}
      />
      {showSkillSummary && search.trim().length >= MIN_SEARCH_LENGTH && (
        <HoveredSkillSummary
          hovered={hovered && { skills: hovered.skills ?? [] }}
          skillNameById={skillNameById}
          query={search}
        />
      )}
    </div>
  )
}
