/**
 * The build search engine (see docs/PLAN.md §6). Meet-in-the-middle: slots
 * are split into two halves, each reduced to its Pareto-optimal frontier of
 * achievable skill vectors (`pareto.ts`), then the two frontiers are merged
 * via a best-first streaming join -- *not* a full cross-product. Results
 * are yielded in strictly descending-surplus order (§6 step 5,
 * "anytime/streaming output") without ever materializing the full
 * combinatorial space.
 *
 * This replaces an earlier single-pass best-first branch-and-bound over all
 * slots at once. That approach's pruning bound (every requested skill's
 * best-available option at every remaining slot, summed independently per
 * skill) is *sound* but becomes very loose once several skills must be
 * satisfied simultaneously -- confirmed by instrumentation: a realistic
 * 7-slot, 3-skill-requirement query explored 200,000 search-tree nodes
 * without reaching a single complete, valid result. Splitting into two
 * halves and computing each half's *exact* reachable frontier (not a loose
 * per-skill bound) avoids that failure mode: the pairwise merge's priority
 * is the pair's actual final surplus, not an estimate of it.
 *
 * Results are deliberately pruned to non-dominated builds only: a build
 * that's no better than another on *every* requested skill is never worth
 * seeing (confirmed project direction) -- something else is always at least
 * as good. `pareto.ts` prunes this within each half; the main loop here
 * additionally tracks already-yielded combined vectors to catch pairs that
 * are each non-dominated *within their own half* but still dominated by a
 * different pair once combined (two vectors can be mutually incomparable
 * alone yet one may still lose to a different combination once paired).
 * Ties -- two distinct builds reaching the exact same vector -- are always
 * preserved, never collapsed.
 */

import { expandSlot, filterRelevantDecorations } from './expand'
import { MaxHeap } from './max-heap'
import { computeFrontier, dominates, mergeTotals, scalarScore } from './pareto'
import type { FrontierEntry } from './pareto'
import type { BuildResult, Decoration, SkillRequirement, SlotQuery } from './types'

interface PairEntry {
  readonly i: number
  readonly j: number
  readonly priority: number
}

export function* search(
  slots: readonly SlotQuery[],
  requirements: readonly SkillRequirement[],
  decorations: readonly Decoration[] = [],
): Generator<BuildResult> {
  const relevantDecorations = filterRelevantDecorations(decorations, requirements)
  const expandedSlots = slots.map((slot) => expandSlot(slot, relevantDecorations))

  const mid = Math.ceil(expandedSlots.length / 2)
  const frontierA = sortedByScalarScore(computeFrontier(expandedSlots.slice(0, mid), requirements))
  const frontierB = sortedByScalarScore(computeFrontier(expandedSlots.slice(mid), requirements))

  // Both arrays are sorted descending by scalar score, so a pair's priority
  // (the sum of its two sides' scores) is non-increasing as either index
  // grows -- the same lazy "push (i+1,j) and (i,j+1), dedupe via `visited`"
  // technique used for streaming the k largest pair-sums from two sorted
  // arrays, generalized here to also gate each popped pair on whether it
  // actually satisfies every individual requirement (a high combined scalar
  // score doesn't guarantee that -- one side could overshoot one skill
  // while the other undershoots a different one).
  const heap = new MaxHeap<PairEntry>((entry) => entry.priority)
  const visited = new Set<string>()

  function tryPush(i: number, j: number): void {
    if (i >= frontierA.length || j >= frontierB.length) return
    const key = `${i},${j}`
    if (visited.has(key)) return
    visited.add(key)
    heap.push({
      i,
      j,
      priority: scalarScore(frontierA[i].vector) + scalarScore(frontierB[j].vector),
    })
  }

  tryPush(0, 0)

  // Pruning within each half (see `pareto.ts`) doesn't catch every globally
  // dominated pair: two vectors can each be non-dominated *within their own
  // half* yet still combine into a pair that's dominated by a *different*
  // pair drawn from the other side of each half. Tracking already-yielded
  // vectors here closes that gap cheaply, since results stream out in
  // descending-priority order already -- a later pair only needs checking
  // against what's already been accepted, not the whole space.
  const yieldedVectors: number[][] = []

  while (heap.size > 0) {
    const { i, j } = heap.pop() as PairEntry
    tryPush(i + 1, j)
    tryPush(i, j + 1)

    const a = frontierA[i]
    const b = frontierB[j]
    if (!meetsAllRequirements(a.vector, b.vector, requirements)) continue

    const combined = a.vector.map((v, k) => v + b.vector[k])
    if (yieldedVectors.some((v) => dominates(v, combined))) continue

    yieldedVectors.push(combined)
    yield buildResult(a, b, requirements)
  }
}

function sortedByScalarScore(frontier: FrontierEntry[]): FrontierEntry[] {
  return [...frontier].sort((x, y) => scalarScore(y.vector) - scalarScore(x.vector))
}

function meetsAllRequirements(
  a: readonly number[],
  b: readonly number[],
  requirements: readonly SkillRequirement[],
): boolean {
  for (let k = 0; k < requirements.length; k++) {
    if (a[k] + b[k] < requirements[k].minPoints) return false
  }
  return true
}

function buildResult(
  a: FrontierEntry,
  b: FrontierEntry,
  requirements: readonly SkillRequirement[],
): BuildResult {
  const picks = new Map([...a.picks, ...b.picks])
  const totals = mergeTotals(a.totals, b.totals)

  const resultDecorations = new Map<string, readonly Decoration[]>()
  for (const [slotId, option] of picks) {
    if (option.decorationsUsed.length > 0) {
      resultDecorations.set(slotId, option.decorationsUsed)
    }
  }

  let surplus = 0
  for (const req of requirements) {
    surplus += (totals.get(req.skillId) ?? 0) - req.minPoints
  }

  return {
    picks: new Map([...picks].map(([slotId, option]) => [slotId, option.candidate])),
    decorations: resultDecorations,
    skillTotals: totals,
    surplus,
  }
}
