/**
 * Shared types/helpers for pinning a specific armor piece (and specific
 * decorations) into a slot -- see components/ArmorPicker.tsx's own docstring
 * and docs/skill-system-roadmap.md TODO #7. Kept out of the component file
 * itself so that file only exports components (React Fast Refresh
 * requirement, enforced by this project's lint config).
 */

import type { NamedDecoration } from './load-bundle'
import type { SkillContribution, SkillId } from './types'

export interface PinnedSlot {
  readonly candidateId: string
  /** Decoration ids placed into this piece's open slots, in selection order
   * -- duplicates allowed (the same decoration can be placed more than
   * once), same convention as a cuff list. */
  readonly decorationIds: readonly string[]
}

export interface PinnableSlot {
  readonly slotId: string
  readonly candidates: readonly {
    readonly id: string
    readonly skills: readonly SkillContribution[]
  }[]
}

/** Sums skill contributions across every currently pinned slot's chosen
 * candidate and its placed decorations, plus every slot-only decoration pin
 * (docs/skill-system-roadmap.md TODO #12 -- a decoration forced into a slot
 * without pinning which candidate fills it) -- the "running skill point
 * totals" live-feedback ArmorPicker shows while picking. Unpinned slots (and
 * a slot-only decoration pin's own not-yet-chosen candidate) contribute
 * nothing (they're still up to the solver), so this is always a partial,
 * best-effort total, not a prediction of the final build's totals. */
export function computePinnedSkillTotals(
  pinned: ReadonlyMap<string, PinnedSlot>,
  slots: readonly PinnableSlot[],
  decorations: readonly NamedDecoration[],
  pinnedSlotDecorationIds: ReadonlyMap<string, readonly string[]> = new Map(),
): Map<SkillId, number> {
  const decorationsById = new Map(decorations.map((d) => [d.id, d]))
  const totals = new Map<SkillId, number>()
  const add = (contributions: readonly SkillContribution[]) => {
    for (const { skillId, points } of contributions) {
      totals.set(skillId, (totals.get(skillId) ?? 0) + points)
    }
  }

  for (const slot of slots) {
    const pin = pinned.get(slot.slotId)
    if (!pin) continue
    const candidate = slot.candidates.find((c) => c.id === pin.candidateId)
    if (!candidate) continue
    add(candidate.skills)
    for (const decorationId of pin.decorationIds) {
      const decoration = decorationsById.get(decorationId)
      if (decoration) add(decoration.skills)
    }
  }

  for (const [slotId, ids] of pinnedSlotDecorationIds) {
    if (pinned.has(slotId)) continue
    for (const id of ids) {
      const decoration = decorationsById.get(id)
      if (decoration) add(decoration.skills)
    }
  }

  return totals
}
