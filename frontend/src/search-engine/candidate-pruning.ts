/**
 * Drops armor candidates that provably can't appear in a search's top `keep`
 * results before `ilp-model.ts`'s `buildModel` ever sees them
 * (docs/search-performance-research.md approach 1). Every slot of the real
 * dataset hands the solver ~12,000-13,000 candidates, nearly all of them
 * irrelevant to any one query, and HiGHS's cost on real queries was found to
 * be dominated by carrying that many columns through presolve and root-node
 * cut rounds (the two easier real-data benchmark queries solve at the root
 * node -- no branching at all -- yet still took 14-27s per round).
 *
 * The rule is "k-dominance": candidate `x` in a slot is dropped only when at
 * least `keep` other candidates *in the same slot* each dominate it --
 * meaning swapping `x` out for any one of them, in *any* build, keeps that
 * build valid and ranks it at least as high. Each of those swaps produces a
 * distinct build, so any build using `x` is matched or beaten by `keep`
 * distinct builds that don't need `x` (applying the same swap argument slot
 * by slot when a build uses several dropped candidates), which is exactly
 * "`x` can never be needed to fill the top `keep`." Ties at the `keep`-th
 * rank may resolve to a different, equally-ranked build than the unpruned
 * model would have picked, which was already true of the solver itself.
 * Dominators are only ever counted among candidates already kept, so a
 * candidate is never dropped on the strength of another dropped one; by
 * transitivity this loses no pruning, since whatever dominated a dropped
 * dominator dominates its victims too.
 *
 * "Dominates" has to cover every row and objective term a candidate column
 * feeds in `buildModel`, or the swap argument breaks:
 * - hard requirements, optional skills, and requested resistance floors:
 *   at least as many points (all three are `>=` rows, or rewarded `>=`);
 * - excluded-active skills: *equal* points (two-sided rows -- more could
 *   activate the skill, fewer could activate a penalty tier);
 * - open slots: at least as many (decorations placed for `x` still fit);
 * - objective coefficient: at least as large (`candidateObjectiveCost`);
 * - preferred categories: `y` counts toward every category `x` does.
 *
 * `preferExactMatches` with tier data is deliberately left unpruned: its
 * penalty depends on each bonus skill's *total* across the build, which
 * isn't monotone in any one piece's points (another piece's negative points
 * can cancel a positive one), so a sound swap rule needs every bonus skill's
 * points to match or provably not matter. Measured against the real dataset
 * (2026-10-26), the best such rule found -- clipping each bonus skill to the
 * range the rest of a build can reach -- still kept 36k-49k of ~62k
 * candidates and cost 10-13s to compute, a net slowdown. See
 * docs/search-performance-research.md for what exact mode needs instead.
 */

import {
  candidateObjectiveCost,
  decorationObjectiveCost,
  hasTierPenalties,
  pointsTowards,
  skillPreferenceIdsOf,
} from './ilp-model'
import type {
  Candidate,
  Decoration,
  SearchOptions,
  SkillId,
  SkillRequirement,
  SlotQuery,
} from './types'

interface CandidateRecord {
  readonly candidate: Candidate
  readonly objective: number
  /** Dimensions where more is never worse: requested, optional, and
   * resistance-floor amounts, then open slots. */
  readonly atLeast: readonly number[]
  readonly atLeastSum: number
  /** Excluded-active skill points, which must match exactly. */
  readonly exactKey: string
  /** Bit `i` set when this candidate counts toward preferred category `i`. */
  readonly categoryMask: number
}

function dominates(x: CandidateRecord, y: CandidateRecord): boolean {
  if (y.objective < x.objective) return false
  if ((x.categoryMask & ~y.categoryMask) !== 0) return false
  for (let d = 0; d < x.atLeast.length; d++) {
    if (y.atLeast[d] < x.atLeast[d]) return false
  }
  return true
}

function pruneSlot(
  candidates: readonly Candidate[],
  keep: number,
  requirements: readonly SkillRequirement[],
  skillPreferenceIds: ReadonlySet<SkillId>,
  options: SearchOptions,
): Candidate[] {
  const optional = options.optionalSkillRequirements ?? []
  const floors = options.resistanceFloors ?? []
  const excluded = options.excludedActiveSkillIds ?? []
  const categories = (options.preferredCategoryCounts ?? []).filter((p) => p.count > 0)

  const records = candidates.map((candidate): CandidateRecord => {
    const atLeast = [
      ...requirements.map((r) => pointsTowards(candidate.skills, r.skillId)),
      ...optional.map((r) => pointsTowards(candidate.skills, r.skillId)),
      ...floors.map((f) => candidate.resistances?.[f.element] ?? 0),
      candidate.openSlotCount ?? 0,
    ]
    let categoryMask = 0
    categories.forEach((p, i) => {
      if (candidate.category === p.category) categoryMask |= 1 << i
    })
    return {
      candidate,
      objective: candidateObjectiveCost(candidate, skillPreferenceIds, options),
      atLeast,
      atLeastSum: atLeast.reduce((sum, v) => sum + v, 0),
      exactKey: excluded.map((id) => pointsTowards(candidate.skills, id)).join(','),
      categoryMask,
    }
  })

  // Likely dominators first, so most candidates find their `keep`
  // dominators early in the kept list. Order only affects how much gets
  // pruned, never whether a drop is sound.
  records.sort((a, b) => b.objective - a.objective || b.atLeastSum - a.atLeastSum)

  const keptByExactKey = new Map<string, CandidateRecord[]>()
  const kept = new Set<Candidate>()
  for (const x of records) {
    const peers = keptByExactKey.get(x.exactKey) ?? []
    let dominators = 0
    for (const y of peers) {
      if (dominates(x, y) && ++dominators >= keep) break
    }
    if (dominators >= keep) continue
    peers.push(x)
    keptByExactKey.set(x.exactKey, peers)
    kept.add(x.candidate)
  }
  // Original order, so ties the solver breaks by column order still break
  // the same way they would have without pruning.
  return candidates.filter((c) => kept.has(c))
}

/** See this module's own docstring. Returns `slots` unchanged whenever
 * pruning wouldn't be sound (`preferExactMatches` with tier data) or
 * couldn't remove anything (a slot with at most `keep` candidates, e.g. a
 * pinned slot or the synthesized weapon slot). */
export function pruneDominatedCandidates(
  slots: readonly SlotQuery[],
  requirements: readonly SkillRequirement[],
  options: SearchOptions,
  keep: number,
): readonly SlotQuery[] {
  if (hasTierPenalties(options)) return slots
  // A bitmask can't represent more preferred categories than this; the UI
  // never gets close, so just don't prune rather than handle it.
  if ((options.preferredCategoryCounts?.length ?? 0) > 30) return slots

  const skillPreferenceIds = skillPreferenceIdsOf(requirements, options)
  return slots.map((slot) =>
    slot.candidates.length <= keep
      ? slot
      : {
          slotId: slot.slotId,
          candidates: pruneSlot(slot.candidates, keep, requirements, skillPreferenceIds, options),
        },
  )
}

/**
 * Drops decorations another decoration beats or matches on everything the
 * model scores (docs/search-performance-research.md approach 2): no larger
 * slot size, at least as many points in every requested and optional skill,
 * exactly as many in every excluded-active skill, and an objective
 * coefficient at least as large. Decorations are pooled with unlimited
 * copies (see `ilp-model.ts`'s module docstring), so swapping every copy of a
 * dominated decoration for its dominator keeps any build valid, still fits
 * (it's no larger), and ranks it at least as high. That makes plain
 * dominance, not k-dominance, exact for every result: each gear set's best
 * decoration fill never needs a dominated decoration. Of decorations that
 * tie on everything, the first is kept.
 *
 * Skipped under `preferExactMatches` with tier data for the same reason
 * `pruneDominatedCandidates` is (bonus-skill totals aren't monotone).
 * Pinned decorations never pass through here -- `buildModel` reads them from
 * `SearchOptions.pinnedSlotDecorations` directly.
 */
export function pruneDominatedDecorations(
  decorations: readonly Decoration[],
  requirements: readonly SkillRequirement[],
  options: SearchOptions,
): readonly Decoration[] {
  if (hasTierPenalties(options)) return decorations

  const skillPreferenceIds = skillPreferenceIdsOf(requirements, options)
  const scoredSkills = [...requirements, ...(options.optionalSkillRequirements ?? [])].map(
    (r) => r.skillId,
  )
  const excluded = options.excludedActiveSkillIds ?? []
  const records = decorations.map((decoration) => ({
    decoration,
    objective: decorationObjectiveCost(decoration, skillPreferenceIds, options),
    points: scoredSkills.map((id) => pointsTowards(decoration.skills, id)),
    exactKey: excluded.map((id) => pointsTowards(decoration.skills, id)).join(','),
  }))
  records.sort(
    (a, b) =>
      b.objective - a.objective ||
      a.decoration.slotSize - b.decoration.slotSize ||
      b.points.reduce((sum, p) => sum + p, 0) - a.points.reduce((sum, p) => sum + p, 0),
  )

  const kept: typeof records = []
  for (const x of records) {
    const dominated = kept.some(
      (y) =>
        y.exactKey === x.exactKey &&
        y.objective >= x.objective &&
        y.decoration.slotSize <= x.decoration.slotSize &&
        y.points.every((p, i) => p >= x.points[i]),
    )
    if (!dominated) kept.push(x)
  }
  const keptSet = new Set(kept.map((r) => r.decoration))
  return decorations.filter((d) => keptSet.has(d))
}
