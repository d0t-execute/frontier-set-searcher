/**
 * Lets the user force-select a specific piece (and specific decorations into
 * its open slots) for one or more of the 5 real armor slots, overriding the
 * solver's own choice for that slot entirely -- see
 * docs/skill-system-roadmap.md TODO #7 "Exclude or force-include specific
 * armor pieces / cuffs", refined scope. Motivating use cases (from the
 * project owner): optimizing the rest of a build around gear the player
 * already owns, and exactly pinning part of a build while exploring
 * different ways to fill in the rest. Unpinned slots are untouched -- this
 * is additive to the existing free search, not a replacement mode.
 *
 * Also lets the user force a decoration into a slot *without* pinning which
 * piece fills it (docs/skill-system-roadmap.md TODO #12) -- only shown when
 * the slot has no full piece pin, since a piece pin already bakes its own
 * decorations in. Bounded by the largest open-slot count any candidate for
 * that slot could offer (not a specific candidate's, since none is chosen
 * yet) -- a looser bound than the real eventual capacity, so the solver
 * itself (via `ilp-model.ts`'s `capacityRow`) is what ultimately rejects a
 * pin that can't fit whichever candidate it ends up choosing, not this UI.
 *
 * The weapon slot and cuffs are deliberately out of scope here: the weapon
 * has no real per-piece identity to pin (only a Zenith skill, already
 * force-selectable today via its own exclude checklist in App.tsx), and
 * cuffs need their own design per the roadmap's own note (a flat 0-2 list,
 * not per-slot, "likely closer to the weapon-slot picker... than the
 * per-armor-slot one") -- left as an open point rather than guessed at here.
 *
 * A real slot's candidate list runs into the tens of thousands of pieces
 * (head alone: ~13,000) -- far too many for a plain `<select>` to be usable,
 * unlike `SkillPicker`'s ~194-entry catalog. Candidate and decoration pickers
 * here are both type-to-filter: nothing renders until the user types a
 * minimum number of characters, and matches are capped, so the DOM never
 * carries more than a small page of options at once.
 */

import { useState } from 'react'
import { isSkillActive } from '../search-engine/active-skill-cap'
import type { NamedCandidate, NamedDecoration, NamedSkill } from '../search-engine/load-bundle'
import type { PinnedSlot } from '../search-engine/pinned-armor'
import { computePinnedSkillTotals } from '../search-engine/pinned-armor'
import { FilterableOptions } from './FilterableOptions'

export type { PinnedSlot } from '../search-engine/pinned-armor'

export interface ArmorPickerProps {
  readonly slots: readonly { readonly slotId: string; readonly candidates: readonly NamedCandidate[] }[]
  readonly decorations: readonly NamedDecoration[]
  readonly pinned: ReadonlyMap<string, PinnedSlot>
  readonly onChange: (next: ReadonlyMap<string, PinnedSlot>) => void
  /** Decoration ids forced into a slot without a piece pin (TODO #12, see
   * this module's own docstring) -- keyed by `slotId`, duplicates allowed. */
  readonly pinnedSlotDecorationIds: ReadonlyMap<string, readonly string[]>
  readonly onChangeSlotDecorations: (next: ReadonlyMap<string, readonly string[]>) => void
  readonly skills: readonly NamedSkill[]
}

export function ArmorPicker({
  slots,
  decorations,
  pinned,
  onChange,
  pinnedSlotDecorationIds,
  onChangeSlotDecorations,
  skills,
}: ArmorPickerProps) {
  const skillsById = new Map(skills.map((s) => [s.id, s]))
  const skillTotals = computePinnedSkillTotals(pinned, slots, decorations, pinnedSlotDecorationIds)

  function setPin(slotId: string, pin: PinnedSlot | null): void {
    const next = new Map(pinned)
    if (pin) next.set(slotId, pin)
    else next.delete(slotId)
    onChange(next)
    // A piece pin already bakes its own decorations in -- clear any
    // decoration-only pin for the same slot so the two can never coexist.
    if (pin && pinnedSlotDecorationIds.has(slotId)) {
      const nextSlotDecorations = new Map(pinnedSlotDecorationIds)
      nextSlotDecorations.delete(slotId)
      onChangeSlotDecorations(nextSlotDecorations)
    }
  }

  function setSlotDecorations(slotId: string, ids: readonly string[]): void {
    const next = new Map(pinnedSlotDecorationIds)
    if (ids.length > 0) next.set(slotId, ids)
    else next.delete(slotId)
    onChangeSlotDecorations(next)
  }

  return (
    <div className="d-flex flex-column gap-3">
      {slots.map((slot) => (
        <ArmorSlotPicker
          key={slot.slotId}
          slotId={slot.slotId}
          candidates={slot.candidates}
          decorations={decorations}
          pin={pinned.get(slot.slotId) ?? null}
          onChange={(pin) => setPin(slot.slotId, pin)}
          slotDecorationIds={pinnedSlotDecorationIds.get(slot.slotId) ?? []}
          onChangeSlotDecorations={(ids) => setSlotDecorations(slot.slotId, ids)}
        />
      ))}

      {skillTotals.size > 0 && (
        <div className="small text-muted mt-2">
          <span className="fw-bold">Pinned skill totals:</span>{' '}
          {[...skillTotals.entries()]
            .map(([skillId, points]) => {
              const skill = skillsById.get(skillId)
              const name = skill?.name ?? `Skill ${skillId}`
              const active = isSkillActive(points, skill)
              return active ? `${name}: ${points} (active)` : `${name}: ${points}`
            })
            .join(', ')}
        </div>
      )}
    </div>
  )
}

function ArmorSlotPicker({
  slotId,
  candidates,
  decorations,
  pin,
  onChange,
  slotDecorationIds,
  onChangeSlotDecorations,
}: {
  slotId: string
  candidates: readonly NamedCandidate[]
  decorations: readonly NamedDecoration[]
  pin: PinnedSlot | null
  onChange: (pin: PinnedSlot | null) => void
  slotDecorationIds: readonly string[]
  onChangeSlotDecorations: (ids: readonly string[]) => void
}) {
  const [picking, setPicking] = useState(false)
  const [candidateSearch, setCandidateSearch] = useState('')
  const [decorationSearch, setDecorationSearch] = useState('')

  const candidate = pin ? candidates.find((c) => c.id === pin.candidateId) : undefined
  const usedSlots = pin
    ? pin.decorationIds.reduce((sum, id) => {
        const d = decorations.find((d) => d.id === id)
        return sum + (d?.slotSize ?? 0)
      }, 0)
    : 0
  const remainingCapacity = (candidate?.openSlotCount ?? 0) - usedSlots
  const fittableDecorations = decorations.filter(
    (d) => d.slotSize > 0 && d.slotSize <= remainingCapacity,
  )

  return (
    <div>
      <div className="fw-bold text-capitalize mb-1">{slotId}</div>

      {candidate && !picking ? (
        <div className="d-flex align-items-center gap-2">
          <span>{candidate.name}</span>
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
            aria-label={`Search pieces for ${slotId}`}
            placeholder="Type to search pieces…"
            value={candidateSearch}
            onChange={(e) => setCandidateSearch(e.target.value)}
          />
          <FilterableOptions
            items={candidates}
            search={candidateSearch}
            ariaLabel={`Pieces matching search for ${slotId}`}
            onPick={(c) => {
              onChange({ candidateId: c.id, decorationIds: [] })
              setCandidateSearch('')
              setPicking(false)
            }}
          />
          {pin && (
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary align-self-start"
              onClick={() => {
                setPicking(false)
                setCandidateSearch('')
              }}
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {candidate && !picking && (
        <div className="ms-2 mt-2">
          {pin!.decorationIds.map((decorationId, i) => {
            const decoration = decorations.find((d) => d.id === decorationId)
            return (
              <span key={i} className="badge text-bg-secondary me-1">
                {decoration?.name ?? decorationId}{' '}
                <button
                  type="button"
                  aria-label={`Remove ${decoration?.name ?? decorationId}`}
                  className="btn-close btn-close-white"
                  style={{ fontSize: '0.5rem' }}
                  onClick={() =>
                    onChange({
                      candidateId: pin!.candidateId,
                      decorationIds: pin!.decorationIds.filter((_, idx) => idx !== i),
                    })
                  }
                />
              </span>
            )
          })}

          {remainingCapacity > 0 && (
            <div className="mt-1">
              <input
                type="text"
                className="form-control form-control-sm decoration-search-input d-inline-block"
                aria-label={`Search decorations for ${slotId}`}
                placeholder="Type to search decorations…"
                value={decorationSearch}
                onChange={(e) => setDecorationSearch(e.target.value)}
              />
              <FilterableOptions
                items={fittableDecorations}
                search={decorationSearch}
                ariaLabel={`Add a decoration to ${slotId}`}
                onPick={(d) => {
                  onChange({
                    candidateId: pin!.candidateId,
                    decorationIds: [...pin!.decorationIds, d.id],
                  })
                  setDecorationSearch('')
                }}
              />
            </div>
          )}
          <span className="small text-muted ms-1">({remainingCapacity} open slots left)</span>
        </div>
      )}

      {!candidate && (
        <SlotDecorationOnlyPicker
          slotId={slotId}
          candidates={candidates}
          decorations={decorations}
          pinnedIds={slotDecorationIds}
          onChange={onChangeSlotDecorations}
        />
      )}
    </div>
  )
}

/** The TODO #12 half of this module -- forces a decoration into `slotId`
 * without pinning which candidate fills it (see this module's own
 * docstring). Only ever rendered while the slot has no piece pin; shown
 * alongside the piece search rather than replacing it, since picking a
 * piece there is still the other way to fill this same slot. */
function SlotDecorationOnlyPicker({
  slotId,
  candidates,
  decorations,
  pinnedIds,
  onChange,
}: {
  slotId: string
  candidates: readonly NamedCandidate[]
  decorations: readonly NamedDecoration[]
  pinnedIds: readonly string[]
  onChange: (ids: readonly string[]) => void
}) {
  const [search, setSearch] = useState('')

  // No candidate is chosen yet, so there's no single known capacity to bound
  // against -- the largest any candidate here could offer is a looser, safe
  // ceiling; the solver itself (via `ilp-model.ts`'s `capacityRow`) rejects a
  // pin that doesn't fit whichever candidate it ends up choosing.
  const maxCapacity = candidates.reduce((max, c) => Math.max(max, c.openSlotCount ?? 0), 0)
  const usedSlots = pinnedIds.reduce((sum, id) => {
    const d = decorations.find((d) => d.id === id)
    return sum + (d?.slotSize ?? 0)
  }, 0)
  const remainingCapacity = maxCapacity - usedSlots
  const fittableDecorations = decorations.filter(
    (d) => d.slotSize > 0 && d.slotSize <= remainingCapacity,
  )

  return (
    <div className="ms-2 mt-1">
      <div className="small text-muted mb-1">Or just a decoration:</div>
      {pinnedIds.map((decorationId, i) => {
        const decoration = decorations.find((d) => d.id === decorationId)
        return (
          <span key={i} className="badge text-bg-secondary me-1">
            {decoration?.name ?? decorationId}{' '}
            <button
              type="button"
              aria-label={`Remove ${decoration?.name ?? decorationId}`}
              className="btn-close btn-close-white"
              style={{ fontSize: '0.5rem' }}
              onClick={() => onChange(pinnedIds.filter((_, idx) => idx !== i))}
            />
          </span>
        )
      })}

      {remainingCapacity > 0 && (
        <div className="mt-1">
          <input
            type="text"
            className="form-control form-control-sm decoration-search-input d-inline-block"
            aria-label={`Search decorations to force into ${slotId}`}
            placeholder="Type to search decorations…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <FilterableOptions
            items={fittableDecorations}
            search={search}
            ariaLabel={`Force a decoration into ${slotId}`}
            onPick={(d) => {
              onChange([...pinnedIds, d.id])
              setSearch('')
            }}
          />
        </div>
      )}
      {maxCapacity > 0 && (
        <span className="small text-muted ms-1">
          ({remainingCapacity} of {maxCapacity} possible open slots left)
        </span>
      )}
    </div>
  )
}
