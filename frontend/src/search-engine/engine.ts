/**
 * The build search engine (see docs/PLAN.md §6). Slots are combined via
 * `pareto.ts`'s lazy, recursive meet-in-the-middle frontier stream -- every
 * group of slots is reduced to its Pareto-optimal frontier of achievable
 * skill vectors through a balanced binary tree of best-first merges, never
 * materializing more of any intermediate frontier than the final results
 * actually pulled require. Results are yielded in strictly
 * descending-surplus order (§6 step 5, "anytime/streaming output").
 *
 * This replaces an earlier single-pass best-first branch-and-bound over all
 * slots at once. That approach's pruning bound (every requested skill's
 * best-available option at every remaining slot, summed independently per
 * skill) is *sound* but becomes very loose once several skills must be
 * satisfied simultaneously -- confirmed by instrumentation: a realistic
 * 7-slot, 3-skill-requirement query explored 200,000 search-tree nodes
 * without reaching a single complete, valid result. An earlier version of
 * this meet-in-the-middle approach then eagerly folded each half's slots
 * together before merging the two halves; that in turn fell over at the
 * real dataset's scale (tens of thousands of genuinely distinct candidates
 * per slot), where even a two-or-three-slot group's fully-reduced frontier
 * can run to tens of thousands of entries -- forcing all of it to be built
 * before a single result could be yielded. Recursing the same lazy two-way
 * merge all the way down (`pareto.ts`) fixes that: the amount of work done
 * is driven by how many results are actually asked for, not by the size of
 * intermediate frontiers nobody asked to see in full.
 *
 * Results are deliberately pruned to non-dominated builds only: a build
 * that's no better than another on *every* requested skill is never worth
 * seeing (confirmed project direction) -- something else is always at least
 * as good. `pareto.ts` enforces this at every merge in the tree. Ties -- two
 * distinct builds reaching the exact same vector -- are always preserved,
 * never collapsed.
 */

import { DecorationFillingCache, expandSlot, filterRelevantDecorations } from './expand'
import { buildFrontierStream } from './pareto'
import type { FrontierEntry } from './pareto'
import type { BuildResult, Decoration, SkillRequirement, SlotQuery } from './types'

export function* search(
  slots: readonly SlotQuery[],
  requirements: readonly SkillRequirement[],
  decorations: readonly Decoration[] = [],
): Generator<BuildResult> {
  const relevantDecorations = filterRelevantDecorations(decorations, requirements)
  const decorationCache = new DecorationFillingCache()
  const expandedSlots = slots.map((slot) =>
    expandSlot(slot, relevantDecorations, requirements, decorationCache),
  )
  const frontier = buildFrontierStream(expandedSlots, requirements)

  for (let i = 0; ; i++) {
    const entry = frontier.get(i)
    if (entry === undefined) return

    if (!meetsAllRequirements(entry.vector, requirements)) continue
    yield buildResult(entry, requirements)
  }
}

function meetsAllRequirements(
  vector: readonly number[],
  requirements: readonly SkillRequirement[],
): boolean {
  for (let k = 0; k < requirements.length; k++) {
    if (vector[k] < requirements[k].minPoints) return false
  }
  return true
}

function buildResult(entry: FrontierEntry, requirements: readonly SkillRequirement[]): BuildResult {
  const resultDecorations = new Map<string, readonly Decoration[]>()
  for (const [slotId, option] of entry.picks) {
    if (option.decorationsUsed.length > 0) {
      resultDecorations.set(slotId, option.decorationsUsed)
    }
  }

  let surplus = 0
  for (const req of requirements) {
    surplus += (entry.totals.get(req.skillId) ?? 0) - req.minPoints
  }

  return {
    picks: new Map([...entry.picks].map(([slotId, option]) => [slotId, option.candidate])),
    decorations: resultDecorations,
    skillTotals: entry.totals,
    surplus,
  }
}
