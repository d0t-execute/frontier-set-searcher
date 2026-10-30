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

import { disabledRequirementSkillIds } from './active-skill-cap'
import { pruneDominatedCandidates, pruneDominatedDecorations } from './candidate-pruning'
import { filterRelevantCuffs, filterRelevantDecorations } from './expand'
import { getHighs } from './highs-runtime'
import { buildModel, decodeSolution, exclusionRow, isUsableResult } from './ilp-model'
import type { ColumnMeta } from './ilp-model'
import type {
  BuildResult,
  Cuff,
  ExcludedGearSet,
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

function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b]
  return a
}

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

/** The choice-column values a solution picking `gearSet` would have, for
 * building its no-good cut with `exclusionRow` -- or `undefined` when this
 * model can't produce that gear set at all (one of its pieces or cuffs isn't
 * a column here, e.g. filtered out), in which case there's nothing to
 * exclude. A partial cut would be wrong, not just weaker: it would forbid
 * every build sharing the pieces that *are* here. Pinned cuffs aren't
 * columns (see `ilp-model.ts`), so they're subtracted before matching. */
function gearSetColumnValues(
  columns: readonly ColumnMeta[],
  gearSet: ExcludedGearSet,
  pinnedCuffs: readonly Cuff[],
): Float64Array | undefined {
  const freeCuffCounts = new Map<string, number>()
  for (const id of gearSet.cuffIds) freeCuffCounts.set(id, (freeCuffCounts.get(id) ?? 0) + 1)
  for (const { id } of pinnedCuffs) {
    const count = freeCuffCounts.get(id) ?? 0
    if (count <= 1) freeCuffCounts.delete(id)
    else freeCuffCounts.set(id, count - 1)
  }

  const values = new Float64Array(columns.length)
  const slotsMatched = new Set<string>()
  const cuffsMatched = new Set<string>()
  columns.forEach((column, j) => {
    if (column.kind === 'candidate') {
      if (gearSet.candidateIdBySlot.get(column.slotId) === column.candidate.id) {
        values[j] = 1
        slotsMatched.add(column.slotId)
      }
    } else if (column.kind === 'cuff') {
      if ((freeCuffCounts.get(column.cuff.id) ?? 0) === column.count) {
        values[j] = 1
        if (column.count > 0) cuffsMatched.add(column.cuff.id)
      }
    }
  })
  const complete =
    slotsMatched.size === gearSet.candidateIdBySlot.size &&
    cuffsMatched.size === freeCuffCounts.size
  return complete ? values : undefined
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
   * `ilp-model.ts`'s objective `offset`) -- and whether HiGHS proved it the
   * best of what's left, rather than stopping at the time box with the best
   * build found so far (valid, but possibly not the best). */
  readonly onSolution?: (objective: number, proven: boolean) => void
}

/** The best score any build of this query reaches without its bonus-point /
 * bonus-tier part, proven -- or `undefined` if the solve couldn't prove it in
 * its time box. Solved as the bonus-free ceiling `worker-handler.ts` uses
 * (`withoutTierPenalties`, and `preferExactMatches` so no bonus points are
 * scored either), whose model is single-stage and prunes soundly down to one
 * result. Upper-bounds every build regardless of cuts, so it's only ever
 * used for a first round (see `search`'s lexicographic solve). */
async function provenPrimaryBound(
  slots: readonly SlotQuery[],
  requirements: readonly SkillRequirement[],
  decorations: readonly Decoration[],
  options: SearchOptions,
  cuffs: readonly Cuff[],
): Promise<number | undefined> {
  let objective: number | undefined
  let proven = false
  const generator = search(
    slots,
    requirements,
    decorations,
    {
      ...options,
      preferExactMatches: true,
      withoutTierPenalties: true,
      maxResults: 1,
      provisionalPoolSize: undefined,
    },
    cuffs,
    {
      onSolution: (value, isProven) => {
        objective = value
        proven = isProven
      },
    },
  )
  const first = await generator.next()
  await generator.return('exhausted')
  return !first.done && proven ? objective : undefined
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
  // Skill Slots Up raises the active-skill cap, so its cuffs stay relevant
  // even when nobody asked for it -- they may be what makes room for the
  // requirements (see `SearchOptions.activeSkillCap`).
  const capSkillSlotsUpId = options.activeSkillCap?.skillSlotsUpId
  const relevantCuffs = filterRelevantCuffs(cuffs, requirements, [
    ...(options.pinnedCuffSkillIds ?? []),
    ...(capSkillSlotsUpId !== undefined ? [capSkillSlotsUpId] : []),
  ])
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
  const { model, columns, primaryCost } = buildModel(
    highs,
    modelSlots,
    relevantDecorations,
    requirements,
    options,
    relevantCuffs,
  )
  const fullCost = Float64Array.from(model.colCost)
  // Not for `provisionalPoolSize`'s small heuristic pool: there it measured
  // slower than one stage (a real 17-skill query's first build: 66s against
  // 8s), and that pass never needs a proof anyway.
  const twoStage =
    options.provisionalPoolSize === undefined && primaryCost.some((cost, j) => cost !== fullCost[j])
  const primaryBound =
    options.primaryObjectiveBound ??
    (twoStage
      ? await provenPrimaryBound(slots, requirements, decorations, options, cuffs)
      : undefined)

  const native = highs.createModel(model)
  native.options.set('mip_rel_gap', MIP_REL_GAP)
  native.options.set('mip_abs_gap', MIP_ABS_GAP)
  const pinnedCuffs = options.pinnedCuffs ?? []

  // Lexicographic solve (2026-10-30, docs/search-performance-research.md
  // approach 5). The objective is lexicographic by construction: its primary
  // part (open slots, preferences -- `BuiltModel.primaryCost`) always
  // outweighs its bonus-point / bonus-tier part. Solved as one objective, the
  // solver can prove the primary part's best value quickly on its own, yet
  // can't stop crediting a build with most of an extra open slot once the
  // small terms are mixed in -- a real 15-skill query stayed unproven at a
  // bound of ~0.8 open slots for 60s+, while proving "0 open slots is the
  // maximum" took ~1.5s when asked alone. So each round pins the primary
  // part to its best value (`primaryRow`, both bounds) and solves the full
  // objective under that pin, which proved the same query in ~2s.
  //
  // The best value only needs computing (stage 1, primary costs only) when it
  // isn't already known: results come out in non-increasing order, so the
  // previous result's primary value is still a valid upper bound for the
  // next round. For the first, `primaryBound` is the proven bonus-free
  // ceiling: `options.primaryObjectiveBound` when `worker-handler.ts` already
  // computed it, otherwise `provenPrimaryBound` solves it on a pruned model
  // -- much cheaper than stage 1 on this one, which may be unpruned (exact
  // mode, or no `maxResults`): the real 17-skill sword query's exact-mode
  // test took 57.9s with stage 1 here, 35.5s with this. A pin above what's still reachable -- every build
  // at that value already returned -- makes the round infeasible, which only
  // then triggers stage 1. A model with no bonus/penalty terms at all has
  // nothing to separate and is solved in one stage as before.
  const allColumns = { kind: 'range' as const, from: 0, to: columns.length - 1 }
  const primaryIndices = primaryCost.flatMap((cost, j) => (cost !== 0 ? [j] : []))
  const primaryRow = model.numRows
  if (twoStage) {
    native.addRow(-highs.infinity, highs.infinity, {
      indices: primaryIndices,
      values: primaryIndices.map((j) => primaryCost[j]),
    })
  }
  // Every primary cost is an integer multiple of this, so stage 1 can stop as
  // soon as its gap is below one unit -- no better primary value exists.
  const primaryUnit = primaryIndices.reduce((g, j) => gcd(g, Math.abs(primaryCost[j])), 0)
  const primaryAbsGap = primaryUnit > 1 ? primaryUnit * MIP_ABS_GAP : MIP_ABS_GAP
  const ceilingCap = primaryBound !== undefined ? primaryBound - (model.offset ?? 0) : undefined
  let primaryCap = ceilingCap

  function solvePinned(cap: number): TimeBoxOutcome {
    native.changeRowBounds(primaryRow, cap - 0.5, cap + 0.5)
    return runTimeBoxed(native, highs, options, onProgress)
  }

  function solveRound(): TimeBoxOutcome {
    if (!twoStage) return runTimeBoxed(native, highs, options, onProgress)
    if (primaryCap !== undefined) {
      const pinned = solvePinned(primaryCap)
      if (pinned !== 'infeasible') return pinned
    }

    native.changeRowBounds(primaryRow, -highs.infinity, highs.infinity)
    native.changeColsCost(allColumns, Float64Array.from(primaryCost))
    native.options.set('mip_abs_gap', primaryAbsGap)
    const stage1 = runTimeBoxed(native, highs, options, onProgress)
    const stage1Proven = native.getModelStatus() === highs.constants.modelStatus.optimal
    const stage1Values = stage1 === 'found' ? native.getSolution().colValue : undefined
    native.changeColsCost(allColumns, fullCost)
    native.options.set('mip_abs_gap', MIP_ABS_GAP)
    if (stage1 === 'infeasible') return 'infeasible'

    if (stage1Values === undefined || !stage1Proven) {
      // No proven best value to pin -- solve the full objective in one stage.
      primaryCap = undefined
      return runTimeBoxed(native, highs, options, onProgress)
    }
    let best = 0
    for (const j of primaryIndices) best += primaryCost[j] * stage1Values[j]
    primaryCap = primaryUnit > 1 ? Math.round(best / primaryUnit) * primaryUnit : Math.round(best)
    return solvePinned(primaryCap)
  }

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

  for (const gearSet of options.excludedGearSets ?? []) {
    const colValue = gearSetColumnValues(columns, gearSet, options.pinnedCuffs ?? [])
    if (!colValue) continue
    const cut = exclusionRow(highs, columns, colValue)
    native.addRow(cut.lower, cut.upper, { indices: cut.indices, values: cut.values })
  }

  try {
    for (let yielded = 0; yielded < maxResults;) {
      let outcome = solveRound()
      if (outcome !== 'found' && cleanPhase) {
        cleanPhase = false
        boundTierIndicators(native, tierIndicatorIndices, 1)
        // The clean phase's primary values don't bound the penalty phase's
        // larger pool of builds; only the ceiling (over every build) does.
        primaryCap = ceilingCap
        outcome = solveRound()
      }
      if (outcome !== 'found') return outcome === 'timedOut' ? 'timedOut' : 'exhausted'

      const colValue = native.getSolution().colValue
      const decoded = decodeSolution(columns, colValue)
      let result: BuildResult = decoded
      if (pinnedCuffs.length > 0) {
        const skillTotals = new Map(decoded.skillTotals)
        for (const c of pinnedCuffs) {
          for (const { skillId, points } of c.skills) {
            skillTotals.set(skillId, (skillTotals.get(skillId) ?? 0) + points)
          }
        }
        result = { ...decoded, cuffs: [...pinnedCuffs, ...decoded.cuffs], skillTotals }
      }
      const cut = exclusionRow(highs, columns, colValue)

      // A build whose active-skill cap force-disables one of the requested
      // skills isn't a valid result (`SearchOptions.activeSkillCap`). The
      // model's own cap row already rules these out; this exact check is a
      // safety net for anything the row approximates (e.g. tied unranked
      // skills). A failing build is cut like any other, not yielded.
      const capRules = options.activeSkillCap
      const capDisablesRequirement =
        capRules !== undefined &&
        disabledRequirementSkillIds(
          result.picks,
          result.skillTotals,
          result.cuffs,
          requirements,
          capRules,
        ).length > 0
      if (!capDisablesRequirement) {
        onSolution?.(
          native.info.get('objective_function_value') as number,
          native.getModelStatus() === highs.constants.modelStatus.optimal,
        )
        yield result
        yielded++
      }

      native.addRow(cut.lower, cut.upper, { indices: cut.indices, values: cut.values })
    }
    return 'exhausted'
  } finally {
    native.dispose()
  }
}
