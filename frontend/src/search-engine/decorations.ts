/**
 * Enumerates the distinct ways to fill a piece's open decoration slots (see
 * docs/PLAN.md §7). A piece has a total count of plain, interchangeable open
 * slot units; each decoration consumes `slotSize` (1-3) of those units
 * (confirmed by the project owner -- there is no per-slot sizing). Decorations
 * are assumed to be in unlimited supply (no crafting-material accounting) --
 * the same decoration can be placed more than once.
 */

import type { Decoration, SkillContribution } from './types'

export interface DecorationFilling {
  readonly decorationsUsed: readonly Decoration[]
  /** Merged (summed per skillId) contribution from every placement. */
  readonly skills: readonly SkillContribution[]
}

export function fillSlots(
  openSlotCount: number,
  decorations: readonly Decoration[],
): DecorationFilling[] {
  const fillings: DecorationFilling[] = []
  const current: Decoration[] = []

  // Walks decorations in a fixed order, choosing how many copies of each to
  // use (0..as many as fit in the remaining capacity). Because the count per
  // decoration is decided once each, in index order, every reachable multiset
  // is produced exactly once -- no need to dedupe afterwards.
  function recurse(index: number, remainingCapacity: number): void {
    if (index === decorations.length) {
      fillings.push({ decorationsUsed: [...current], skills: mergeSkills(current) })
      return
    }

    const decoration = decorations[index]
    const maxCount =
      decoration.slotSize > 0 ? Math.floor(remainingCapacity / decoration.slotSize) : 0
    for (let count = 0; count <= maxCount; count++) {
      for (let i = 0; i < count; i++) current.push(decoration)
      recurse(index + 1, remainingCapacity - count * decoration.slotSize)
      current.length -= count
    }
  }

  recurse(0, openSlotCount)
  return fillings
}

function mergeSkills(decorations: readonly Decoration[]): SkillContribution[] {
  const totals = new Map<number, number>()
  for (const decoration of decorations) {
    for (const { skillId, points } of decoration.skills) {
      totals.set(skillId, (totals.get(skillId) ?? 0) + points)
    }
  }
  return [...totals.entries()].map(([skillId, points]) => ({ skillId, points }))
}
