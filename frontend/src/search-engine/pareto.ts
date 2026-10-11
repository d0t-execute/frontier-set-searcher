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
 *
 * Slots are combined via a balanced binary tree of lazy, best-first merges
 * (`buildFrontierStream`/`mergeFrontierEntries`), not an eager left-to-right
 * fold. At real-dataset scale, a group of just two or three slots can have a
 * fully-reduced combined frontier of tens of thousands of entries even
 * though only a handful of results are ever actually wanted -- an eager fold
 * forces that entire frontier to be materialized before anything can be
 * yielded. Recursively applying the same lazy "pull only as far as needed"
 * technique used for the engine's own top-level two-way merge at *every*
 * level means the amount of work actually done is driven by how many final
 * results the caller pulls, not by the size of intermediate frontiers
 * nobody asked to see in full.
 *
 * On top of laziness, every node also prunes entries that can *never* be
 * part of a feasible result no matter what the rest of the tree contributes
 * (`isSalvageable`, docs/PLAN.md §6 step 3's original branch-and-bound idea,
 * applied as a cheap pre-filter rather than as the main search strategy).
 * Profiling against the real dataset found that with several simultaneous
 * skill requirements, the overwhelming majority of high-scoring combinations
 * fail some *individual* requirement even though their total looks
 * promising (e.g. a build that massively overshoots skill 1 while
 * contributing nothing to skill 2) -- a three-skill query needed over 52,000
 * discarded pairs to find 5 valid results, almost entirely at the final
 * merge, before this pruning was added. Discarding an entry as soon as it's
 * impossible for it to reach some requirement -- even with the single best
 * possible contribution from every other slot -- removes those pairs before
 * they ever reach the merge, since "best case from everything else" can
 * never improve by seeing the other side's *actual* (necessarily meeting or
 * trailing that bound) contribution.
 */

import { dominates, ParetoFrontier } from './dominance'
import { applyContribution } from './expand'
import { LazyList } from './lazy-list'
import { MaxHeap } from './max-heap'
import type { ExpandedOption, ExpandedSlot } from './expand'
import type { SkillId, SkillRequirement } from './types'

export { dominates } from './dominance'

export interface FrontierEntry {
  /** Points toward each of `requirements`, in the same order -- this (and
   * only this) is what dominance and ranking are computed from. */
  readonly vector: readonly number[]
  /** Full skill totals, including skills nobody requested -- kept only for
   * display in the final result, never used for dominance or ranking. */
  readonly totals: ReadonlyMap<SkillId, number>
  readonly picks: ReadonlyMap<string, ExpandedOption>
}

function vectorOf(
  totals: ReadonlyMap<SkillId, number>,
  requirements: readonly SkillRequirement[],
): number[] {
  return requirements.map((r) => totals.get(r.skillId) ?? 0)
}

/** True if `vector` could still possibly reach every requirement once
 * `bestElsewhere` (an upper bound on what the rest of the slots could
 * contribute) is added -- i.e. it isn't already a dead end on its own. */
function isSalvageable(
  vector: readonly number[],
  bestElsewhere: readonly number[],
  requirements: readonly SkillRequirement[],
): boolean {
  for (let k = 0; k < requirements.length; k++) {
    if (vector[k] + bestElsewhere[k] < requirements[k].minPoints) return false
  }
  return true
}

/** Upper bound on what a single slot could contribute to each requested
 * skill: the best any one of its options achieves for that skill alone,
 * independent of every other dimension -- computed once per slot (not once
 * per tree node a slot happens to be part of; a slot can easily have
 * hundreds of thousands of options after decoration expansion, so redoing
 * this scan at every ancestor in the merge tree, rather than summing a
 * cached per-slot result, was itself the dominant cost of the pruning
 * below at real-dataset scale). */
function slotMaxVector(slot: ExpandedSlot, requirements: readonly SkillRequirement[]): number[] {
  const best = new Array<number>(requirements.length).fill(0)
  for (const option of slot.options) {
    for (let k = 0; k < requirements.length; k++) {
      const skillId = requirements[k].skillId
      let points = 0
      for (const skill of option.skills) {
        if (skill.skillId === skillId) points += skill.points
      }
      if (points > best[k]) best[k] = points
    }
  }
  return best
}

function sumVectors(vectors: readonly (readonly number[])[], dims: number): number[] {
  const total = new Array<number>(dims).fill(0)
  for (const vector of vectors) {
    for (let k = 0; k < dims; k++) total[k] += vector[k]
  }
  return total
}

function addVectors(a: readonly number[], b: readonly number[]): number[] {
  return a.map((v, k) => v + b[k])
}

/**
 * A lazy, best-first (descending scalar score, non-dominated) stream of
 * every *potentially feasible* achievable combination across `slots`. Built
 * as a balanced binary tree of two-way merges (`mergeFrontierEntries`) down
 * to single-slot leaves -- see the module docstring for why this needs to
 * be lazy, and why entries that can never reach `requirements` are dropped
 * along the way rather than only at the very end.
 */
export function buildFrontierStream(
  slots: readonly ExpandedSlot[],
  requirements: readonly SkillRequirement[],
): LazyList<FrontierEntry> {
  // Each slot's own best-per-skill vector is computed exactly once here,
  // regardless of how many ancestor groupings it ends up contributing to --
  // see `slotMaxVector`'s docstring for why that matters at scale.
  const perSlotMax = slots.map((slot) => slotMaxVector(slot, requirements))
  return buildFrontierStreamBounded(
    slots,
    perSlotMax,
    requirements,
    new Array<number>(requirements.length).fill(0),
  )
}

/** `outsideBest` is an upper bound on what every slot *not* in `slots` could
 * still contribute -- empty at the true root, and widened by each sibling's
 * own bound on the way down so every node prunes against the tightest bound
 * available to it. `perSlotMax` runs parallel to `slots`, precomputed once
 * by `buildFrontierStream`. */
function buildFrontierStreamBounded(
  slots: readonly ExpandedSlot[],
  perSlotMax: readonly (readonly number[])[],
  requirements: readonly SkillRequirement[],
  outsideBest: readonly number[],
): LazyList<FrontierEntry> {
  if (slots.length === 0) {
    const empty: FrontierEntry = {
      vector: vectorOf(new Map(), requirements),
      totals: new Map(),
      picks: new Map(),
    }
    return new LazyList([empty])
  }

  if (slots.length === 1) {
    return new LazyList(reduceSlotOptions(slots[0], requirements, outsideBest))
  }

  const mid = Math.ceil(slots.length / 2)
  const leftSlots = slots.slice(0, mid)
  const rightSlots = slots.slice(mid)
  const leftPerSlotMax = perSlotMax.slice(0, mid)
  const rightPerSlotMax = perSlotMax.slice(mid)
  const leftBest = sumVectors(leftPerSlotMax, requirements.length)
  const rightBest = sumVectors(rightPerSlotMax, requirements.length)

  const left = buildFrontierStreamBounded(
    leftSlots,
    leftPerSlotMax,
    requirements,
    addVectors(outsideBest, rightBest),
  )
  const right = buildFrontierStreamBounded(
    rightSlots,
    rightPerSlotMax,
    requirements,
    addVectors(outsideBest, leftBest),
  )
  return new LazyList(mergeFrontierEntries(left, right, requirements, outsideBest))
}

/** Convenience wrapper that fully drains `buildFrontierStream` into an
 * array -- fine for small inputs (tests, or a group with few enough
 * achievable combinations to enumerate completely), but production search
 * code should use `buildFrontierStream` directly and pull only what it
 * needs (see `engine.ts`). */
export function computeFrontier(
  slots: readonly ExpandedSlot[],
  requirements: readonly SkillRequirement[],
): FrontierEntry[] {
  const stream = buildFrontierStream(slots, requirements)
  const result: FrontierEntry[] = []
  for (let i = 0; ; i++) {
    const entry = stream.get(i)
    if (entry === undefined) return result
    result.push(entry)
  }
}

interface PairEntry {
  readonly i: number
  readonly j: number
  readonly priority: number
}

/**
 * Lazily merges two already-sorted (descending scalar score), already
 * non-dominated frontiers into their own combined, non-dominated frontier,
 * yielded in the same descending-score order -- dropping any combination
 * that `outsideBest` proves can never be salvaged into a feasible final
 * result (see the module docstring).
 *
 * Popping strictly in descending-priority order is what makes the dominance
 * check below correct with a single pass: a pair popped later can only
 * dominate one popped earlier if their combined scores are equal (domination
 * requires every dimension >=, so summing can only increase or hold the
 * total) -- and equal scores plus domination forces the two vectors to be
 * identical, which isn't domination at all (see the module docstring on
 * ties). So no popped pair can ever be dominated by one popped after it,
 * and checking only against already-yielded vectors is enough to produce
 * the *exact* non-dominated frontier, not an approximation.
 */
function* mergeFrontierEntries(
  a: LazyList<FrontierEntry>,
  b: LazyList<FrontierEntry>,
  requirements: readonly SkillRequirement[],
  outsideBest: readonly number[],
): Generator<FrontierEntry> {
  const heap = new MaxHeap<PairEntry>((entry) => entry.priority)
  const visited = new Set<string>()

  function tryPush(i: number, j: number): void {
    const key = `${i},${j}`
    if (visited.has(key)) return
    const entryA = a.get(i)
    const entryB = b.get(j)
    if (entryA === undefined || entryB === undefined) return
    visited.add(key)
    heap.push({ i, j, priority: scalarScore(entryA.vector) + scalarScore(entryB.vector) })
  }

  tryPush(0, 0)

  const yieldedVectors: number[][] = []

  while (heap.size > 0) {
    const { i, j } = heap.pop() as PairEntry
    tryPush(i + 1, j)
    tryPush(i, j + 1)

    const entryA = a.get(i) as FrontierEntry
    const entryB = b.get(j) as FrontierEntry
    const vector = entryA.vector.map((v, k) => v + entryB.vector[k])

    if (!isSalvageable(vector, outsideBest, requirements)) continue
    if (yieldedVectors.some((v) => dominates(v, vector))) continue
    yieldedVectors.push(vector)

    yield {
      vector,
      totals: mergeTotals(entryA.totals, entryB.totals),
      picks: new Map([...entryA.picks, ...entryB.picks]),
    }
  }
}

/** A single slot's own options, Pareto-pruned in isolation (no other slots
 * involved yet) -- see the "reduce before combining" note in the module
 * docstring. Options `outsideBest` proves can never reach a feasible result
 * are dropped before they ever enter the frontier. Uses `ParetoFrontier` so
 * options tying on the exact same vector (plausible at real scale -- see
 * dominance.ts's module docstring) are grouped in O(1) rather than each
 * re-scanning the whole frontier. Sorted descending by scalar score so it
 * can serve directly as a leaf of the lazy merge tree, which requires both
 * sides of a merge to already be in that order. */
function reduceSlotOptions(
  slot: ExpandedSlot,
  requirements: readonly SkillRequirement[],
  outsideBest: readonly number[],
): FrontierEntry[] {
  const frontier = new ParetoFrontier<FrontierEntry>()
  for (const option of slot.options) {
    const totals = new Map<SkillId, number>()
    applyContribution(totals, option.skills, 1)
    const vector = vectorOf(totals, requirements)
    if (!isSalvageable(vector, outsideBest, requirements)) continue
    frontier.insert(vector, { vector, totals, picks: new Map([[slot.slotId, option]]) })
  }
  return frontier.toArray().sort((x, y) => scalarScore(y.vector) - scalarScore(x.vector))
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
 * frontier entries without needing per-dimension comparison (the combined
 * score of a pair is exactly the sum of each side's own score). */
export function scalarScore(vector: readonly number[]): number {
  let score = 0
  for (const v of vector) score += v
  return score
}
