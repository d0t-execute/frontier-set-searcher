/**
 * Enumerates the distinct ways to fill a piece's open decoration slots (see
 * docs/PLAN.md §7). Decorations are assumed to be in unlimited supply (no
 * crafting-material accounting) -- the same decoration can fill more than
 * one slot.
 */

import type { Decoration, SkillContribution } from './types'

export interface DecorationPlacement {
  readonly slotIndex: number
  readonly decoration: Decoration
}

export interface DecorationFilling {
  readonly placements: readonly DecorationPlacement[]
  /** Merged (summed per skillId) contribution from every placement. */
  readonly skills: readonly SkillContribution[]
}

export function fillSlots(
  openSlots: readonly number[],
  decorations: readonly Decoration[],
): DecorationFilling[] {
  const fillings = new Map<string, DecorationFilling>()

  function recurse(slotIndex: number, placements: DecorationPlacement[]): void {
    if (slotIndex === openSlots.length) {
      fillings.set(signature(placements), {
        placements: [...placements],
        skills: mergeSkills(placements),
      })
      return
    }

    // Leave this slot empty.
    recurse(slotIndex + 1, placements)

    // Or fill it with any decoration that fits.
    const slotSize = openSlots[slotIndex]
    for (const decoration of decorations) {
      if (decoration.slotSize > slotSize) continue
      placements.push({ slotIndex, decoration })
      recurse(slotIndex + 1, placements)
      placements.pop()
    }
  }

  recurse(0, [])
  return [...fillings.values()]
}

/** Slots are interchangeable when equal-sized and otherwise unconstrained,
 * so the signature ignores *which* slot a decoration landed in -- only the
 * multiset of decorations used distinguishes one filling from another. */
function signature(placements: readonly DecorationPlacement[]): string {
  return placements
    .map((p) => p.decoration.id)
    .sort()
    .join(',')
}

function mergeSkills(placements: readonly DecorationPlacement[]): SkillContribution[] {
  const totals = new Map<number, number>()
  for (const { decoration } of placements) {
    for (const { skillId, points } of decoration.skills) {
      totals.set(skillId, (totals.get(skillId) ?? 0) + points)
    }
  }
  return [...totals.entries()].map(([skillId, points]) => ({ skillId, points }))
}
