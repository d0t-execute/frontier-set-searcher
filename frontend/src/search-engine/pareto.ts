/**
 * Computes the Pareto-optimal frontier of achievable skill combinations
 * across a group of slots (see docs/PLAN.md §6 step 4, meet-in-the-middle:
 * "enumerate/bucket each half's achievable skill vectors"). A combination
 * that's no better than another on *every* requested skill can never be
 * part of an optimal build, so it's discarded -- this is what keeps the
 * frontier size tractable instead of growing with the full cross-product of
 * every slot's options.
 *
 * Ties are deliberately preserved: two different builds that happen to
 * achieve the exact same requested-skill vector are NOT considered to
 * dominate each other (see `dominates`), so both survive. Dropping one
 * would silently lose a distinct, equally valid result -- e.g. two
 * different helms granting the same requested skill points but different
 * bonus skills nobody asked for are still different builds worth showing.
 */

import { applyContribution } from './expand'
import type { ExpandedOption, ExpandedSlot } from './expand'
import type { SkillId, SkillRequirement } from './types'

export interface FrontierEntry {
  /** Points toward each of `requirements`, in the same order -- this (and
   * only this) is what dominance and ranking are computed from. */
  readonly vector: readonly number[]
  /** Full skill totals, including skills nobody requested -- kept only for
   * display in the final result, never used for dominance or ranking. */
  readonly totals: ReadonlyMap<SkillId, number>
  readonly picks: ReadonlyMap<string, ExpandedOption>
}

/** True if `a` is at least as good as `b` on every requested skill, and
 * they're not identical -- see the module docstring on why exact ties must
 * NOT count as domination. */
export function dominates(a: readonly number[], b: readonly number[]): boolean {
  let identical = true
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return false
    if (a[i] !== b[i]) identical = false
  }
  return !identical
}

function insert(frontier: FrontierEntry[], candidate: FrontierEntry): void {
  for (const existing of frontier) {
    if (dominates(existing.vector, candidate.vector)) return // candidate adds nothing
  }
  for (let i = frontier.length - 1; i >= 0; i--) {
    if (dominates(candidate.vector, frontier[i].vector)) {
      frontier.splice(i, 1)
    }
  }
  frontier.push(candidate)
}

function vectorOf(
  totals: ReadonlyMap<SkillId, number>,
  requirements: readonly SkillRequirement[],
): number[] {
  return requirements.map((r) => totals.get(r.skillId) ?? 0)
}

export function computeFrontier(
  slots: readonly ExpandedSlot[],
  requirements: readonly SkillRequirement[],
): FrontierEntry[] {
  let frontier: FrontierEntry[] = [
    { vector: vectorOf(new Map(), requirements), totals: new Map(), picks: new Map() },
  ]

  for (const slot of slots) {
    // Reduce this slot's own options to its own frontier *before* combining
    // with the running cross-slot frontier. A slot can easily have over a
    // thousand options after decoration expansion, but only a handful of
    // skills are ever tracked -- most of those options are already
    // dominated by another option *within the same slot*, independent of
    // anything else. Skipping this step doesn't change the final result
    // (domination is transitive, so a same-slot-dominated option could
    // never survive the full cross-slot computation anyway), but it was
    // the dominant cost: combining against the raw, unreduced option list
    // made both the number of insertions *and* the frontier they got
    // inserted into far bigger than necessary at every subsequent slot.
    const slotFrontier = reduceSlotOptions(slot, requirements)

    const next: FrontierEntry[] = []
    for (const entry of frontier) {
      for (const slotEntry of slotFrontier) {
        const totals = mergeTotals(entry.totals, slotEntry.totals)
        const picks = new Map([...entry.picks, ...slotEntry.picks])
        insert(next, { vector: vectorOf(totals, requirements), totals, picks })
      }
    }
    frontier = next
  }

  return frontier
}

/** A single slot's own options, Pareto-pruned in isolation (no other slots
 * involved yet) -- see the "reduce before combining" note above. */
function reduceSlotOptions(
  slot: ExpandedSlot,
  requirements: readonly SkillRequirement[],
): FrontierEntry[] {
  const reduced: FrontierEntry[] = []
  for (const option of slot.options) {
    const totals = new Map<SkillId, number>()
    applyContribution(totals, option.skills, 1)
    insert(reduced, {
      vector: vectorOf(totals, requirements),
      totals,
      picks: new Map([[slot.slotId, option]]),
    })
  }
  return reduced
}

export function mergeTotals(
  a: ReadonlyMap<SkillId, number>,
  b: ReadonlyMap<SkillId, number>,
): Map<SkillId, number> {
  const totals = new Map(a)
  for (const [skillId, points] of b) {
    totals.set(skillId, (totals.get(skillId) ?? 0) + points)
  }
  return totals
}

/** Sum of a frontier entry's requested-skill vector -- used to rank/merge
 * two frontiers' entries without needing per-dimension comparison (see
 * `engine.ts`: the combined surplus of a pair is exactly the sum of each
 * side's own scalar score, minus a constant). */
export function scalarScore(vector: readonly number[]): number {
  let score = 0
  for (const v of vector) score += v
  return score
}
