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
