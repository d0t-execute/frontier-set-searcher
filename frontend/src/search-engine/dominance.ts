/**
 * Shared dominance check over requested-skill vectors (see docs/PLAN.md §6
 * step 4 and pareto.ts's module docstring for the full rationale). Split out
 * from pareto.ts so expand.ts can use it too, without a pareto.ts <-> expand.ts
 * import cycle (pareto.ts already imports from expand.ts).
 */

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

interface ParetoGroupInternal<T> {
  readonly vector: readonly number[]
  readonly origins: T[]
}

export interface ParetoGroup<T> {
  readonly vector: readonly number[]
  readonly origins: readonly T[]
}

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
 */
export class ParetoFrontier<T> {
  private readonly groups: ParetoGroupInternal<T>[] = []
  private readonly byVectorKey = new Map<string, ParetoGroupInternal<T>>()

  insert(vector: readonly number[], origin: T): void {
    const key = vector.join(',')
    const exact = this.byVectorKey.get(key)
    if (exact !== undefined) {
      exact.origins.push(origin)
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

  /** Every distinct non-dominated vector currently in the frontier, each
   * with every origin tied on it -- lets a caller fold further (e.g. the
   * decoration-filling DP in expand.ts) without paying for each tied origin
   * separately. */
  entries(): readonly ParetoGroup<T>[] {
    return this.groups
  }

  /** Every origin across every group, flattened back into one entry per
   * tied origin -- the shape every existing caller already expects. */
  toArray(): T[] {
    const flat: T[] = []
    for (const group of this.groups) flat.push(...group.origins)
    return flat
  }
}
