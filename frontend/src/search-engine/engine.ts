/**
 * The build search engine (see docs/PLAN.md §6). Phase 3: correct
 * branch-and-bound DFS over equipment slots, with each candidate optionally
 * expanded by every way to fill its open decoration slots (see
 * `decorations.ts`). The meet-in-the-middle optimization is a later
 * increment once this baseline is benchmarked against the real dataset.
 */

import { fillSlots } from './decorations'
import type {
  BuildResult,
  Candidate,
  Decoration,
  SkillContribution,
  SkillId,
  SkillRequirement,
  SlotQuery,
} from './types'

/** One way to fill a slot: a candidate piece plus (possibly empty) a choice
 * of decorations for its open slots, with their contributions pre-merged. */
interface ExpandedOption {
  readonly candidate: Candidate
  readonly skills: readonly SkillContribution[]
  readonly decorationsUsed: readonly Decoration[]
}

interface ExpandedSlot {
  readonly slotId: string
  readonly options: readonly ExpandedOption[]
}

export function search(
  slots: readonly SlotQuery[],
  requirements: readonly SkillRequirement[],
  decorations: readonly Decoration[] = [],
): BuildResult[] {
  const expandedSlots = slots.map((slot) => expandSlot(slot, decorations))
  const remainingPotential = computeRemainingPotential(expandedSlots, requirements)
  const results: BuildResult[] = []
  const picks = new Map<string, ExpandedOption>()
  const totals = new Map<SkillId, number>()

  function deficit(): number {
    let total = 0
    for (const req of requirements) {
      total += Math.max(0, req.minPoints - (totals.get(req.skillId) ?? 0))
    }
    return total
  }

  function recurse(slotIndex: number): void {
    if (deficit() > remainingPotential[slotIndex]) {
      return // no combination of the remaining slots can close the gap
    }

    if (slotIndex === expandedSlots.length) {
      results.push(buildResult(picks, totals, requirements))
      return
    }

    const slot = expandedSlots[slotIndex]
    for (const option of slot.options) {
      picks.set(slot.slotId, option)
      applyContribution(totals, option.skills, 1)

      recurse(slotIndex + 1)

      applyContribution(totals, option.skills, -1)
      picks.delete(slot.slotId)
    }
  }

  recurse(0)
  return results.sort((a, b) => b.surplus - a.surplus)
}

function expandSlot(slot: SlotQuery, decorations: readonly Decoration[]): ExpandedSlot {
  const options: ExpandedOption[] = []
  for (const candidate of slot.candidates) {
    const fillings = fillSlots(candidate.openSlots ?? [], decorations)
    for (const filling of fillings) {
      options.push({
        candidate,
        skills: mergeSkills(candidate.skills, filling.skills),
        decorationsUsed: filling.placements.map((p) => p.decoration),
      })
    }
  }
  return { slotId: slot.slotId, options }
}

function mergeSkills(
  a: readonly SkillContribution[],
  b: readonly SkillContribution[],
): SkillContribution[] {
  const totals = new Map<SkillId, number>()
  for (const { skillId, points } of [...a, ...b]) {
    totals.set(skillId, (totals.get(skillId) ?? 0) + points)
  }
  return [...totals.entries()].map(([skillId, points]) => ({ skillId, points }))
}

function applyContribution(
  totals: Map<SkillId, number>,
  skills: readonly SkillContribution[],
  sign: 1 | -1,
): void {
  for (const contribution of skills) {
    const next = (totals.get(contribution.skillId) ?? 0) + sign * contribution.points
    if (next === 0) {
      totals.delete(contribution.skillId)
    } else {
      totals.set(contribution.skillId, next)
    }
  }
}

function buildResult(
  picks: ReadonlyMap<string, ExpandedOption>,
  totals: ReadonlyMap<SkillId, number>,
  requirements: readonly SkillRequirement[],
): BuildResult {
  let surplus = 0
  for (const req of requirements) {
    surplus += (totals.get(req.skillId) ?? 0) - req.minPoints
  }

  const resultPicks = new Map<string, Candidate>()
  const resultDecorations = new Map<string, readonly Decoration[]>()
  for (const [slotId, option] of picks) {
    resultPicks.set(slotId, option.candidate)
    if (option.decorationsUsed.length > 0) {
      resultDecorations.set(slotId, option.decorationsUsed)
    }
  }

  return {
    picks: resultPicks,
    decorations: resultDecorations,
    skillTotals: new Map(totals),
    surplus,
  }
}

/**
 * `remainingPotential[i]` is the maximum total deficit reduction achievable
 * from slots `i..end`, assuming (conservatively) every requested skill's
 * best-available option at each remaining slot could be picked
 * simultaneously. This over-estimates what's actually achievable (since a
 * single option can't necessarily max out every skill at once), which is
 * exactly what a sound branch-and-bound upper bound needs to be: safe to
 * prune on, never too tight.
 */
function computeRemainingPotential(
  slots: readonly ExpandedSlot[],
  requirements: readonly SkillRequirement[],
): number[] {
  const perSlotBest = slots.map((slot) => {
    let best = 0
    for (const requirement of requirements) {
      const bestForSkill = Math.max(
        0,
        ...slot.options.map(
          (o) => o.skills.find((s) => s.skillId === requirement.skillId)?.points ?? 0,
        ),
      )
      best += bestForSkill
    }
    return best
  })

  const suffixSums = new Array<number>(slots.length + 1).fill(0)
  for (let i = slots.length - 1; i >= 0; i--) {
    suffixSums[i] = suffixSums[i + 1] + perSlotBest[i]
  }
  return suffixSums
}
