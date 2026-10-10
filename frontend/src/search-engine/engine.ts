/**
 * The build search engine (see docs/PLAN.md §6). A best-first branch-and-
 * bound search that *streams* results in strictly descending-surplus order
 * (§6 step 5, "anytime/streaming output") -- it never materializes the full
 * combinatorial space, which matters a great deal in practice: even a
 * modest synthetic benchmark (7 slots, 20 candidates each) has hundreds of
 * thousands of valid combinations. Callers `for...of` (or manually pull
 * via `.next()`) and stop whenever they have enough -- the generator does
 * no work beyond what's needed to produce the results actually consumed.
 *
 * Each slot's options are precomputed, sorted, and expanded *lazily*: when
 * a node is popped off the priority queue, it pushes at most two new
 * entries (the next slot's best option, and this slot's next-best sibling
 * option) rather than fanning out every option at once. A slot can easily
 * have thousands of options after decoration expansion, so eagerly pushing
 * all of them per visited node would make the heap itself the bottleneck --
 * this bounds heap growth to O(entries popped), not
 * O(entries popped x branching factor).
 */

import { fillSlots } from './decorations'
import { MaxHeap } from './max-heap'
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

interface SortedSlot {
  readonly slotId: string
  /** Descending by contribution to the requested skills only -- see
   * `requestedScore`. This is what makes lazy sibling generation valid: for
   * any fixed parent state, two sibling options' relative priority is
   * determined entirely by this score, independent of the parent. */
  readonly options: readonly ExpandedOption[]
}

/** One specific choice at `slotIndex`, plus enough context to lazily
 * generate its own next-best sibling when popped. */
interface Entry {
  readonly slotIndex: number
  readonly optionIndex: number
  readonly picks: ReadonlyMap<string, ExpandedOption>
  readonly totals: ReadonlyMap<SkillId, number>
  /** Admissible upper bound on the best final surplus reachable through
   * this entry -- see `computeRemainingPotential`. */
  readonly priority: number
  readonly parentPicks: ReadonlyMap<string, ExpandedOption>
  readonly parentTotals: ReadonlyMap<SkillId, number>
}

export function* search(
  slots: readonly SlotQuery[],
  requirements: readonly SkillRequirement[],
  decorations: readonly Decoration[] = [],
): Generator<BuildResult> {
  // A decoration that contributes to none of the requested skills can never
  // change whether a requirement is met or how results are ranked -- only
  // relevant decorations are worth expanding into options. This isn't just
  // an optimization: without it, every candidate's open slots get filled
  // with every combination of *all* decorations in the catalog (hundreds in
  // the real dataset), which blows up the per-slot option count
  // combinatorially before the search even starts and exhausts memory long
  // before producing a single result.
  const requestedSkillIds = new Set(requirements.map((r) => r.skillId))
  const relevantDecorations = decorations.filter((d) =>
    d.skills.some((s) => requestedSkillIds.has(s.skillId)),
  )

  const expandedSlots = slots.map((slot) => expandSlot(slot, relevantDecorations))
  const remainingPotential = computeRemainingPotential(expandedSlots, requirements)
  const sortedSlots: SortedSlot[] = expandedSlots.map((slot) => ({
    slotId: slot.slotId,
    options: [...slot.options].sort(
      (a, b) => requestedScore(b, requirements) - requestedScore(a, requirements),
    ),
  }))

  if (sortedSlots.length === 0) {
    if (computeDeficit(new Map(), requirements) <= 0) {
      yield buildResult(new Map(), new Map(), requirements)
    }
    return
  }

  const heap = new MaxHeap<Entry>((entry) => entry.priority)

  // Scans forward from `optionIndex` and pushes the first *feasible* option
  // it finds, then stops -- it must not simply test `optionIndex` alone and
  // give up. An infeasible option is never pushed, so it's never popped,
  // so its sibling-generation step (triggered on pop, see the main loop)
  // would never run -- without this scan, an infeasible best-sorted option
  // would silently cut off every feasible option ranked below it.
  function tryPush(
    slotIndex: number,
    optionIndex: number,
    parentPicks: ReadonlyMap<string, ExpandedOption>,
    parentTotals: ReadonlyMap<SkillId, number>,
  ): void {
    const options = sortedSlots[slotIndex].options
    for (let i = optionIndex; i < options.length; i++) {
      const option = options[i]
      const totals = new Map(parentTotals)
      applyContribution(totals, option.skills, 1)
      if (computeDeficit(totals, requirements) > remainingPotential[slotIndex + 1]) continue

      const picks = new Map(parentPicks)
      picks.set(sortedSlots[slotIndex].slotId, option)

      heap.push({
        slotIndex,
        optionIndex: i,
        picks,
        totals,
        priority: completedSurplus(totals, requirements) + remainingPotential[slotIndex + 1],
        parentPicks,
        parentTotals,
      })
      return
    }
  }

  tryPush(0, 0, new Map(), new Map())

  while (heap.size > 0) {
    const entry = heap.pop() as Entry

    // This entry's next-best sibling at the same slot remains reachable
    // regardless of whether we go on to expand `entry` into a child or
    // yield it as a result -- both are independent of what happens at this
    // same slot's other options.
    tryPush(entry.slotIndex, entry.optionIndex + 1, entry.parentPicks, entry.parentTotals)

    if (entry.slotIndex === sortedSlots.length - 1) {
      yield buildResult(entry.picks, entry.totals, requirements)
    } else {
      tryPush(entry.slotIndex + 1, 0, entry.picks, entry.totals)
    }
  }
}

/** Sum of this option's contribution to only the requested skills -- the
 * score lazy sibling expansion sorts by (see `SortedSlot`). */
function requestedScore(option: ExpandedOption, requirements: readonly SkillRequirement[]): number {
  let score = 0
  for (const req of requirements) {
    score += option.skills.find((s) => s.skillId === req.skillId)?.points ?? 0
  }
  return score
}

/** Per-requirement shortfall (never negative) -- a node can only reach a
 * complete, valid assignment if this never exceeds what the remaining slots
 * could still contribute. Deliberately distinct from `completedSurplus`: a
 * requirement that's already overshot can't "lend" its excess to a
 * different, still-unmet requirement. */
function computeDeficit(
  totals: ReadonlyMap<SkillId, number>,
  requirements: readonly SkillRequirement[],
): number {
  let deficit = 0
  for (const req of requirements) {
    deficit += Math.max(0, req.minPoints - (totals.get(req.skillId) ?? 0))
  }
  return deficit
}

function completedSurplus(
  totals: ReadonlyMap<SkillId, number>,
  requirements: readonly SkillRequirement[],
): number {
  let surplus = 0
  for (const req of requirements) {
    surplus += (totals.get(req.skillId) ?? 0) - req.minPoints
  }
  return surplus
}

function expandSlot(
  slot: SlotQuery,
  decorations: readonly Decoration[],
): { slotId: string; options: ExpandedOption[] } {
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
    surplus: completedSurplus(totals, requirements),
  }
}

/**
 * `remainingPotential[i]` is the maximum total deficit reduction -- or,
 * equivalently, the maximum additional surplus -- achievable from slots
 * `i..end`, assuming (conservatively) every requested skill's
 * best-available option at each remaining slot could be picked
 * simultaneously. This over-estimates what's actually achievable (since a
 * single option can't necessarily max out every skill at once), which is
 * exactly what a sound upper bound needs to be: safe to prune on, safe to
 * use as a best-first priority, never too tight (never claims less is
 * reachable than truly is).
 */
function computeRemainingPotential(
  slots: readonly { slotId: string; options: readonly ExpandedOption[] }[],
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
