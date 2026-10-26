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

import { filterRelevantCuffs, filterRelevantDecorations } from './expand'
import { getHighs } from './highs-runtime'
import { breakpointsFromThresholds, buildModel, decodeSolution, exclusionRow, isUsableResult } from './ilp-model'
import type { BuildResultLike, ColumnMeta } from './ilp-model'
import type {
  BuildResult,
  Cuff,
  Decoration,
  SearchOptions,
  SkillId,
  SkillRequirement,
  SkillTierThresholds,
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
 * `'found'` always means the live `native` model's current solution is the
 * one to decode and yield -- except when `fallback` (below) is set, in which
 * case `fallback` itself *is* the result, decoded from a since-excluded
 * incumbent the live model can no longer reproduce. */
type TimeBoxOutcome = 'found' | 'infeasible' | 'timedOut'

/**
 * A usable-but-not-verified-clean incumbent `runTimeBoxed`'s strict mode
 * found and excluded (via `exclusionRow`) while searching for a better one,
 * kept around in case time runs out before a clean one (or any better one)
 * is ever found (2026-10-26, the "20-query sweep" follow-up to #2/#4 --
 * confirmed directly: several real queries that used to return a build with
 * a bonus skill active in ~20-35s, pre-#2/#4, instead returned *nothing at
 * all* post-#2/#4, timing out around 90-110s once that incumbent got
 * excluded and no cleaner one was ever found in time). Falling back to it
 * restores "always answer if any valid build exists," the same guarantee the
 * non-strict path and the pre-#2/#4 code both already had, without giving up
 * #2/#4's own preference for a clean result when one is reachable in time --
 * `fallback` is only ever used as an absolute last resort, never instead of a
 * clean result that was actually found.
 *
 * Carries the raw `colValue` snapshot alongside the decoded result (not just
 * `BuildResultLike`) because `exclusionRow` needs the raw per-column values
 * to build a cut, and the live model has already moved past this exact
 * combination by the time it's used -- `search()`'s own next-round cut must
 * be built from this snapshot, not from `native.getSolution()`. Copied
 * (`Float64Array.from`) rather than referenced, since the same buffer is
 * reused by the native binding on every subsequent `native.run()` call.
 */
interface StrictFallback {
  readonly decoded: BuildResultLike
  readonly colValue: Float64Array
}

/** HiGHS's own fraction of configured B&B effort spent on primal heuristics
 * (default 0.05) -- raised only when `preferExactMatches` needs tier
 * machinery (see `runTimeBoxed`'s `strict` flag), since that's the specific
 * case observed (2026-10-25/26, the "Three Worlds" investigation) to need
 * more heuristic search to find a *better* incumbent, not just any feasible
 * one, within the same time box. Left at HiGHS's own default everywhere else
 * to avoid slowing down the common (non-`preferExactMatches`, or
 * `preferExactMatches` without a hard case) path for no benefit. */
const PREFER_EXACT_MATCHES_HEURISTIC_EFFORT = 0.3

/** Whether `skillTotals` still has a bonus (non-requested, non-optional)
 * skill active -- the same pos/neg tier check `ilp-model.ts`'s own tier
 * machinery is built to penalize, used here to decide whether an
 * interrupted-but-feasible incumbent is actually good enough to accept under
 * `preferExactMatches`, rather than a plausible-looking but merely-not-yet-
 * improved one (see `runTimeBoxed`'s `strict` mode, 2026-10-26). */
function hasActiveBonusSkill(
  skillTotals: ReadonlyMap<SkillId, number>,
  skillTiers: readonly SkillTierThresholds[],
  skillPreferenceIds: ReadonlySet<SkillId>,
): boolean {
  for (const { skillId, tierThresholds } of skillTiers) {
    if (skillPreferenceIds.has(skillId)) continue
    const { posThreshold, negThreshold } = breakpointsFromThresholds(tierThresholds)
    const total = skillTotals.get(skillId) ?? 0
    if (posThreshold !== undefined && total >= posThreshold) return true
    if (negThreshold !== undefined && total <= negThreshold) return true
  }
  return false
}

function runTimeBoxed(
  native: SymbolDisposable<Model>,
  highs: Highs,
  columns: readonly ColumnMeta[],
  requirements: readonly SkillRequirement[],
  options: SearchOptions,
  onProgress?: (gap: number) => void,
): { outcome: TimeBoxOutcome; fallback?: StrictFallback } {
  let seconds = options.timeBoxSeconds ?? TIME_BOX_SECONDS
  const maxAttempts = options.maxTimeBoxAttempts ?? MAX_TIME_BOX_ATTEMPTS

  // "Strict" mode (2026-10-26, docs/feedback.md Round 3 #4's follow-up "Three
  // Worlds" investigation): under `preferExactMatches`, an interrupted
  // incumbent that still has a bonus skill active is not actually what the
  // player asked for, even though `isUsableResult` alone would accept it (the
  // model's hard constraints are satisfied either way). Rather than silently
  // yield that plausible-looking-but-not-exact result, keep cutting it out
  // and re-solving within the *same* shared deadline until either a clean
  // incumbent is found or genuinely no time is left -- converting "wrong
  // result" into the already-designed-for `'timedOut'` (offer "Search
  // longer") rather than a confusing "I asked for exact matches and got extra
  // skills anyway." Only engaged when there's tier data to check against --
  // otherwise identical to the original single-solve-per-attempt behavior.
  const strict = Boolean(options.preferExactMatches && options.skillTiers)
  if (strict) native.options.set('mip_heuristic_effort', PREFER_EXACT_MATCHES_HEURISTIC_EFFORT)
  const skillPreferenceIds = strict
    ? new Set<SkillId>([
        ...requirements.map((r) => r.skillId),
        ...(options.optionalSkillRequirements ?? []).map((r) => r.skillId),
      ])
    : undefined

  let fallback: StrictFallback | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Shared across every cut-and-retry sub-solve within this attempt in
    // strict mode, so adding a cut never grants a fresh full budget -- only
    // the original per-attempt allowance, same as the non-strict path's
    // single `native.run()` call.
    const deadline = performance.now() + seconds * 1000
    for (;;) {
      const result = native.run({
        [highs.constants.callbackType.mipInterrupt](event) {
          const outOfTime = strict
            ? performance.now() >= deadline
            : (event.data.running_time ?? 0) >= seconds
          if (outOfTime) event.interrupt()
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
      if (!isUsableResult(highs, modelStatus, primalSolutionStatus)) {
        if (modelStatus !== highs.constants.modelStatus.interrupted) {
          // Proven infeasible, not just out of time -- but in strict mode this
          // can happen purely because our *own* cut-and-retry loop excluded
          // every remaining combination while searching for a cleaner one,
          // not because the query itself has no valid build at all. If we'd
          // already found at least one usable (if imperfect) incumbent before
          // that happened, prefer returning it over incorrectly reporting the
          // whole query as infeasible.
          return fallback ? { outcome: 'found', fallback } : { outcome: 'infeasible' }
        }
        break // out of attempts for this deadline, double the budget below
      }
      if (!strict) return { outcome: 'found' }

      const solution = native.getSolution()
      const decoded = decodeSolution(columns, solution.colValue)
      if (!hasActiveBonusSkill(decoded.skillTotals, options.skillTiers!, skillPreferenceIds!)) {
        return { outcome: 'found' }
      }
      // Not clean, but still a real, fully valid build -- remember it as a
      // last resort (see `StrictFallback`'s own docstring) before trying to
      // cut past it in search of something better.
      fallback = { decoded, colValue: Float64Array.from(solution.colValue) }
      if (performance.now() >= deadline) break

      const cut = exclusionRow(highs, columns, solution.colValue)
      native.addRow(cut.lower, cut.upper, { indices: cut.indices, values: cut.values })
    }
    seconds *= 2
  }
  return fallback ? { outcome: 'found', fallback } : { outcome: 'timedOut' }
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

export async function* search(
  slots: readonly SlotQuery[],
  requirements: readonly SkillRequirement[],
  decorations: readonly Decoration[] = [],
  options: SearchOptions = {},
  cuffs: readonly Cuff[] = [],
  // Not part of `SearchOptions`: that type crosses the worker's `postMessage`
  // boundary (structured-clone, so no functions survive it) -- this is only
  // ever supplied locally, in-process, by `worker-handler.ts`.
  onProgress?: (gap: number) => void,
): AsyncGenerator<BuildResult, SearchEndReason> {
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
  const relevantDecorations = [...relevantDecorationsById.values()]
  const relevantCuffs = filterRelevantCuffs(cuffs, requirements, options.pinnedCuffSkillIds ?? [])
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
  const pinnedCuffs = options.pinnedCuffs ?? []

  try {
    for (;;) {
      const { outcome, fallback } = runTimeBoxed(native, highs, columns, requirements, options, onProgress)
      if (outcome !== 'found') return outcome === 'timedOut' ? 'timedOut' : 'exhausted'

      // `fallback`'s combination has already been excluded from the live
      // model (strict mode cuts it before trying to improve on it) -- decode
      // and cut from the saved snapshot instead of `native.getSolution()`,
      // which no longer reflects it (see `StrictFallback`'s own docstring).
      const colValue = fallback ? fallback.colValue : native.getSolution().colValue
      const decoded = fallback ? fallback.decoded : decodeSolution(columns, colValue)
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
  } finally {
    native.dispose()
  }
}
