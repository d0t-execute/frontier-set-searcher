/**
 * The build search engine (see docs/PLAN.md §6). Formulates the entire query
 * -- every slot's candidates, every relevant decoration, every simultaneous
 * skill requirement -- as a single mixed-integer program (`ilp-model.ts`) and
 * hands it to HiGHS, rather than combining per-slot Pareto frontiers.
 *
 * This replaces an earlier meet-in-the-middle Pareto-dominance engine
 * (pareto.ts/dominance.ts/expand.ts/lazy-list.ts/max-heap.ts). That approach
 * combined slots by tracking the non-dominated frontier of achievable skill
 * vectors, pruning any combination no better than another on every requested
 * skill -- correct, and fast for a handful of simultaneous requirements, but
 * it suffers the "curse of dimensionality" once many skills are requested at
 * once: with enough independent dimensions, almost nothing dominates
 * anything else, so the frontier stops collapsing and grows toward the full
 * candidate pool instead. Confirmed against a real ~17-simultaneous-skill
 * end-game query: a single decoration-filling sub-problem alone grew from
 * 294 entries at one open-slot capacity to 32,093 at the next, and the
 * search never completed. A MIP solver doesn't build any such frontier --
 * branch-and-cut prunes the search *tree*, not a materialized set of partial
 * results, so it doesn't share this failure mode. Validated directly against
 * the real dataset and the real query that exposed the old engine's hang
 * (see `engine.real-data.performance.test.ts`): a single solve consistently
 * finds a proven-optimal build in seconds, not minutes.
 *
 * There's no open-source MIP solver with a built-in "solution pool" (that's
 * a commercial-solver-only feature) -- getting more than one ranked result
 * uses the standard "no-good cut" technique instead (`ilp-model.ts`'s
 * `exclusionRow`): solve, forbid the exact combination just found (which
 * candidate per slot, and how many of which decoration), re-solve, repeat
 * until the model becomes infeasible (no combination left) or the caller
 * stops pulling results. Each round reuses the same persistent HiGHS model
 * (`addRow` rather than rebuilding from scratch), so repeated solves stay
 * close to the first solve's cost instead of compounding.
 *
 * Each round is also time-boxed (`TIME_BOX_SECONDS`, via HiGHS's
 * `mipInterrupt` callback): proving a solution is the single best-ranked one
 * can occasionally take far longer than finding *a* fully valid one at all --
 * confirmed against a real, user-supplied ~16-simultaneous-skill query (many
 * niche, barely-satisfiable skills at once) that hadn't reached a proven
 * optimum after 20+ minutes on some rounds. Since every skill requirement is
 * a hard constraint on the model, not part of the objective, any feasible
 * incumbent the solver has found by the time its box runs out already
 * satisfies every one of them exactly (`ilp-model.ts`'s `isUsableResult`) --
 * interrupting early only risks a worse-ranked (more decoration slots used,
 * or fewer bonus points) result than the true optimum, never an invalid one.
 *
 * `options.preferExactMatches` (see `types.ts`'s `SearchOptions`) only
 * changes that ranking, not which builds are valid: it asks `buildModel` to
 * penalize unrequested skill points instead of rewarding them, for a user
 * who'd rather get a build that introduces as few skills they didn't ask for
 * as possible, instead of one that happens to pile on the most of them.
 *
 * `cuffs` is a wholly separate equipment pool from `decorations` -- see
 * `ilp-model.ts`'s own docstring for how the "at most 2 equipped, combined
 * slot-cost budget" rule is modeled -- filtered down to relevant ones the
 * same way `decorations` is, for the same reason (the real cuff catalog is
 * large enough that an unfiltered one would bloat the model for no benefit).
 */

import { filterRelevantCuffs, filterRelevantDecorations } from './expand'
import { getHighs } from './highs-runtime'
import { buildModel, decodeSolution, exclusionRow, isUsableResult } from './ilp-model'
import type {
  BuildResult,
  Cuff,
  Decoration,
  SearchOptions,
  SkillId,
  SkillRequirement,
  SlotQuery,
} from './types'
import type { Highs, Model, ModelStatusCode, SymbolDisposable } from 'highs'

/** Seconds a single round may search before settling for its best feasible
 * incumbent instead of continuing to look for a proven-optimal one (see this
 * module's own docstring). Chosen from direct measurement: reliably produced
 * a fully valid build within this budget, every round, against the real
 * hard query that motivated this -- generous enough that most queries never
 * hit it at all (reaching proven-optimal well under it). */
const TIME_BOX_SECONDS = 30

/** If a round's first time box expires with no feasible incumbent at all --
 * observed to happen occasionally, not just hypothetically, when the box is
 * too tight for a given query -- one retry at double the budget meaningfully
 * reduces the chance of stopping early on a query that was merely unlucky in
 * which part of the search tree got explored first, while still keeping the
 * worst realistic case (90s) far inside "not half an hour." */
const MAX_TIME_BOX_ATTEMPTS = 2

function runTimeBoxed(native: SymbolDisposable<Model>, highs: Highs): boolean {
  let seconds = TIME_BOX_SECONDS
  for (let attempt = 1; attempt <= MAX_TIME_BOX_ATTEMPTS; attempt++) {
    const result = native.run({
      [highs.constants.callbackType.mipInterrupt](event) {
        if ((event.data.running_time ?? 0) >= seconds) event.interrupt()
      },
    })
    const modelStatus: ModelStatusCode = result.modelStatus
    const primalSolutionStatus = native.info.get('primal_solution_status') as number
    if (isUsableResult(highs, modelStatus, primalSolutionStatus)) return true
    if (modelStatus !== highs.constants.modelStatus.interrupted) return false // genuinely infeasible, not just out of time
    seconds *= 2
  }
  return false
}

export async function* search(
  slots: readonly SlotQuery[],
  requirements: readonly SkillRequirement[],
  decorations: readonly Decoration[] = [],
  options: SearchOptions = {},
  cuffs: readonly Cuff[] = [],
): AsyncGenerator<BuildResult> {
  if (slots.length === 0) {
    // Nothing to choose, so nothing to solve for -- but an empty build still
    // only counts as a result if every requirement is trivially already met
    // (only possible when every requirement's minPoints is 0 or less),
    // matching the old engine's behavior for this edge case.
    const skillTotals = new Map<SkillId, number>()
    const meetsAll = requirements.every((r) => (skillTotals.get(r.skillId) ?? 0) >= r.minPoints)
    if (meetsAll) {
      yield { picks: new Map(), decorations: new Map(), cuffs: [], skillTotals }
    }
    return
  }

  const relevantDecorations = filterRelevantDecorations(decorations, requirements)
  const relevantCuffs = filterRelevantCuffs(cuffs, requirements)
  const highs = await getHighs()
  const { model, columns } = buildModel(
    highs,
    slots,
    relevantDecorations,
    requirements,
    options,
    relevantCuffs,
  )
  const native = highs.createModel(model)

  try {
    for (;;) {
      if (!runTimeBoxed(native, highs)) return

      const solution = native.getSolution()
      yield decodeSolution(columns, solution.colValue)

      const cut = exclusionRow(highs, columns, solution.colValue)
      native.addRow(cut.lower, cut.upper, { indices: cut.indices, values: cut.values })
    }
  } finally {
    native.dispose()
  }
}
