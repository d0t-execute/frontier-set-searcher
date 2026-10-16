/**
 * Detects a search that's provably impossible before ever handing it to the
 * solver (docs/feedback.md Round 1 #14: "detecting and explaining up front
 * that a request is logically impossible," e.g. the example given --
 * requesting 8 simultaneous active Zenith skills can never succeed). Scoped
 * to only what's cheaply and *provably* detectable from the data itself --
 * not every mechanic a player might expect (see this module's own
 * `findUnreachableRequirements` docstring for exactly what that covers and
 * why).
 */

import { computeAchievableRanges, pointsTowards } from './ilp-model'
import type { Cuff, Decoration, SkillId, SkillRequirement, SlotQuery } from './types'

export interface UnreachableRequirement {
  readonly skillId: SkillId
  readonly required: number
  /** The most this skill could possibly reach given the current slots/
   * decorations/cuffs/pins -- always `< required` for anything returned
   * here, and always a safe (possibly generous) upper bound, never an
   * understatement -- see `computeAchievableRanges`'s own docstring. A false
   * "reachable" is possible (the real tightest bound can be lower than this
   * one), but a false "unreachable" never is. */
  readonly maxReachable: number
}

function slotDecorationGroupsFor(
  slots: readonly SlotQuery[],
  decorations: readonly Decoration[],
): { readonly groups: readonly (readonly Decoration[])[]; readonly capacities: readonly number[] } {
  const capacities = slots.map((slot) =>
    slot.candidates.reduce((max, c) => Math.max(max, c.openSlotCount ?? 0), 0),
  )
  const groups = slots.map((_slot, s) =>
    capacities[s] > 0 ? decorations.filter((d) => d.slotSize > 0 && d.slotSize <= capacities[s]) : [],
  )
  return { groups, capacities }
}

/**
 * Every requirement whose `minPoints` provably exceeds what this query could
 * ever reach, given the current slots (already narrowed by any armor pin --
 * see `build-query.ts`'s `slotsAfterPinning`), free decoration/cuff pools,
 * and anything separately pinned (`pinnedCuffs`/`pinnedSlotDecorations`,
 * `SearchOptions`'s own fields -- their contribution is fixed, not part of
 * what the solver chooses, so it's added on top of the free pool's own safe
 * upper bound rather than folded into it).
 *
 * Reuses `ilp-model.ts`'s own `computeAchievableRanges` -- the same bound
 * `buildModel` already relies on being a safe over-estimate for its big-M
 * sizing, so a requirement this function flags is one the solver could never
 * satisfy either, not a guess. Conversely, a requirement this function
 * *doesn't* flag isn't guaranteed feasible -- the bound is deliberately loose
 * (ignores exactly how a shared capacity/budget actually divides across
 * several requirements at once) for the same reason `buildModel` can afford
 * it to be: only "provably impossible," never "probably fine," is worth
 * asserting before the solver itself actually tries.
 *
 * Deliberately does **not** attempt to detect every mechanic a player might
 * expect (e.g. the Zenith-simultaneous-skill-count question raised in
 * docs/feedback.md #14 itself) -- only what's a pure consequence of the data
 * already on hand, with no additional game-mechanic assumption baked in.
 */
export function findUnreachableRequirements(
  slots: readonly SlotQuery[],
  decorations: readonly Decoration[],
  cuffs: readonly Cuff[],
  requirements: readonly SkillRequirement[],
  pinnedCuffs: readonly Cuff[] = [],
  pinnedSlotDecorations: ReadonlyMap<string, readonly Decoration[]> = new Map(),
): readonly UnreachableRequirement[] {
  if (requirements.length === 0) return []

  const skillIds = new Set(requirements.map((r) => r.skillId))
  const { groups, capacities } = slotDecorationGroupsFor(slots, decorations)
  const ranges = computeAchievableRanges(slots, groups, capacities, cuffs, skillIds)

  function fixedContribution(skillId: SkillId): number {
    let total = 0
    for (const cuff of pinnedCuffs) total += pointsTowards(cuff.skills, skillId)
    for (const placed of pinnedSlotDecorations.values()) {
      for (const decoration of placed) total += pointsTowards(decoration.skills, skillId)
    }
    return total
  }

  const unreachable: UnreachableRequirement[] = []
  for (const req of requirements) {
    const maxReachable = (ranges.get(req.skillId)?.max ?? 0) + fixedContribution(req.skillId)
    if (maxReachable < req.minPoints) {
      unreachable.push({ skillId: req.skillId, required: req.minPoints, maxReachable })
    }
  }
  return unreachable
}
