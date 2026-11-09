/**
 * Which way a skill requirement points. A requirement at a positive tier
 * means "reach at least this many points"; one at a *negative* tier (e.g.
 * Reinforcement's "Blue Soul" at -10, a penalty tier mechanically but one
 * players actively want for its effect) means "go at least this far below
 * zero" -- a build sitting at 0 points must not count as meeting it.
 *
 * Every place that compares a total against `minPoints`, or treats "more
 * points" as better for a requested skill (ILP rows, candidate pruning, the
 * feasibility pre-check), goes through these helpers so the two directions
 * can't drift apart again.
 */

import type { SkillId } from './types'

/** `1` for a "reach at least" requirement (`minPoints >= 0`), `-1` for a
 * "go at most" one (`minPoints < 0`). Multiplying a skill's points by this
 * turns either kind into a plain "at least" comparison. */
export function requirementSign(minPoints: number): 1 | -1 {
  return minPoints < 0 ? -1 : 1
}

/** Whether `total` satisfies a requirement at `minPoints`. */
export function meetsRequirement(total: number, minPoints: number): boolean {
  return minPoints < 0 ? total <= minPoints : total >= minPoints
}

/** `meetsRequirement` over a build's full skill-total map. */
export function meetsRequirementIn(
  skillTotals: ReadonlyMap<SkillId, number>,
  requirement: { readonly skillId: SkillId; readonly minPoints: number },
): boolean {
  return meetsRequirement(skillTotals.get(requirement.skillId) ?? 0, requirement.minPoints)
}
