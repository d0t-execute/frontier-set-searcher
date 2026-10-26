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
 * `exclusionRow`): solve, forbid the gear set just found (which candidate
 * per slot, which cuffs -- results are distinct by gear set, each with its
 * own best decoration fill), re-solve, repeat
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
 * The time box can also run out before finding *any* usable incumbent at
 * all, which looks identical to genuine infeasibility from the caller's
 * perspective unless `search()`'s own generator return value (`SearchEndReason`)
 * is consulted -- confirmed to really happen against a real query
 * (docs/feedback.md Round 3 #4's 2026-10-25 investigation: the full
 * decoration pool found nothing at production's default time box, yet a
 * feasible build did exist, confirmed by widening it). `App.tsx` uses this
 * distinction to offer an opt-in "Search longer" retry only when it's
 * actually warranted, rather than silently showing "No matching builds
 * found" either way or (the rejected alternative) just raising the default
 * time box for every search, which would equally inflate the far more common
 * case of a query that's genuinely infeasible but slow for HiGHS to *prove*
 * infeasible.
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

import { pruneDominatedCandidates, pruneDominatedDecorations } from './candidate-pruning'
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
 * hit it at all (reaching proven-optimal well under it). Overridable via
 * `options.timeBoxSeconds` -- see that field's own docstring for why
 * (2026-10-20: raising this module default to accommodate one CI machine's
 * slower hardware turned out to cost every *other* caller too, including
 * `engine.property.test.ts`'s many small synthetic solves, which blew past
 * its own test timeout once every round got a bigger budget). */
const TIME_BOX_SECONDS = 30

/** If a round's first time box expires with no feasible incumbent at all --
 * observed to happen occasionally, not just hypothetically, when the box is
 * too tight for a given query -- one retry at double the budget meaningfully
 * reduces the chance of stopping early on a query that was merely unlucky in
 * which part of the search tree got explored first, while still keeping the
 * worst realistic case (90s) far inside "not half an hour." Overridable via
 * `options.maxTimeBoxAttempts`, same reasoning as `TIME_BOX_SECONDS`. */
const MAX_TIME_BOX_ATTEMPTS = 2

/** `runTimeBoxed`'s outcome for one round -- distinguishes *why* no solution
 * came back, not just whether one did. `'infeasible'` means HiGHS proved no
 * combination exists at all (more time would never help); `'timedOut'` means
 * every attempt was interrupted before HiGHS could do that (a feasible build
 * might still exist, just not found/proven in the time given). `search()`
 * surfaces this distinction through its own generator return value (see
 * `SearchEndReason`) so a caller can decide whether offering "search longer"
 * even makes sense (2026-10-25, see docs/feedback.md Round 3 #4's
 * investigation: a real query was confirmed to hit exactly this case -- the
 * full decoration pool found nothing at production's default time box, but a
 * feasible build did exist, confirmed by widening the box).
 *
 * `'found'` means the live `native` model's current solution is the one to
 * decode and yield. */
type TimeBoxOutcome = 'found' | 'infeasible' | 'timedOut'

/** HiGHS's stopping tolerance on "how far the best-found build may be from the
 * best possible one" (2026-10-26, docs/search-performance-research.md
 * approach 4). HiGHS's own default is a *relative* gap of 1e-4, which is not
 * "optimal" for this objective's scale: with objectives around 10^5 it lets a
 * round stop a few bonus points short (observed directly: stopped at 100183
 * against a proven bound of 100192), and once a preferred piece is in play
 * (`PREFERRED_ITEM_WEIGHT`, ~10^9) it's ~10^5 -- ten open slots' worth. Every
 * objective coefficient `ilp-model.ts` emits is an integer and every column
 * is integer-typed, so the objective of any build is an integer: an absolute
 * gap just under 1 is exactly "no better build exists," with no relative
 * slack at all. Measured cost on the real benchmark queries: none to ~5%. */
const MIP_REL_GAP = 0
const MIP_ABS_GAP = 0.99

function runTimeBoxed(
  native: SymbolDisposable<Model>,
  highs: Highs,
  options: SearchOptions,
  onProgress?: (gap: number) => void,
): TimeBoxOutcome {
  let seconds = options.timeBoxSeconds ?? TIME_BOX_SECONDS
  const maxAttempts = options.maxTimeBoxAttempts ?? MAX_TIME_BOX_ATTEMPTS

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = native.run({
      [highs.constants.callbackType.mipInterrupt](event) {
        if ((event.data.running_time ?? 0) >= seconds) event.interrupt()
      },
      // `mip_gap` is HiGHS's own "how far is the best-found solution from the
      // proven-optimal bound" fraction -- the only genuine mid-solve progress
      // signal available (see docs/feedback.md Round 3 #3). It isn't
      // monotonic early on (can swing before the first incumbent is found),
      // so this is reported as-is rather than smoothed; the UI only shows it
      // once it's usefully close to done.
      ...(onProgress && {
        [highs.constants.callbackType.mipLogging](event) {
          if (typeof event.data.mip_gap === 'number') onProgress(event.data.mip_gap)
        },
      }),
    })
    const modelStatus: ModelStatusCode = result.modelStatus
    const primalSolutionStatus = native.info.get('primal_solution_status') as number
    if (isUsableResult(highs, modelStatus, primalSolutionStatus)) return 'found'
    if (modelStatus !== highs.constants.modelStatus.interrupted) return 'infeasible'
    seconds *= 2
  }
  return 'timedOut'
}

/** Bounds every `preferExactMatches` tier indicator (`AuxiliaryColumn.
 * tierIndicator`) to `[0, upper]` on the live model: `0` turns "a bonus
 * skill's tier is active" from a penalty into a hard "never" (strict mode's
 * clean phase), `1` turns it back into a penalty. */
function boundTierIndicators(
  native: SymbolDisposable<Model>,
  indicatorIndices: readonly number[],
  upper: 0 | 1,
): void {
  for (const j of indicatorIndices) native.changeColBounds(j, 0, upper)
}

/** Why a `search()` generator stopped producing results, returned as the
 * generator's own return value (distinct from its yielded `BuildResult`s --
 * see `AsyncGenerator<BuildResult, SearchEndReason>` below). `'exhausted'`
 * covers both the trivial empty-slots case and HiGHS proving no combination
 * exists: more time would never produce another result. `'timedOut'` means a
 * round gave up only because `runTimeBoxed` ran out of attempts, never
 * reaching a proof either way -- a caller who wants a "search longer" retry
 * (docs/feedback.md Round 3 #4) should only offer it for this reason, never
 * for `'exhausted'`. */
export type SearchEndReason = 'exhausted' | 'timedOut'

/** In-process observers for `search()` -- not part of `SearchOptions`, since
 * that type crosses the worker's `postMessage` boundary (structured clone, so
 * no functions survive it); only ever supplied locally by `worker-handler.ts`. */
export interface SearchHooks {
  /** HiGHS's `mip_gap` for the round in progress (docs/feedback.md Round 3 #3). */
  readonly onProgress?: (gap: number) => void
  /** The objective value of the result about to be yielded -- its true score,
   * comparable across differently-pruned searches of the same query (see
   * `ilp-model.ts`'s objective `offset`). */
  readonly onSolution?: (objective: number) => void
}

export async function* search(
  slots: readonly SlotQuery[],
  requirements: readonly SkillRequirement[],
  decorations: readonly Decoration[] = [],
  options: SearchOptions = {},
  cuffs: readonly Cuff[] = [],
  hooks: SearchHooks = {},
): AsyncGenerator<BuildResult, SearchEndReason> {
  const { onProgress, onSolution } = hooks
  if (slots.length === 0) {
    // Nothing to choose, so nothing to solve for -- but an empty build still
    // only counts as a result if every requirement is trivially already met
    // (only possible when every requirement's minPoints is 0 or less),
    // matching the old engine's behavior for this edge case.
    const pinnedCuffs = options.pinnedCuffs ?? []
    const skillTotals = new Map<SkillId, number>()
    for (const c of pinnedCuffs) {
      for (const { skillId, points } of c.skills) {
        skillTotals.set(skillId, (skillTotals.get(skillId) ?? 0) + points)
      }
    }
    const meetsAll = requirements.every((r) => (skillTotals.get(r.skillId) ?? 0) >= r.minPoints)
    if (meetsAll) {
      yield { picks: new Map(), decorations: new Map(), cuffs: [...pinnedCuffs], skillTotals }
    }
    return 'exhausted'
  }

  // A pinned slot decoration (`options.pinnedSlotDecorations`, see TODO #12)
  // must always reach `buildModel` regardless of `filterRelevantDecorations`
  // -- the player can pin one purely for its own sake (e.g. a skill they
  // never added as a requirement), not just when it happens to help meet
  // one. `Map` dedupes by id, so a decoration that's both naturally relevant
  // and pinned isn't given two different objects.
  const relevantDecorationsById = new Map(
    filterRelevantDecorations(decorations, requirements).map((d) => [d.id, d]),
  )
  for (const list of options.pinnedSlotDecorations?.values() ?? []) {
    for (const d of list) relevantDecorationsById.set(d.id, d)
  }
  const relevantDecorations = pruneDominatedDecorations(
    [...relevantDecorationsById.values()],
    requirements,
    options,
  )
  const relevantCuffs = filterRelevantCuffs(cuffs, requirements, options.pinnedCuffSkillIds ?? [])
  const maxResults = options.maxResults ?? Infinity
  const modelSlots =
    options.provisionalPoolSize !== undefined
      ? // Prunes as if bonus skills didn't matter at all -- heuristic under
        // `preferExactMatches`, which is exactly why results from this pool
        // are only ever provisional (see `SearchOptions.provisionalPoolSize`).
        pruneDominatedCandidates(
          slots,
          requirements,
          { ...options, skillTiers: undefined },
          options.provisionalPoolSize,
        )
      : options.maxResults !== undefined
        ? pruneDominatedCandidates(slots, requirements, options, options.maxResults)
        : slots
  const highs = await getHighs()
  const { model, columns } = buildModel(
    highs,
    modelSlots,
    relevantDecorations,
    requirements,
    options,
    relevantCuffs,
  )
  const native = highs.createModel(model)
  native.options.set('mip_rel_gap', MIP_REL_GAP)
  native.options.set('mip_abs_gap', MIP_ABS_GAP)
  const pinnedCuffs = options.pinnedCuffs ?? []

  // Strict mode (`preferExactMatches` with tier data): clean builds -- no
  // bonus skill tier active -- always rank ahead of any build with one, and
  // only once no clean build is left (or none can be found in time) do the
  // rest follow, ranked by the usual penalty. Modeled directly as two phases
  // on one live model: the clean phase bounds every tier indicator to 0,
  // making "clean" a hard constraint the solver can reason about (2026-10-26,
  // docs/search-performance-research.md section 7: one solve instead of the
  // old find-it, cut-it-if-unclean, re-solve loop, which could run hundreds
  // of rounds and gave up at 300s on a real query); the penalty phase lifts
  // the bounds back to 1. Cuts added during the clean phase stay in place, so
  // the penalty phase never repeats a build.
  const tierIndicatorIndices = columns.flatMap((c, j) =>
    c.kind === 'auxiliary' && c.tierIndicator ? [j] : [],
  )
  let cleanPhase = tierIndicatorIndices.length > 0
  if (cleanPhase) boundTierIndicators(native, tierIndicatorIndices, 0)

  try {
    for (let yielded = 0; yielded < maxResults; yielded++) {
      let outcome = runTimeBoxed(native, highs, options, onProgress)
      if (outcome !== 'found' && cleanPhase) {
        cleanPhase = false
        boundTierIndicators(native, tierIndicatorIndices, 1)
        outcome = runTimeBoxed(native, highs, options, onProgress)
      }
      if (outcome !== 'found') return outcome === 'timedOut' ? 'timedOut' : 'exhausted'

      const colValue = native.getSolution().colValue
      const decoded = decodeSolution(columns, colValue)
      onSolution?.(native.info.get('objective_function_value') as number)
      if (pinnedCuffs.length === 0) {
        yield decoded
      } else {
        const skillTotals = new Map(decoded.skillTotals)
        for (const c of pinnedCuffs) {
          for (const { skillId, points } of c.skills) {
            skillTotals.set(skillId, (skillTotals.get(skillId) ?? 0) + points)
          }
        }
        yield { ...decoded, cuffs: [...pinnedCuffs, ...decoded.cuffs], skillTotals }
      }

      const cut = exclusionRow(highs, columns, colValue)
      native.addRow(cut.lower, cut.upper, { indices: cut.indices, values: cut.values })
    }
    return 'exhausted'
  } finally {
    native.dispose()
  }
}
