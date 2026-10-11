/**
 * Shared dominance check over requested-skill vectors (see docs/PLAN.md §6
 * step 4 and pareto.ts's module docstring for the full rationale). Split out
 * from pareto.ts so expand.ts can use it too, without a pareto.ts <-> expand.ts
 * import cycle (pareto.ts already imports from expand.ts).
 */

import type { SkillRequirement } from './types'

/** True if `a` is at least as good as `b` on every dimension, and they're
 * not identical -- exact ties must NOT count as domination (see pareto.ts). */
export function dominates(a: readonly number[], b: readonly number[]): boolean {
  let identical = true
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return false
    if (a[i] !== b[i]) identical = false
  }
  return !identical
}

/**
 * Caps each dimension of `raw` at its own requirement's threshold (see
 * docs/PLAN.md or the project's own direction: "once a requirement is met,
 * more points in it don't make a build better"). Used everywhere a vector is
 * built from raw per-skill point totals -- in `expand.ts`'s per-slot and
 * decoration-filling pruning, and in `pareto.ts`'s per-slot reduction and
 * cross-slot merge -- so that piling far more than what was asked for into
 * one skill is correctly treated as *equal to*, never better than, barely
 * meeting it. Applying this only at the very end (e.g. just before ranking
 * final results) isn't enough: a build using fewer decorations to just meet
 * a requirement would already have been discarded as "dominated" by one that
 * overshoots it, long before ranking ever saw either -- this has to apply
 * everywhere a vector is compared, all the way down.
 *
 * Capping is idempotent under repeated addition for non-negative values --
 * `min(min(a, c) + min(b, c), c) === min(a + b, c)` for any a, b, c >= 0 --
 * so re-capping a running total at every merge step (rather than only once
 * at the very end) gives the same result either way. Real search queries
 * only ever ask for non-negative minimums in practice (a UI control for
 * "fewer than N points of a skill" doesn't exist), so this doesn't need to
 * handle a negative `minPoints` producing a different answer than capping
 * once at the end would -- only that it still returns *some* sound ranking
 * rather than mis-computing feasibility (which stays correct regardless,
 * since `isSalvageable`'s own bound check is unaffected either way: capping
 * a dimension that has already reached its threshold can never change
 * whether `vector[k] + bestElsewhere[k] >= requirements[k].minPoints` holds).
 *
 * One real trade-off: pruning a dominated candidate as a *future building
 * block* (not just as a final answer) is only ever lossless if dominance is
 * preserved under addition -- "A dominated by B" must guarantee "A + C
 * dominated-or-tied by B + C" for *any* later addition C, or discarding A
 * could silently throw away a distinct result nothing else reaches. Raw,
 * uncapped addition always preserves a *strict* inequality (adding the same
 * C to both sides never closes a gap), so the original uncapped pruning was
 * fully lossless. Capping breaks that: because `min(x, c)` can map two
 * different raw values to the same capped one, a source that loses to
 * another *before* some addition can go from strictly-worse to exactly-tied
 * *after* it -- a tie this DP can no longer discover, since the losing
 * source was already discarded. This never hides a better achievable
 * outcome or admits an invalid one (a pruned source is never later
 * *strictly* better, only sometimes tied with a path that was kept) -- it
 * can only under-count how many distinct raw ways reach a given tied
 * outcome. See `expand.test.ts`'s brute-force property test, which checks
 * distinct achievable vectors, not exact tie counts, for exactly this
 * reason.
 *
 * Every vector this engine builds carries two more dimensions after one per
 * requirement -- open decoration slots left unused, and total points in
 * skills nobody requested (see `pareto.ts`'s `vectorOf` and `expand.ts`'s
 * `requestedVector`/decoration-filling DP, confirmed project direction: among
 * builds that already tie on every requested skill, leaving more decoration
 * capacity free for the player's own playstyle choices, or granting more
 * unrequested skill value, makes a build strictly *better*, not merely
 * different). Neither has a "requirement" to cap against -- more is always
 * better, with no ceiling -- so anything past `requirements.length` passes
 * through here unchanged instead of indexing a requirement that doesn't
 * exist for it.
 */
export function cappedVector(
  raw: readonly number[],
  requirements: readonly SkillRequirement[],
): number[] {
  return raw.map((v, k) => (k < requirements.length ? Math.min(v, requirements[k].minPoints) : v))
}

interface ParetoGroupInternal<T> {
  readonly vector: readonly number[]
  readonly origins: T[]
}

export interface ParetoGroup<T> {
  readonly vector: readonly number[]
  readonly origins: readonly T[]
}

/**
 * How many alternative origins a single tied group (`ParetoFrontier.insert`)
 * keeps once they all reach the exact same vector. Confirmed against the
 * real dataset: capping (`cappedVector`) routinely collapses tens of
 * thousands of distinct raw point totals onto one capped vector once a
 * requirement is loose relative to how many items clear it (e.g. ~13,000 of
 * ~13,000 head pieces alone satisfy "Attack >= 10") -- without a bound, every
 * one of those becomes a separate leaf in the cross-slot merge tree
 * (`pareto.ts`'s `mergeFrontierEntries`), and since tied vectors never
 * dominate each other, the merge can't prune the resulting near-full
 * cross-product away, which measurably ran the real search out of memory on
 * a single loosely-constrained skill query. Small tie groups (a handful of
 * genuinely different builds reaching the same outcome, the case this
 * project's tests exercise) are completely unaffected by the cap; only
 * groups that would otherwise grow far beyond what any caller could
 * meaningfully show as "alternatives" are truncated, to an arbitrary but
 * bounded sample rather than silently exploding.
 */
export const MAX_TIED_ORIGINS = 5

/** How much more a single open decoration slot is worth than a single bonus
 * skill point, when ranking builds that already tie on every requested skill
 * (see `expand.ts`'s `skillAndSlotsVector` and `pareto.ts`'s `vectorOf` docstrings
 * for the full rationale) -- confirmed project direction: open slots should
 * count for "vastly" more. Large enough that no realistic bonus-points total
 * could ever outweigh a single additional open slot, so this holds in
 * practice, not just on average. Shared between `pareto.ts`'s `scalarScore`
 * (final build ranking) and `expand.ts`'s decoration-filling DP (its
 * `tieBreakScore`, which needs the identical preference -- fewer decoration
 * slots used, matters far more than extra bonus points -- to decide which
 * fillings survive a full tied group). */
export const OPEN_SLOT_SCORE_WEIGHT = 10_000

/**
 * A non-dominated frontier of `origin`s keyed by their vector, built up one
 * `insert` at a time. Shared by every Pareto-frontier builder in the search
 * engine (slot merging and single-slot reduction in pareto.ts,
 * decoration-filling and candidate expansion in expand.ts) so the
 * dominance-pruning rules (including ties never counting as domination) and
 * their performance characteristics can't drift between them.
 *
 * Exact ties -- two different origins reaching the identical vector -- are
 * grouped behind an O(1) hash lookup instead of each becoming its own entry
 * a plain array would have to linearly re-scan on every insert. This isn't
 * a hypothetical: the real decoration catalog has dozens of distinct
 * decorations worth the exact same points on a given skill (e.g. 44
 * different decorations worth exactly 3 Vampirism points each), and with a
 * capacity limit, the number of combinatorially distinct ways to pick from
 * such a group (ties this project deliberately preserves -- see
 * `pareto.ts`'s module docstring) can run into the thousands. A linear-scan
 * frontier makes insertion cost scale with how many ties exist rather than
 * how many genuinely different vectors exist, which measurably took over a
 * minute on a case that should finish in under a second. `toArray` expands
 * every group back out into one entry per tied origin, so every existing
 * caller's output shape is unchanged -- only how expensively it gets there.
 *
 * A group only ever keeps its first `MAX_TIED_ORIGINS` origins (see that
 * constant's own docstring for why) -- later ones reaching the same vector
 * are dropped rather than appended, keeping both this class's own memory use
 * and every downstream consumer's input size bounded regardless of how many
 * real items happen to tie. With no `tieBreakScore`, "first found" is
 * whatever arbitrary order `insert` happened to be called in -- fine when
 * every tied origin really is interchangeable, but wrong when some are
 * genuinely better by a measure the vector itself doesn't capture (see
 * `tieBreakScore`'s own parameter docs). Passing one replaces the
 * worst-scoring kept origin with a better-scoring new one once the group is
 * full, instead of keeping whichever arrived first.
 */
export class ParetoFrontier<T> {
  private readonly groups: ParetoGroupInternal<T>[] = []
  private readonly byVectorKey = new Map<string, ParetoGroupInternal<T>>()
  private readonly tieBreakScore?: (origin: T) => number

  /** @param tieBreakScore Optional. When a tied group is already at
   * `MAX_TIED_ORIGINS`, a new origin reaching the same vector only replaces
   * the currently-kept origin with the lowest score here (ties keep whatever
   * was already there) -- otherwise it's dropped, same as with no score
   * given at all. Confirmed real need: `expand.ts`'s decoration-filling DP
   * groups fillings by requested skill alone, so once a popular skill has
   * many relevant decorations, far more fillings than `MAX_TIED_ORIGINS` can
   * tie on the same requested-skill vector -- without this, "first found"
   * (insertion order, driven by which decoration happens to be folded in
   * first) systematically favored fillings built from *several* decorations
   * stacked together over a single decoration reaching the same vector
   * alone, exactly backwards from leaving as many slots open as possible. */
  constructor(tieBreakScore?: (origin: T) => number) {
    this.tieBreakScore = tieBreakScore
  }

  insert(vector: readonly number[], origin: T): void {
    const key = vector.join(',')
    const exact = this.byVectorKey.get(key)
    if (exact !== undefined) {
      if (exact.origins.length < MAX_TIED_ORIGINS) {
        exact.origins.push(origin)
      } else if (this.tieBreakScore !== undefined) {
        this.replaceWorstIfBetter(exact.origins, origin, this.tieBreakScore)
      }
      return
    }

    for (const group of this.groups) {
      if (dominates(group.vector, vector)) return // origin adds nothing
    }
    for (let i = this.groups.length - 1; i >= 0; i--) {
      if (dominates(vector, this.groups[i].vector)) {
        this.byVectorKey.delete(this.groups[i].vector.join(','))
        this.groups.splice(i, 1)
      }
    }

    const group: ParetoGroupInternal<T> = { vector, origins: [origin] }
    this.groups.push(group)
    this.byVectorKey.set(key, group)
  }

  /** `origins` is already at `MAX_TIED_ORIGINS` -- replaces whichever
   * currently-kept one scores lowest with `candidate` if `candidate` scores
   * strictly higher, otherwise leaves `origins` untouched (a tie keeps
   * whatever was already there, matching "first found" when scores never
   * differ at all). */
  private replaceWorstIfBetter(origins: T[], candidate: T, scoreOf: (origin: T) => number): void {
    let worstIndex = 0
    let worstScore = scoreOf(origins[0])
    for (let i = 1; i < origins.length; i++) {
      const score = scoreOf(origins[i])
      if (score < worstScore) {
        worstScore = score
        worstIndex = i
      }
    }
    if (scoreOf(candidate) > worstScore) origins[worstIndex] = candidate
  }

  /** Every distinct non-dominated vector currently in the frontier, each
   * with every origin tied on it -- lets a caller fold further (e.g. the
   * decoration-filling DP in expand.ts) without paying for each tied origin
   * separately. */
  entries(): readonly ParetoGroup<T>[] {
    return this.groups
  }

  /** Every origin across every group, flattened back into one entry per
   * tied origin -- the shape every existing caller already expects. Appends
   * one at a time rather than `push(...group.origins)`: a spread call turns
   * into one function argument per element, and a single tied group can
   * legitimately hold tens of thousands of origins once vectors are capped
   * per requirement (`cappedVector`) -- far more raw point totals land on
   * the exact same capped value than used to tie on an uncapped one -- which
   * blows the engine's argument-count limit. */
  toArray(): T[] {
    const flat: T[] = []
    for (const group of this.groups) {
      for (const origin of group.origins) flat.push(origin)
    }
    return flat
  }
}
