/**
 * Lets the user force-equip a specific Poogie cuff into one or both of the
 * game's 2 cuff slots, instead of leaving them to the solver -- the cuff
 * half of docs/skill-system-roadmap.md TODO #7 (deferred when ArmorPicker
 * was built, since cuffs have no per-armor-slot cardinality to narrow the
 * way a real slot does -- see `SearchOptions.pinnedCuffs`'s own docstring for
 * how pinning is modeled instead). Also the prerequisite TODO #9 needs: a
 * shared build result can only fully "pin every part of itself" into the
 * main search once a specific cuff is pinnable at all.
 *
 * Two independent pickers, not one flat list -- `MAX_EQUIPPED_CUFFS` is
 * always exactly 2 real slots, and the same cuff is allowed to fill both at
 * once (confirmed by the project owner, see `ilp-model.ts`), so "slot 1" and
 * "slot 2" can legitimately hold the same id.
 */

import { useState } from 'react'
import { contributionSummary } from '../search-engine/contribution-summary'
import { MAX_EQUIPPED_CUFFS } from '../search-engine/ilp-model'
import type { NamedCuff } from '../search-engine/load-bundle'
import type { SkillId } from '../search-engine/types'
import { FilterableOptions } from './FilterableOptions'
import { handleEnterToPickFirst } from './pick-first-match'

export interface CuffPickerProps {
  readonly cuffs: readonly NamedCuff[]
  /** Up to `MAX_EQUIPPED_CUFFS` cuff ids, one per cuff slot -- index 0 is
   * "slot 1", index 1 is "slot 2". A slot with nothing pinned is simply
   * absent (not an empty-string placeholder), so this is never longer than
   * however many slots are actually pinned. */
  readonly pinned: readonly string[]
  readonly onChange: (next: readonly string[]) => void
  /** Resolves a cuff's own skill contributions to names, for the hover
   * tooltip on each search result and already-pinned cuff (2026-10-17, per
   * user feedback). */
  readonly skillNameById: ReadonlyMap<SkillId, string>
}

export function CuffPicker({ cuffs, pinned, onChange, skillNameById }: CuffPickerProps) {
  function setSlot(index: number, cuffId: string | null): void {
    const next = [...pinned]
    if (cuffId) next[index] = cuffId
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
          cuffId={pinned[i] ?? null}
          onChange={(cuffId) => setSlot(i, cuffId)}
          skillNameById={skillNameById}
        />
      ))}
    </div>
  )
}

function CuffSlotPicker({
  label,
  cuffs,
  cuffId,
  onChange,
  skillNameById,
}: {
  label: string
  cuffs: readonly NamedCuff[]
  cuffId: string | null
  onChange: (cuffId: string | null) => void
  skillNameById: ReadonlyMap<SkillId, string>
}) {
  const [picking, setPicking] = useState(false)
  const [search, setSearch] = useState('')
  const cuff = cuffId ? cuffs.find((c) => c.id === cuffId) : undefined

  function pickCuff(c: NamedCuff): void {
    onChange(c.id)
    setSearch('')
    setPicking(false)
  }

  return (
    <div>
      <div className="fw-bold mb-1">{label}</div>

      {cuff && !picking ? (
        <div className="d-flex align-items-center gap-2">
          <span title={contributionSummary(cuff.skills, skillNameById)}>{cuff.name}</span>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={() => setPicking(true)}
          >
            Change
          </button>
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
          <input
            type="text"
            className="form-control"
            aria-label={`Search cuffs for ${label}`}
            placeholder="Type to search cuffs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => handleEnterToPickFirst(e, cuffs, search, pickCuff)}
          />
          <FilterableOptions
            items={cuffs}
            search={search}
            ariaLabel={`Cuffs matching search for ${label}`}
            describe={(c) => contributionSummary(c.skills, skillNameById)}
            onPick={pickCuff}
          />
          {cuff && (
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary align-self-start"
              onClick={() => {
                setPicking(false)
                setSearch('')
              }}
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  )
}
