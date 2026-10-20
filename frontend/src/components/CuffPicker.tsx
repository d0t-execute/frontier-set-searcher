/**
 * Lets the user force a cuff slot to a specific Poogie cuff, instead of
 * leaving it to the solver -- the cuff half of docs/skill-system-roadmap.md
 * TODO #7 (deferred when ArmorPicker was built, since cuffs have no
 * per-armor-slot cardinality to narrow the way a real slot does -- see
 * `SearchOptions.pinnedCuffs`'s own docstring for how pinning is modeled
 * instead). Also the prerequisite TODO #9 needs: a shared build result can
 * only fully "pin every part of itself" into the main search once a specific
 * cuff is pinnable at all.
 *
 * Each slot also has a second pin mode (TODO #25, 2026-10-18 per the project
 * owner): pin to a *skill* (normal or Zenith) instead of a specific cuff id,
 * since real cuffs are "partially random" -- the same display name can carry
 * different exact point values across copies, so naming one exact cuff is
 * often more rigid than wanted. A skill-mode pin doesn't say *which* cuff
 * variant to use at all; it just requires the solver equip some cuff granting
 * that skill, letting it pick whichever variant serves the rest of the build
 * best (`SearchOptions.pinnedCuffSkillIds`, via `build-query.ts`'s
 * `PinnedCuffSlot`/`resolvePinnedCuffs`). The two modes are independent
 * per-slot choices, not a global toggle -- slot 1 can be an exact pin while
 * slot 2 is a skill pin.
 *
 * Two independent pickers, not one flat list -- `MAX_EQUIPPED_CUFFS` is
 * always exactly 2 real slots, and the same cuff (or skill) is allowed to
 * fill both at once (confirmed by the project owner, see `ilp-model.ts`), so
 * "slot 1" and "slot 2" can legitimately hold the same pin.
 */

import { useState } from 'react'
import { contributionSummary } from '../search-engine/contribution-summary'
import { MAX_EQUIPPED_CUFFS } from '../search-engine/ilp-model'
import type { NamedCuff } from '../search-engine/load-bundle'
import type { PinnedCuffSlot } from '../search-engine/build-query'
import type { SkillId } from '../search-engine/types'
import { FilterableOptions, MIN_SEARCH_LENGTH } from './FilterableOptions'
import { HoveredSkillSummary } from './HoveredSkillSummary'
import { handleEnterToPickFirst } from './pick-first-match'

interface SkillOption {
  readonly id: string
  readonly name: string
}

export interface CuffPickerProps {
  readonly cuffs: readonly NamedCuff[]
  /** Up to `MAX_EQUIPPED_CUFFS` pins, one per cuff slot -- index 0 is
   * "slot 1", index 1 is "slot 2". A slot with nothing pinned is simply
   * absent (not a `null` placeholder), so this is never longer than however
   * many slots are actually pinned. */
  readonly pinned: readonly PinnedCuffSlot[]
  readonly onChange: (next: readonly PinnedCuffSlot[]) => void
  /** Resolves a cuff's own skill contributions to names, for the hover
   * tooltip on each search result and already-pinned cuff (2026-10-17, per
   * user feedback). */
  readonly skillNameById: ReadonlyMap<SkillId, string>
  /** Every skill (normal and Zenith) choosable for a skill-mode pin --
   * `{id, name}` shape for `FilterableOptions`, ids stringified same
   * convention as `EquipmentExclusionPicker.tsx`'s own skills list. */
  readonly pinnableSkills: readonly SkillOption[]
  /** Every skill id's own name plus its tier labels, pre-joined and
   * lowercased -- lets the "Exact cuff" search below match on a skill/tier
   * name too, not just a cuff's own name, the same skill-name/tier-label
   * extension `ArmorPicker.tsx`/`EquipmentExclusionPicker.tsx` already have
   * (docs/feedback.md Round 2 #8) -- missing here until now (2026-10-20, per
   * the project owner). Optional, same convention as
   * `EquipmentExclusionPicker.tsx`'s own prop of the same name -- falls back
   * to matching on `skillNameById` alone (name only, no tier labels) when
   * omitted, rather than every call site needing to supply it. The "By
   * skill" mode's own search is unaffected either way: it already searches a
   * flat list of skill names directly. */
  readonly skillSearchTextById?: ReadonlyMap<SkillId, string>
}

export function CuffPicker({
  cuffs,
  pinned,
  onChange,
  skillNameById,
  pinnableSkills,
  skillSearchTextById,
}: CuffPickerProps) {
  function setSlot(index: number, slot: PinnedCuffSlot | null): void {
    const next = [...pinned]
    if (slot) next[index] = slot
    else next.splice(index, 1)
    onChange(next)
  }

  return (
    <div className="d-flex flex-column gap-3">
      {Array.from({ length: MAX_EQUIPPED_CUFFS }, (_, i) => (
        <CuffSlotPicker
          key={i}
          label={`Cuff slot ${i + 1}`}
          cuffs={cuffs}
          pin={pinned[i] ?? null}
          onChange={(slot) => setSlot(i, slot)}
          skillNameById={skillNameById}
          pinnableSkills={pinnableSkills}
          skillSearchTextById={skillSearchTextById}
        />
      ))}
    </div>
  )
}

function CuffSlotPicker({
  label,
  cuffs,
  pin,
  onChange,
  skillNameById,
  pinnableSkills,
  skillSearchTextById,
}: {
  label: string
  cuffs: readonly NamedCuff[]
  pin: PinnedCuffSlot | null
  onChange: (pin: PinnedCuffSlot | null) => void
  skillNameById: ReadonlyMap<SkillId, string>
  pinnableSkills: readonly SkillOption[]
  skillSearchTextById?: ReadonlyMap<SkillId, string>
}) {
  // Which mode the *in-progress* search shows -- only meaningful while
  // nothing is pinned yet, since an existing pin's own mode already comes
  // from `pin.mode`.
  const [mode, setMode] = useState<'exact' | 'skill'>('exact')
  const [search, setSearch] = useState('')
  const [hoveredCuff, setHoveredCuff] = useState<NamedCuff | null>(null)

  function cuffMatches(cuff: NamedCuff, query: string): boolean {
    if (cuff.name.toLowerCase().includes(query)) return true
    return cuff.skills.some((s) =>
      skillSearchTextById
        ? (skillSearchTextById.get(s.skillId) ?? '').includes(query)
        : (skillNameById.get(s.skillId) ?? '').toLowerCase().includes(query),
    )
  }

  const cuff = pin?.mode === 'exact' ? cuffs.find((c) => c.id === pin.cuffId) : undefined
  const pinnedSkillName =
    pin?.mode === 'skill' ? (skillNameById.get(pin.skillId) ?? `Skill ${pin.skillId}`) : undefined

  function pickCuff(c: NamedCuff): void {
    onChange({ mode: 'exact', cuffId: c.id })
    setSearch('')
  }

  function pickSkill(option: SkillOption): void {
    onChange({ mode: 'skill', skillId: Number(option.id) })
    setSearch('')
  }

  function switchMode(next: 'exact' | 'skill'): void {
    setMode(next)
    setSearch('')
  }

  const showingPin = pin !== null

  return (
    <div>
      <div className="fw-bold mb-1">{label}</div>

      {showingPin ? (
        <div className="d-flex align-items-center gap-2">
          {pin?.mode === 'exact' ? (
            <span title={cuff ? contributionSummary(cuff.skills, skillNameById) : undefined}>
              {cuff?.name ?? pin.cuffId}
            </span>
          ) : (
            <span>Any cuff granting {pinnedSkillName}</span>
          )}
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={() => onChange(null)}
          >
            Clear
          </button>
        </div>
      ) : (
        <div className="d-flex flex-column gap-1">
          <div className="btn-group btn-group-sm" role="group" aria-label={`Pin mode for ${label}`}>
            <button
              type="button"
              aria-pressed={mode === 'exact'}
              className={
                mode === 'exact' ? 'btn btn-outline-secondary active' : 'btn btn-outline-secondary'
              }
              onClick={() => switchMode('exact')}
            >
              Exact cuff
            </button>
            <button
              type="button"
              aria-pressed={mode === 'skill'}
              className={
                mode === 'skill' ? 'btn btn-outline-secondary active' : 'btn btn-outline-secondary'
              }
              onClick={() => switchMode('skill')}
            >
              By skill
            </button>
          </div>
          {mode === 'exact' ? (
            <>
              <input
                type="text"
                className="form-control"
                aria-label={`Search cuffs for ${label}`}
                placeholder="Type to search cuffs…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => handleEnterToPickFirst(e, cuffs, search, pickCuff, cuffMatches)}
              />
              <FilterableOptions
                items={cuffs}
                search={search}
                ariaLabel={`Cuffs matching search for ${label}`}
                matches={cuffMatches}
                describe={(c) => contributionSummary(c.skills, skillNameById)}
                onPick={pickCuff}
                onHoverChange={setHoveredCuff}
              />
              {search.trim().length >= MIN_SEARCH_LENGTH && (
                <HoveredSkillSummary
                  hovered={hoveredCuff}
                  skillNameById={skillNameById}
                  skillSearchTextById={skillSearchTextById}
                  query={search}
                />
              )}
            </>
          ) : (
            <>
              <input
                type="text"
                className="form-control"
                aria-label={`Search skills to pin for ${label}`}
                placeholder="Type to search skills…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => handleEnterToPickFirst(e, pinnableSkills, search, pickSkill)}
              />
              <FilterableOptions
                items={pinnableSkills}
                search={search}
                ariaLabel={`Skills matching search for ${label}`}
                onPick={pickSkill}
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}
