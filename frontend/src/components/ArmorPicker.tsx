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
  readonly skills: readonly NamedSkill[]
}

export function ArmorPicker({ slots, decorations, pinned, onChange, skills }: ArmorPickerProps) {
  const skillsById = new Map(skills.map((s) => [s.id, s]))
  const skillTotals = computePinnedSkillTotals(pinned, slots, decorations)

  function setPin(slotId: string, pin: PinnedSlot | null): void {
    const next = new Map(pinned)
    if (pin) next.set(slotId, pin)
    else next.delete(slotId)
    onChange(next)
  }

  return (
    <div>
      {slots.map((slot) => (
        <ArmorSlotPicker
          key={slot.slotId}
          slotId={slot.slotId}
          candidates={slot.candidates}
          decorations={decorations}
          pin={pinned.get(slot.slotId) ?? null}
          onChange={(pin) => setPin(slot.slotId, pin)}
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
}: {
  slotId: string
  candidates: readonly NamedCandidate[]
  decorations: readonly NamedDecoration[]
  pin: PinnedSlot | null
  onChange: (pin: PinnedSlot | null) => void
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
    <div className="mb-2">
      <div className="fw-bold text-capitalize">{slotId}</div>

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
        <div>
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
              className="btn btn-sm btn-outline-secondary mt-1"
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
        <div className="ms-2 mt-1">
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
            <div>
              <input
                type="text"
                className="form-control form-control-sm w-auto d-inline-block"
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
    </div>
  )
}
