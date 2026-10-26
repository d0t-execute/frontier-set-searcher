/**
 * Builds and decodes the integer-program formulation the search engine hands
 * to HiGHS (see `engine.ts`'s module docstring for why this replaced the
 * Pareto-frontier approach). One call to `buildModel` encodes an entire
 * query -- every slot's candidates, every relevant decoration, every
 * simultaneous skill requirement -- as a single MIP, so the solver finds a
 * complete build directly instead of this engine combining partial frontiers
 * itself.
 *
 * Decorations are *pooled* across the whole build (2026-10-26,
 * docs/search-performance-research.md approach 3): one integer column per
 * relevant decoration counts how many copies the build uses in total, not
 * where each one goes. A decoration contributes the same skill points and
 * objective value in every slot, so the old per-slot encoding (one column
 * per slot, decoration, and count) handed the solver every equivalent
 * placement of the same build as a separate branch. On the hardest real
 * benchmark query that symmetry kept it from proving anything within 300s;
 * pooled, it proves optimality in ~26s. Placement stays exact through three
 * aggregate rows (`capacityRow`/`size2Row`/`size3Row`, see `buildModel`), and
 * `decodeSolution` recomputes a concrete per-slot placement afterwards.
 *
 * The pooled counts are general integers, not binary, so they're left out of
 * `exclusionRow`'s no-good cut (forbidding "z = 3" for an integer `z` needs
 * auxiliary variables and big-M rows per excluded value). The cut covers
 * armor and cuff choices only, which makes ranked results distinct by *gear
 * set* -- each with its own best decoration fill -- rather than by
 * decoration arrangement. The old arrangement-level distinctness mostly
 * produced duplicates (the same build with a decoration moved to another
 * slot), confirmed by the project owner as not wanted.
 *
 * Columns, in order: one binary "is this candidate chosen for this slot"
 * column per (slot, candidate) pair, then one integer "use this many copies"
 * column per relevant decoration that fits anywhere, then one fixed-count
 * column per pinned (slot, decoration) pair, then one binary "equip exactly
 * this many of this cuff" column per relevant cuff and count (one-hot by
 * count -- see `buildModel`'s own docstring), then (only when
 * `options.preferExactMatches` actually needs one -- see below) a handful of
 * non-choice accounting/indicator columns per bonus skill whose tier can be
 * reached at all. `columns` (in `buildModel`'s result) is a parallel array
 * recording what each column means, so a solution vector can be decoded back
 * into a `BuildResult` without the model itself carrying names; the
 * accounting/indicator columns carry no meaning a `BuildResult` needs, so
 * they're tagged `kind: 'auxiliary'` and skipped by both `decodeSolution` and
 * `exclusionRow`.
 *
 * Rows, in order: one cardinality row per slot (exactly one candidate
 * chosen), then the three pooled decoration-capacity rows (only when any
 * decoration could be placed at all), one
 * row per skill requirement (the summed contribution across every chosen
 * candidate and placed decoration must reach its minimum), one row per
 * requested resistance floor (`options.resistanceFloors`, docs/feedback.md
 * Round 1 #4 -- the summed contribution across every chosen *candidate only*
 * must reach its own minimum, since decorations/cuffs carry no resistance
 * data at all), then (same condition as the auxiliary columns above) a
 * handful of rows per bonus skill wiring its accounting column to the real
 * choice columns and to its tier-crossing indicator column(s), then one row
 * per `options.preferredCategoryCounts` entry wiring its own capped
 * accounting column to the real candidate columns matching its category (see
 * `buildModel`'s own docstring), then one cuff-group row per relevant cuff
 * plus three rows global to every cuff (combined slot-cost budget, item
 * count, and Hiden-cuff count -- see `buildModel`'s own docstring).
 */

import type { Highs, ModelData, ModelStatusCode, VariableType } from 'highs'
import { HIDEN_CUFF_CATEGORY } from './types'
import type {
  Candidate,
  Cuff,
  Decoration,
  OptionalSkillRequirement,
  ResistanceFloor,
  SearchOptions,
  SkillContribution,
  SkillId,
  SkillRequirement,
  SkillTierThresholds,
  SlotQuery,
} from './types'

/** How much one leftover (unused) decoration slot is worth in the objective,
 * relative to one point of a bonus skill nobody asked for -- mirrors the old
 * Pareto engine's `OPEN_SLOT_SCORE_WEIGHT` (confirmed project direction:
 * leaving decoration capacity open for the player's own choices matters far
 * more than incidental bonus points, large enough that no realistic bonus
 * total could ever outweigh a single open slot). Declared independently here
 * rather than imported, since the Pareto modules this constant used to live
 * in (dominance.ts) are dead code once this engine replaces them. */
export const OPEN_SLOT_WEIGHT = 10_000

/** How much one activated bonus-skill tier costs in the objective under
 * `options.preferExactMatches` (see `buildModel`) -- deliberately much
 * smaller than `OPEN_SLOT_WEIGHT` (an open slot always wins), but large
 * enough to dominate the raw per-point reward it replaces. A build can only
 * ever activate as many distinct bonus skills as the game has skills (on the
 * order of a couple hundred), so even a pathological build that somehow
 * activated every single one of them couldn't approach `OPEN_SLOT_WEIGHT`. */
export const EXACT_MATCH_SKILL_PENALTY = 1

/** How much using one preferred piece (`SearchOptions.preferredCandidateIds`,
 * docs/feedback.md Round 2 #2) is worth in the objective -- deliberately far
 * ABOVE `OPEN_SLOT_WEIGHT`, not below it (confirmed by the project owner,
 * 2026-10-19: "the preferred pieces should always win out over any other
 * valid result... an optimized result that uses 0 preferred pieces should be
 * omitted in favor of a worse result that still meets the query and has a
 * preferred piece"). This is meant to let a player optimize around gear they
 * already own, much like pinning -- but as a *pool* the solver draws from
 * freely rather than a fixed per-slot assignment, and one it's still allowed
 * to override when a requirement genuinely can't be reached without doing so
 * (never a hard constraint -- see `buildModel`'s own docstring on how this
 * differs from `options.pinnedCuffs`/a `PinnedSlot`).
 *
 * Chosen large enough that a build using one additional preferred piece
 * always outranks one that doesn't, regardless of every other factor this
 * objective weighs -- a build's *entire* realistic `OPEN_SLOT_WEIGHT`
 * contribution (bounded by a handful of armor slots times a piece's own
 * small open-slot count, nowhere near this constant's own order of
 * magnitude) could never make up the difference, the same "large enough that
 * a lower tier's whole realistic range can't approach it" reasoning
 * `OPEN_SLOT_WEIGHT` itself already uses against bonus skill points. Applied
 * additively per preferred piece actually used, so a build using *more* of
 * them always outranks one using fewer, not just "any vs. none" -- the
 * natural generalization of "optimize with my existing gear." Applied
 * unconditionally, independent of `preferExactMatches` -- the two features
 * bias different, unrelated things (incidental skill points vs. a player's
 * own named pieces).
 *
 * Raised from 10,000,000 (2026-10-24): confirmed by the project owner that
 * preferred pieces should still dominate optional-skill satisfaction (see
 * `OPTIONAL_SKILL_BASE_WEIGHT` below), which needs several dominant tiers of
 * its own squeezed in *underneath* this constant but *above*
 * `OPEN_SLOT_WEIGHT`'s realistic range -- the old gap (10,000,000 vs.
 * `OPEN_SLOT_WEIGHT`'s realistic ~200,000 ceiling, a ~50x span) wasn't wide
 * enough to fit 7 genuinely-dominant tiers. Still utterly tiny relative to
 * what a double can represent as an exact integer (2^53, ~9×10^15) even
 * summed across every preferred piece in a build, so this has no precision
 * cost. */
export const PREFERRED_ITEM_WEIGHT = 1_000_000_000

/** How many distinct priority ranks `SearchOptions.optionalSkillRequirements`
 * gets its own genuinely-dominant objective tier for (docs/feedback.md Round
 * 3 #2) -- confirmed with the project owner as a reasonable cap, matching
 * this app's other small-bounded-count conventions (`MAX_EQUIPPED_CUFFS`,
 * weapon Zenith slots 0-3). `SkillPicker`'s own priority selector only offers
 * values 1..7, so in practice every optional requirement always lands in a
 * real tier -- `tierIndexForPriority` below only needs to clamp defensively
 * (a stale shared link could in principle encode an out-of-range value). */
export const MAX_OPTIONAL_SKILL_PRIORITY_TIERS = 7

/** The lowest (least important) optional-skill priority tier's weight --
 * see `tierIndexForPriority`/`OPTIONAL_SKILL_TIER_GROWTH` for how the other
 * `MAX_OPTIONAL_SKILL_PRIORITY_TIERS - 1` tiers scale up from here. Chosen
 * well above `OPEN_SLOT_WEIGHT`'s realistic ceiling (confirmed against the
 * real dataset: at most 3 open slots per armor/weapon slot, 6 such slots, plus
 * `CUFF_SLOT_BUDGET`'s own cap of 2 -- (6*3 + 2) * `OPEN_SLOT_WEIGHT` =
 * 200,000 is the actual, not estimated, ceiling) -- a skill the player
 * explicitly asked to prefer should always win over incidental leftover
 * slots/bonus points, the same reasoning `PREFERRED_ITEM_WEIGHT` already
 * uses against `OPEN_SLOT_WEIGHT`. */
export const OPTIONAL_SKILL_BASE_WEIGHT = 1_000_000

/** Growth factor between adjacent optional-skill priority tiers. Each tier is
 * a single binary "is this priority group satisfied" indicator (0 or 1, see
 * `buildModel`'s own comment on `optionalSkillRequirements`), so for tier `i`
 * to always outrank the *sum* of every lower tier combined (`0`..`i-1`, each
 * contributing at most 1 unit of its own weight), any growth factor >= 2
 * suffices: `BASE*2^i - BASE*(2^i - 1) = BASE > 0` for every `i`, an exact
 * calculation in double-precision floating point since every value involved
 * is an integer well under 2^53. The smallest valid factor is used
 * deliberately, to keep the top tier (`OPTIONAL_SKILL_BASE_WEIGHT *
 * 2^(MAX_OPTIONAL_SKILL_PRIORITY_TIERS - 1)` = 64,000,000) comfortably below
 * `PREFERRED_ITEM_WEIGHT` (confirmed by the project owner: preferred pieces
 * must still dominate optional-skill satisfaction). */
export const OPTIONAL_SKILL_TIER_GROWTH = 2

/** Maps a `OptionalSkillRequirement.priority` (1 = most important) to its
 * 0-indexed objective tier (0 = least important) -- the inverse ordering,
 * since the *largest* tier weight must go to the *smallest* (most important)
 * priority number. Clamps defensively to `[1, MAX_OPTIONAL_SKILL_PRIORITY_TIERS]`
 * -- see that constant's own docstring. */
function tierIndexForPriority(priority: number): number {
  const clamped = Math.min(MAX_OPTIONAL_SKILL_PRIORITY_TIERS, Math.max(1, Math.round(priority)))
  return MAX_OPTIONAL_SKILL_PRIORITY_TIERS - clamped
}

function optionalSkillTierWeight(tierIndex: number): number {
  return OPTIONAL_SKILL_BASE_WEIGHT * OPTIONAL_SKILL_TIER_GROWTH ** tierIndex
}

/** The game's "at most 2 cuffs equipped" rule and its combined "Poogie slot"
 * cost budget -- confirmed in `etl/src/etl/db/schema.sql` ("at most 2
 * equipped, slot costs summing to at most 2") and
 * docs/data-format-notes.md's "Cuffs" section. Two independent limits (one on
 * raw item count, one on summed `Cuff.slotSize`) that happen to share a
 * number today -- kept as two named constants so a future change to either
 * rule doesn't silently affect the other. */
export const MAX_EQUIPPED_CUFFS = 2
export const CUFF_SLOT_BUDGET = 2

/** The game's "at most 1 Hiden cuff equipped" rule (see `HIDEN_CUFF_CATEGORY`'s
 * own docstring) -- a third, independent cuff-count limit alongside
 * `MAX_EQUIPPED_CUFFS`/`CUFF_SLOT_BUDGET`, scoped only to cuffs in that one
 * category rather than every cuff. */
export const MAX_EQUIPPED_HIDEN_CUFFS = 1

/** The most decoration slots any one armor piece or weapon has (confirmed
 * against the real dataset: every piece has 0-3, and weapons are capped at 3
 * in `App.tsx`). The pooled decoration rows in `buildModel` are only exact up
 * to this, so it rejects anything larger rather than silently mis-placing. */
export const MAX_DECORATION_SLOTS_PER_PIECE = 3

export interface CandidateColumn {
  readonly kind: 'candidate'
  readonly slotIndex: number
  readonly slotId: string
  readonly candidate: Candidate
}

/** A decoration's total copy count, as an integer column (see this module's
 * own docstring). Pooled across every slot unless `pinnedSlotId` is set, in
 * which case it's a pinned decoration (`SearchOptions.pinnedSlotDecorations`)
 * whose count is fixed and whose size was already carved out of that slot's
 * candidates. */
export interface DecorationColumn {
  readonly kind: 'decoration'
  readonly decoration: Decoration
  readonly pinnedSlotId?: string
}

/** One binary column per (cuff, count) pair, exactly one chosen per cuff --
 * a one-hot encoding rather than one integer column, so `exclusionRow`'s
 * binary no-good cut can cover cuffs (see this module's own docstring). Cuffs
 * aren't placed into any particular armor slot; they're drawn from one shared
 * pool of at most `MAX_EQUIPPED_CUFFS`. */
export interface CuffColumn {
  readonly kind: 'cuff'
  readonly cuff: Cuff
  /** How many of this cuff this column equips -- 0 means "not equipped," a
   * valid, usually-necessary member of its one-hot group. Can be 2 (the same
   * cuff filling both cuff slots at once), confirmed allowed by the project
   * owner. */
  readonly count: number
}

/** A non-choice bookkeeping column (see this module's own docstring) --
 * never "chosen" in the sense `decodeSolution`/`exclusionRow` care about,
 * regardless of its solved value. */
export interface AuxiliaryColumn {
  readonly kind: 'auxiliary'
  /** Set on `preferExactMatches`'s "this bonus skill's tier is active"
   * indicators, so `engine.ts` can bound them all to 0 -- turning the
   * penalty into a hard "no bonus tier active" rule -- and back again, on
   * the same live model (see its strict mode). */
  readonly tierIndicator?: true
}

/** What a single model column represents -- parallel to the model's own
 * column order, so a solution vector (indexed the same way) can be decoded
 * back into picks and placed decorations. */
export type ColumnMeta = CandidateColumn | DecorationColumn | CuffColumn | AuxiliaryColumn

export interface BuiltModel {
  readonly model: ModelData
  readonly columns: readonly ColumnMeta[]
}

export function pointsTowards(skills: readonly SkillContribution[], skillId: SkillId): number {
  return skills.find((s) => s.skillId === skillId)?.points ?? 0
}

/** Total points in skills nobody requested -- additive the same way summed
 * skill points always are, matching the old engine's `bonusPointsOf`
 * (expand.ts) which this replaces. Used only for the default (not
 * `preferExactMatches`) ranking -- see `buildModel`. */
function bonusPointsOf(
  skills: readonly SkillContribution[],
  requestedSkillIds: ReadonlySet<SkillId>,
): number {
  let bonusPoints = 0
  for (const skill of skills) {
    if (!requestedSkillIds.has(skill.skillId)) bonusPoints += skill.points
  }
  return bonusPoints
}

export interface TierBreakpoints {
  /** The smallest positive tier threshold for this skill, if it has one. */
  readonly posThreshold?: number
  /** The largest (closest to zero) negative tier threshold for this skill,
   * if it has one -- the "weakest" penalty tier, i.e. the first one a
   * dropping total would reach. */
  readonly negThreshold?: number
}

/** Resolves each non-requested skill's two nearest tier breakpoints (see
 * `TierBreakpoints`) -- the only two thresholds that matter for "has this
 * skill's tier been activated at all," since tiers on the same side are
 * nested (crossing a stronger tier always means the weaker one on that side
 * was crossed too). A requested skill is skipped entirely: its own
 * requirement row already governs it, and it's never treated as a "bonus"
 * skill regardless of what `options.skillTiers` says about it. */
/** The two nearest tier breakpoints (see `TierBreakpoints`) for one skill's
 * raw thresholds -- shared by `resolveTierBreakpoints` below and
 * `buildModel`'s excluded-active-skill rows (docs/skill-system-roadmap.md
 * TODO #37), both of which need exactly the same pos/neg reduction
 * `active-skill-cap.ts`'s `isSkillActive` also performs. Exported for
 * `engine.ts`'s own reuse (2026-10-26, the "Three Worlds" investigation's #4
 * mitigation): deciding whether a solved incumbent still has an unwanted
 * bonus skill active needs the exact same pos/neg reduction this module
 * already uses to decide whether to build tier machinery for it at all. */
export function breakpointsFromThresholds(tierThresholds: readonly number[]): TierBreakpoints {
  const positives = tierThresholds.filter((t) => t > 0)
  const negatives = tierThresholds.filter((t) => t < 0)
  return {
    posThreshold: positives.length > 0 ? Math.min(...positives) : undefined,
    negThreshold: negatives.length > 0 ? Math.max(...negatives) : undefined,
  }
}

function resolveTierBreakpoints(
  skillTiers: readonly SkillTierThresholds[],
  requestedSkillIds: ReadonlySet<SkillId>,
): Map<SkillId, TierBreakpoints> {
  const breakpoints = new Map<SkillId, TierBreakpoints>()
  for (const { skillId, tierThresholds } of skillTiers) {
    if (requestedSkillIds.has(skillId)) continue

    const bp = breakpointsFromThresholds(tierThresholds)
    if (bp.posThreshold !== undefined || bp.negThreshold !== undefined) {
      breakpoints.set(skillId, bp)
    }
  }
  return breakpoints
}

export interface AchievableRange {
  max: number
  min: number
}

/**
 * The range of totals each candidate skill id could possibly reach across
 * the whole query, used to size each skill's big-M indicator constraints
 * (see `buildModel`). Deliberately a safe *over*-estimate, not a tight
 * bound -- but still one tight enough to keep the solver fast at real-
 * dataset scale (unlike a first version of this function, which sized each
 * slot's decoration contribution by summing every relevant decoration's own
 * max independently, as if each alone had the slot's *entire* capacity to
 * itself: harmless for correctness, since a looser-than-necessary big-M
 * can never make a solved model wrong, but it quietly produced
 * astronomically loose M values once a slot had hundreds of relevant
 * decorations sharing one real capacity budget -- as the real dataset
 * commonly does -- which was enough to make the solver unable to find *any*
 * feasible incumbent for an already-tight real query within its time box).
 *
 * Decorations sharing a slot's capacity are instead bounded by points-per-
 * slot-unit ("density"): the most any combination of them could contribute
 * is the slot's full capacity spent entirely on whichever one has the best
 * density (worst, for the minimum) -- the standard fractional-relaxation
 * bound for a shared-capacity choice, still a safe upper/lower bound on the
 * true (integer-constrained) achievable value, and far tighter in practice
 * than ignoring the shared capacity altogether.
 *
 * Cuffs use a simpler bound instead of density: at most `MAX_EQUIPPED_CUFFS`
 * can ever be equipped (regardless of `slotSize`, including free ones -- see
 * `CUFF_SLOT_BUDGET`'s doc comment), so "the single best cuff for this skill,
 * equipped `MAX_EQUIPPED_CUFFS` times over" is already a safe bound without
 * needing a density calculation -- which matters here specifically because a
 * free (`slotSize === 0`) cuff would otherwise divide by zero.
 *
 * Exported (and `AchievableRange`/`pointsTowards` alongside it) for
 * `feasibility.ts`'s own reuse (docs/feedback.md Round 1 #14: detecting an
 * impossible request up front) -- a requirement whose `minPoints` exceeds
 * this same safe upper bound is provably infeasible no matter what the
 * solver tries, for exactly the reason this bound already has to be safe for
 * `buildModel`'s own big-M sizing to never understate what's reachable.
 */
export function computeAchievableRanges(
  slots: readonly SlotQuery[],
  slotDecorationGroups: readonly (readonly Decoration[])[],
  slotMaxCapacity: readonly number[],
  cuffs: readonly Cuff[],
  skillIds: ReadonlySet<SkillId>,
): Map<SkillId, AchievableRange> {
  const ranges = new Map<SkillId, AchievableRange>()
  for (const id of skillIds) ranges.set(id, { max: 0, min: 0 })

  slots.forEach((slot, s) => {
    const localMax = new Map<SkillId, number>()
    const localMin = new Map<SkillId, number>()
    for (const candidate of slot.candidates) {
      for (const { skillId, points } of candidate.skills) {
        if (!skillIds.has(skillId)) continue
        localMax.set(skillId, Math.max(localMax.get(skillId) ?? 0, points))
        localMin.set(skillId, Math.min(localMin.get(skillId) ?? 0, points))
      }
    }
    for (const [skillId, max] of localMax) ranges.get(skillId)!.max += max
    for (const [skillId, min] of localMin) ranges.get(skillId)!.min += min

    const maxDensity = new Map<SkillId, number>()
    const minDensity = new Map<SkillId, number>()
    for (const decoration of slotDecorationGroups[s]) {
      for (const { skillId, points } of decoration.skills) {
        if (!skillIds.has(skillId)) continue
        const density = points / decoration.slotSize
        maxDensity.set(skillId, Math.max(maxDensity.get(skillId) ?? 0, density))
        minDensity.set(skillId, Math.min(minDensity.get(skillId) ?? 0, density))
      }
    }
    const capacity = slotMaxCapacity[s]
    for (const [skillId, density] of maxDensity) {
      ranges.get(skillId)!.max += Math.max(0, density) * capacity
    }
    for (const [skillId, density] of minDensity) {
      ranges.get(skillId)!.min += Math.min(0, density) * capacity
    }
  })

  const cuffMax = new Map<SkillId, number>()
  const cuffMin = new Map<SkillId, number>()
  for (const cuff of cuffs) {
    for (const { skillId, points } of cuff.skills) {
      if (!skillIds.has(skillId)) continue
      cuffMax.set(skillId, Math.max(cuffMax.get(skillId) ?? 0, points))
      cuffMin.set(skillId, Math.min(cuffMin.get(skillId) ?? 0, points))
    }
  }
  for (const [skillId, max] of cuffMax) {
    ranges.get(skillId)!.max += MAX_EQUIPPED_CUFFS * Math.max(0, max)
  }
  for (const [skillId, min] of cuffMin) {
    ranges.get(skillId)!.min += MAX_EQUIPPED_CUFFS * Math.min(0, min)
  }

  return ranges
}

/** Whether `buildModel` builds `preferExactMatches`'s bonus-tier penalty
 * machinery for these options -- the one ranking term no sound pruning rule
 * exists for (see `candidate-pruning.ts`). */
export function hasTierPenalties(options: SearchOptions): boolean {
  return Boolean(options.preferExactMatches && options.skillTiers && !options.withoutTierPenalties)
}

/** Skills the player asked for in any form -- hard requirements plus
 * optional ones. Neither kind is ever a "bonus" skill (see `buildModel`'s own
 * comment where this is used). Exported so `candidate-pruning.ts` judges
 * bonus skills by exactly the same set `buildModel` does. */
export function skillPreferenceIdsOf(
  requirements: readonly SkillRequirement[],
  options: SearchOptions,
): Set<SkillId> {
  return new Set([
    ...requirements.map((r) => r.skillId),
    ...(options.optionalSkillRequirements ?? []).map((r) => r.skillId),
  ])
}

/** A candidate column's objective coefficient (see `buildModel`'s docstring
 * for what each term means) -- exported so `candidate-pruning.ts` compares
 * candidates by exactly the value `buildModel` will hand the solver. */
export function candidateObjectiveCost(
  candidate: Candidate,
  skillPreferenceIds: ReadonlySet<SkillId>,
  options: SearchOptions,
): number {
  const bonus = options.preferExactMatches ? 0 : bonusPointsOf(candidate.skills, skillPreferenceIds)
  const preferredBonus = options.preferredCandidateIds?.has(candidate.id)
    ? PREFERRED_ITEM_WEIGHT
    : 0
  return OPEN_SLOT_WEIGHT * (candidate.openSlotCount ?? 0) + bonus + preferredBonus
}

/** One copy of a decoration's objective coefficient (the slot it uses, plus
 * any bonus points) -- exported for `candidate-pruning.ts`, same reason as
 * `candidateObjectiveCost`. */
export function decorationObjectiveCost(
  decoration: Decoration,
  skillPreferenceIds: ReadonlySet<SkillId>,
  options: SearchOptions,
): number {
  const bonus = options.preferExactMatches
    ? 0
    : bonusPointsOf(decoration.skills, skillPreferenceIds)
  return -OPEN_SLOT_WEIGHT * decoration.slotSize + bonus
}

interface TierMachinery {
  readonly skillId: SkillId
  readonly posThreshold?: number
  readonly negThreshold?: number
  readonly needsPos: boolean
  readonly needsNeg: boolean
  readonly range: AchievableRange
}

/**
 * Encodes `slots`/`decorations`/`requirements` as a single MIP (see this
 * module's own docstring for the column/row layout). `decorations` is
 * expected to already be filtered to ones relevant to `requirements` (same
 * precondition `expand.ts`'s `filterRelevantDecorations` existed for) --
 * irrelevant decorations would only add dead columns the solver has to carry
 * for no benefit.
 *
 * Takes a live `Highs` instance not to solve anything here, but because
 * `ModelData`'s unbounded-row sentinel and objective sense are themselves
 * values the runtime defines (`highs.infinity`, a branded
 * `highs.constants.objectiveSense`), not plain JS constants -- there's no way
 * to build a valid `ModelData` without them.
 *
 * `options.preferExactMatches` replaces the objective's bonus-skill term
 * entirely: instead of rewarding a build for the raw total points it picks
 * up in skills nobody asked for (the default), it's never rewarded at all,
 * and a flat `EXACT_MATCH_SKILL_PENALTY` is subtracted once per bonus skill
 * whose own tier actually gets activated (using `options.skillTiers`, since
 * only the game's own tier thresholds -- not the raw point count -- decide
 * whether a skill does anything). This needs, per bonus skill that can
 * possibly reach one of its own tiers: one continuous accounting column
 * tracking that skill's total across every chosen candidate/decoration
 * (`totalRow`, an equality row wiring it to the real choice columns), and
 * one binary indicator column per reachable side (`posIndicatorRow`/
 * `negIndicatorRow`) forced to 1 by a big-M constraint whenever the
 * accounting column reaches that side's threshold -- the textbook MIP
 * indicator-constraint pattern. None of this touches feasibility: a
 * requirement is still a hard constraint, never an objective term, so this
 * can never make an otherwise-valid build infeasible, only re-rank which
 * valid build comes back first.
 *
 * `cuffs` is a wholly separate pool from `decorations`, one-hot-encoded the
 * same way (see this module's own docstring) but global instead of per-slot:
 * three global rows (`cuffBudgetRow`/`cuffCountRow`/`cuffHidenCountRow`) cap,
 * respectively, the summed `Cuff.slotSize`, the raw count of equipped cuffs,
 * and the count equipped from the Hiden category specifically, at
 * `CUFF_SLOT_BUDGET`/`MAX_EQUIPPED_CUFFS`/`MAX_EQUIPPED_HIDEN_CUFFS` (the
 * first two share a number today, but are independent rules -- see those
 * constants' doc comments; the Hiden row only ever constrains a subset of the
 * same columns the count row already does, so it never changes which cuffs
 * are *possible*, only how many of the Hiden ones may be chosen together).
 * Like decorations, each cuff is expected to already be filtered to ones
 * relevant to `requirements` before this is called.
 *
 * `options.pinnedCuffs` are folded into the row bounds directly rather than
 * modeled as columns -- see this function's own local comment above where
 * they're read.
 *
 * `options.pinnedSlotDecorations` (docs/skill-system-roadmap.md TODO #12),
 * unlike `pinnedCuffs`, *are* modeled as real columns: one fixed-count
 * column per pinned (slot, decoration) pair, so its points reach every skill
 * row exactly like a pooled copy's would, while the slot's own candidate and
 * every other decoration stay fully solver-chosen. The pins' total size is
 * subtracted from each of that slot's candidates' open slots before the
 * pooled capacity rows see them, and a candidate too small to hold the pins
 * at all is bounded to 0 -- so a pin that fits no candidate the solver could
 * pick still makes the model infeasible, without needing the "narrow to one
 * synthesized candidate" trick pinned armor uses (TODO #7).
 */
export function buildModel(
  highs: Highs,
  slots: readonly SlotQuery[],
  decorations: readonly Decoration[],
  requirements: readonly SkillRequirement[],
  options: SearchOptions = {},
  cuffs: readonly Cuff[] = [],
): BuiltModel {
  const optionalSkillRequirements: readonly OptionalSkillRequirement[] =
    options.optionalSkillRequirements ?? []
  // Optional skills are "asked for," just not as a hard constraint -- they're
  // excluded from the `preferExactMatches` tier-penalty machinery and the
  // default bonus-point ranking the same way a hard requirement already is,
  // so a skill the player explicitly marked as preferred is never also
  // double-counted as an unrequested "bonus." See `skillPreferenceIds`'s own
  // call sites below.
  const skillPreferenceIds = skillPreferenceIdsOf(requirements, options)
  const preferExactMatches = options.preferExactMatches ?? false
  const numSlots = slots.length

  // Pinned cuffs (see `SearchOptions.pinnedCuffs`) are never modeled as
  // columns at all -- they're fixed, not chosen -- so their contribution is
  // folded directly into the rows a real cuff column would otherwise feed:
  // each requirement's threshold is lowered by however much the pin already
  // covers, and the free pool's shared budget/count rows (below) are
  // tightened by however much the pin already spends. A pin's own
  // skill points are therefore identical for every candidate solution the
  // solver considers, so leaving them out of `preferExactMatches`'s tier
  // machinery doesn't change which solution ranks best -- only a *varying*
  // contribution needs to be modeled there.
  const pinnedCuffs = options.pinnedCuffs ?? []
  const pinnedCuffSlotCost = pinnedCuffs.reduce((sum, c) => sum + c.slotSize, 0)
  const pinnedCuffCount = pinnedCuffs.length
  const pinnedHidenCuffCount = pinnedCuffs.filter((c) => c.category === HIDEN_CUFF_CATEGORY).length
  function pinnedPointsTowards(skillId: SkillId): number {
    let total = 0
    for (const c of pinnedCuffs) total += pointsTowards(c.skills, skillId)
    return total
  }

  const slotMaxCapacity = slots.map((slot) =>
    slot.candidates.reduce((max, c) => Math.max(max, c.openSlotCount ?? 0), 0),
  )

  // Pinned slot decorations (see `SearchOptions.pinnedSlotDecorations`):
  // grouped per slot into id -> total count (duplicates in the flat input
  // list = multiple copies, same convention as `pinnedCuffs`). Unlike
  // pinned cuffs, these *are* modeled as real columns (forced to a fixed
  // value) rather than folded into row bounds -- see this function's own
  // docstring.
  const pinnedSlotDecorationCounts = new Map<string, Map<string, number>>()
  for (const [slotId, list] of options.pinnedSlotDecorations ?? []) {
    const counts = new Map<string, number>()
    for (const d of list) counts.set(d.id, (counts.get(d.id) ?? 0) + 1)
    pinnedSlotDecorationCounts.set(slotId, counts)
  }

  const slotDecorationGroups = slots.map((slot, s) => {
    const naturallyRelevant =
      slotMaxCapacity[s] > 0
        ? decorations.filter((d) => d.slotSize > 0 && d.slotSize <= slotMaxCapacity[s])
        : []
    const pinned = options.pinnedSlotDecorations?.get(slot.slotId) ?? []
    if (pinned.length === 0) return naturallyRelevant

    // A pinned decoration gets a group here even if it doesn't naturally fit
    // this slot's capacity (e.g. no candidate here has enough open slots) --
    // otherwise an unfittable pin would silently have no column to enforce
    // it at all, instead of correctly making the model infeasible via
    // `capacityRow` below.
    const byId = new Map(naturallyRelevant.map((d) => [d.id, d]))
    for (const decoration of pinned) byId.set(decoration.id, decoration)
    return [...byId.values()]
  })
  // The largest count any decoration relevant to a slot could reach there --
  // only used as a safe (not tight) upper bound by `computeAchievableRanges`,
  // so sharing one count across every decoration in the slot (rather than
  // each decoration's own `maxCapacity / slotSize`) is fine.
  const skillMaxCounts = slotMaxCapacity

  // Pooled decorations (see this module's own docstring). Each slot's pinned
  // decorations are carved out of its candidates' capacity up front, leaving
  // every chosen piece a "bin" of `remaining` open slots for the pool. A
  // multiset of decorations (sizes 1-3) fits bins of at most 3 slots each
  // exactly when all three of these hold:
  //   (size-3 count)       <= (bins with 3 slots left)
  //   (size-2 and -3 count) <= (bins with at least 2 slots left)
  //   (total size)          <= (total slots left)
  // Sufficiency: size-3s fill 3-slot bins; size-2s fill the 2-slot bins, then
  // the remaining 3-slot bins (leaving 1 slot each); size-1s fill whatever is
  // left. `placeDecorations` decodes a placement with exactly that rule. A
  // bin of 4+ slots would break the second row (it could take two size-2s),
  // so that combination is rejected outright -- no armor piece or weapon in
  // the game has more than 3 slots. With only size-1 decorations in play, the
  // total-size row alone is exact for bins of any size.
  const pinnedSizeOfSlot = slots.map((slot) =>
    (options.pinnedSlotDecorations?.get(slot.slotId) ?? []).reduce((sum, d) => sum + d.slotSize, 0),
  )
  const largestCapacity = slotMaxCapacity.reduce((max, c) => Math.max(max, c), 0)
  const totalCapacity = slotMaxCapacity.reduce((sum, c) => sum + c, 0)
  const pooledDecorations = decorations.filter(
    (d) => d.slotSize > 0 && d.slotSize <= largestCapacity,
  )
  const needsSize2Row = pooledDecorations.some((d) => d.slotSize >= 2)
  const needsSize3Row = pooledDecorations.some((d) => d.slotSize >= 3)
  if (needsSize2Row && largestCapacity > MAX_DECORATION_SLOTS_PER_PIECE) {
    throw new Error(
      `A piece has more than ${MAX_DECORATION_SLOTS_PER_PIECE} decoration slots, which the pooled decoration model can't place size-2+ decorations into exactly`,
    )
  }

  const cardinalityRow = (slotIndex: number): number => slotIndex

  let rowCursor = numSlots
  const capacityRow = pooledDecorations.length > 0 ? rowCursor++ : -1
  const size2Row = needsSize2Row ? rowCursor++ : -1
  const size3Row = needsSize3Row ? rowCursor++ : -1
  const skillRowBase = rowCursor
  const skillRow = (requirementIndex: number): number => skillRowBase + requirementIndex

  // One row per requested resistance floor (docs/feedback.md Round 1 #4) --
  // only ever fed by candidate columns below, since decorations and cuffs
  // carry no resistance data at all (see `Candidate.resistances`'s own
  // docstring). A plain `>= minTotal` row, same shape as a skill requirement
  // row but without a pinned-cuff offset (cuffs can never contribute here).
  const resistanceFloors: readonly ResistanceFloor[] = options.resistanceFloors ?? []
  const resistanceRowBase = skillRowBase + requirements.length
  const resistanceRow = (floorIndex: number): number => resistanceRowBase + floorIndex

  // One row per excluded-active skill (docs/skill-system-roadmap.md TODO #37)
  // -- replaces TODO #32's old "ban every piece/decoration/cuff that grants
  // any points in it" behavior with a hard constraint that just keeps the
  // build's summed total for that skill outside whichever tier(s) would make
  // it "active," mirroring `active-skill-cap.ts`'s own `isSkillActive` exactly
  // inverted (reusing `breakpointsFromThresholds`, the same reduction
  // `resolveTierBreakpoints` uses). Unlike a resistance floor, fed by
  // candidates, decorations, *and* cuffs -- skill points aren't
  // candidate-only -- and unlike a plain floor, can have both a lower *and*
  // upper bound at once (a skill with both a bonus and a penalty tier has an
  // "inactive" zone strictly between them), each offset by the skill's own
  // pinned-cuff contribution the same way a requirement row is.
  const excludedActiveSkillIds: readonly SkillId[] = options.excludedActiveSkillIds ?? []
  const excludedSkillTierThresholds = new Map(
    (options.skillTiers ?? []).map((t) => [t.skillId, t.tierThresholds]),
  )
  const excludedSkillBounds = excludedActiveSkillIds.map((skillId) => {
    const { posThreshold, negThreshold } = breakpointsFromThresholds(
      excludedSkillTierThresholds.get(skillId) ?? [],
    )
    const untiered = posThreshold === undefined && negThreshold === undefined
    return {
      lower: negThreshold !== undefined ? negThreshold + 1 : -highs.infinity,
      upper: posThreshold !== undefined ? posThreshold - 1 : untiered ? 0 : highs.infinity,
    }
  })
  const excludedSkillRowBase = resistanceRowBase + resistanceFloors.length
  const excludedSkillRow = (i: number): number => excludedSkillRowBase + i
  const baseNumRows = excludedSkillRowBase + excludedActiveSkillIds.length

  // Tier machinery (see this function's own docstring) -- resolved before
  // row layout is finalized, since its row/column counts depend on which
  // bonus skills can actually reach one of their own tiers in this query.
  let tierMachinery: readonly TierMachinery[] = []
  if (hasTierPenalties(options)) {
    const breakpoints = resolveTierBreakpoints(options.skillTiers!, skillPreferenceIds)
    const ranges = computeAchievableRanges(
      slots,
      slotDecorationGroups,
      skillMaxCounts,
      cuffs,
      new Set(breakpoints.keys()),
    )
    tierMachinery = [...breakpoints]
      .map(([skillId, bp]): TierMachinery => {
        const range = ranges.get(skillId)!
        return {
          skillId,
          posThreshold: bp.posThreshold,
          negThreshold: bp.negThreshold,
          needsPos: bp.posThreshold !== undefined && range.max >= bp.posThreshold,
          needsNeg: bp.negThreshold !== undefined && range.min <= bp.negThreshold,
          range,
        }
      })
      .filter((m) => m.needsPos || m.needsNeg)
  }

  const totalRowOf = new Map<SkillId, number>()
  const posIndicatorRowOf = new Map<SkillId, number>()
  const negIndicatorRowOf = new Map<SkillId, number>()
  rowCursor = baseNumRows
  for (const m of tierMachinery) {
    totalRowOf.set(m.skillId, rowCursor++)
    if (m.needsPos) posIndicatorRowOf.set(m.skillId, rowCursor++)
    if (m.needsNeg) negIndicatorRowOf.set(m.skillId, rowCursor++)
  }

  // Preferred category counts (see `SearchOptions.preferredCategoryCounts`):
  // one row per entry, each wiring a capped accounting column (added once
  // candidates are built below) to the real candidate columns the same way
  // `totalRowOf` above wires a bonus skill's accounting column to its real
  // contributors -- `capped - sum(matching candidates) <= 0` lets the
  // objective reward the accounting column up to `count` without ever
  // letting it claim more credit than the build actually earns. A degenerate
  // entry (`count <= 0`) is dropped rather than given a column that could
  // never contribute anything.
  const preferredCategoryCounts = (options.preferredCategoryCounts ?? []).filter((p) => p.count > 0)
  const preferredCategoryRowOf: number[] = preferredCategoryCounts.map(() => rowCursor++)

  // Optional skill requirements (see `SearchOptions.optionalSkillRequirements`
  // and `OptionalSkillRequirement`'s own docstring for the interchangeable-
  // priority-group semantics). Each entry's achievable range (reusing
  // `computeAchievableRanges`, same safe-bound machinery `tierMachinery`
  // above uses) sorts it into one of three buckets, mirroring how a hard
  // requirement row's own bound is offset by a pin: *always* met regardless
  // of any choice this model makes (its own minimum, after subtracting any
  // pinned-cuff contribution, is already <= the achievable floor) or *never*
  // achievable at all -- both are a constant contribution to every candidate
  // solution, so they get no column. An always-met member's tier reward goes
  // into the objective's constant `offset` instead (2026-10-26), so the
  // solved objective value stays the build's true score no matter which
  // pieces this particular model was given -- `worker-handler.ts` compares
  // objective values across differently-pruned models. That also settles its
  // whole priority tier: any other member of the same tier gets no column
  // either, since an already-met tier can't be earned twice. The rest are
  // genuinely conditional, which needs real machinery below.
  interface LiveOptionalMember {
    readonly skillId: SkillId
    readonly rangeMin: number
    readonly effectiveMinPoints: number
    readonly bigM: number
    readonly tierIndex: number
  }
  const optionalRanges = computeAchievableRanges(
    slots,
    slotDecorationGroups,
    skillMaxCounts,
    cuffs,
    new Set(optionalSkillRequirements.map((r) => r.skillId)),
  )
  const alwaysMetOptionalTiers = new Set<number>()
  for (const req of optionalSkillRequirements) {
    const range = optionalRanges.get(req.skillId)!
    const effectiveMinPoints = req.minPoints - pinnedPointsTowards(req.skillId)
    if (effectiveMinPoints <= range.min)
      alwaysMetOptionalTiers.add(tierIndexForPriority(req.priority))
  }
  const objectiveOffset = [...alwaysMetOptionalTiers].reduce(
    (sum, tierIndex) => sum + optionalSkillTierWeight(tierIndex),
    0,
  )
  const liveOptionalMembers: LiveOptionalMember[] = []
  for (const req of optionalSkillRequirements) {
    const range = optionalRanges.get(req.skillId)!
    const effectiveMinPoints = req.minPoints - pinnedPointsTowards(req.skillId)
    if (effectiveMinPoints <= range.min || effectiveMinPoints > range.max) continue
    if (alwaysMetOptionalTiers.has(tierIndexForPriority(req.priority))) continue
    liveOptionalMembers.push({
      skillId: req.skillId,
      rangeMin: range.min,
      effectiveMinPoints,
      bigM: effectiveMinPoints - range.min,
      tierIndex: tierIndexForPriority(req.priority),
    })
  }
  // Groups members sharing a priority tier -- see `OptionalSkillRequirement.
  // priority`'s own docstring on why these are interchangeable (an OR, not a
  // sum): the group's own reward column (added once members are resolved
  // below) is bounded by "at least one member reached," never by how many.
  const optionalGroupMembersByTier = new Map<number, number[]>()
  liveOptionalMembers.forEach((member, i) => {
    const list = optionalGroupMembersByTier.get(member.tierIndex) ?? []
    list.push(i)
    optionalGroupMembersByTier.set(member.tierIndex, list)
  })
  const optionalReachedRowOf: number[] = liveOptionalMembers.map(() => rowCursor++)
  const optionalGroupMetRowOf = new Map<number, number>()
  for (const tierIndex of optionalGroupMembersByTier.keys()) {
    optionalGroupMetRowOf.set(tierIndex, rowCursor++)
  }

  // Cuffs (see this function's own docstring): one one-hot group row per
  // cuff, plus two rows global to every cuff (not per-slot, since cuffs
  // aren't tied to an armor slot). Skipped entirely when there are no
  // relevant cuffs, same as tier machinery above when it's not needed.
  const cuffGroupRowOf: number[] = cuffs.map(() => rowCursor++)
  const cuffBudgetRow = cuffs.length > 0 ? rowCursor++ : -1
  const cuffCountRow = cuffs.length > 0 ? rowCursor++ : -1
  const cuffHidenCountRow = cuffs.length > 0 ? rowCursor++ : -1

  // One row per distinct skill pinned to a cuff slot (docs/skill-system-
  // roadmap.md TODO #25) -- "pin a cuff slot to skill X" doesn't narrow down
  // *which* cuff variant, only requires the free pool to supply at least as
  // many equipped cuffs granting that skill as it was pinned that many times
  // (duplicates allowed, same convention as `pinnedCuffs`/`PinnedSlot`'s own
  // decoration lists -- pinning the same skill twice needs two qualifying
  // cuffs, which may or may not be the same variant). A plain `>= required`
  // row, same shape as a skill requirement row, fed by every relevant cuff's
  // own equipped *count* (not just whether it's chosen at all) -- mirrors
  // `cuffCountRow`'s own per-column entries exactly, since both are counting
  // equipped cuff units. Offset by however many already-pinned (exact-id)
  // cuffs already grant this skill, the same `pinnedPointsTowards`-style
  // adjustment a skill requirement row gets.
  const pinnedCuffSkillCounts = new Map<SkillId, number>()
  for (const skillId of options.pinnedCuffSkillIds ?? []) {
    pinnedCuffSkillCounts.set(skillId, (pinnedCuffSkillCounts.get(skillId) ?? 0) + 1)
  }
  const pinnedCuffSkillIds = [...pinnedCuffSkillCounts.keys()]
  const pinnedCuffSkillRowOf = new Map(pinnedCuffSkillIds.map((id, i) => [id, rowCursor + i]))
  rowCursor += pinnedCuffSkillIds.length

  const numRows = rowCursor

  const rowLower = new Array<number>(numRows)
  const rowUpper = new Array<number>(numRows)
  for (let s = 0; s < numSlots; s++) {
    rowLower[cardinalityRow(s)] = 1
    rowUpper[cardinalityRow(s)] = 1
  }
  for (const row of [capacityRow, size2Row, size3Row]) {
    if (row < 0) continue
    rowLower[row] = -highs.infinity
    rowUpper[row] = 0
  }
  requirements.forEach((req, r) => {
    rowLower[skillRow(r)] = req.minPoints - pinnedPointsTowards(req.skillId)
    rowUpper[skillRow(r)] = highs.infinity
  })
  resistanceFloors.forEach((floor, i) => {
    rowLower[resistanceRow(i)] = floor.minTotal
    rowUpper[resistanceRow(i)] = highs.infinity
  })
  excludedActiveSkillIds.forEach((skillId, i) => {
    const pinned = pinnedPointsTowards(skillId)
    rowLower[excludedSkillRow(i)] = excludedSkillBounds[i].lower - pinned
    rowUpper[excludedSkillRow(i)] = excludedSkillBounds[i].upper - pinned
  })
  for (const m of tierMachinery) {
    rowLower[totalRowOf.get(m.skillId)!] = 0
    rowUpper[totalRowOf.get(m.skillId)!] = 0
    if (m.needsPos) {
      rowLower[posIndicatorRowOf.get(m.skillId)!] = -highs.infinity
      rowUpper[posIndicatorRowOf.get(m.skillId)!] = m.posThreshold! - 1
    }
    if (m.needsNeg) {
      rowLower[negIndicatorRowOf.get(m.skillId)!] = m.negThreshold! + 1
      rowUpper[negIndicatorRowOf.get(m.skillId)!] = highs.infinity
    }
  }
  for (const row of preferredCategoryRowOf) {
    rowLower[row] = -highs.infinity
    rowUpper[row] = 0
  }
  liveOptionalMembers.forEach((member, i) => {
    // `total - bigM*reached >= rangeMin` (`total`'s own contributions are
    // wired in below, alongside every other per-candidate/decoration/cuff
    // row) -- `reached=1` forces `total >= effectiveMinPoints`; `reached=0`
    // relaxes to `total >= rangeMin`, which the achievable range already
    // guarantees unconditionally, so `reached` can never be falsely forced to
    // 1 by a build that hasn't actually earned it (the reverse of
    // `tierMachinery`'s own big-M direction, which instead only forces its
    // indicator *up* -- that one-sided shape is correct there because it's a
    // penalty the objective wants to avoid, never volunteered for free;
    // here `reached`/`groupMet` are *rewarded*, so a solver would otherwise
    // always claim the reward whether earned or not unless blocked from the
    // other side). `rangeMin` is `rowLower` directly, since `effectiveMinPoints
    // - bigM = rangeMin` by construction.
    rowLower[optionalReachedRowOf[i]] = member.rangeMin
    rowUpper[optionalReachedRowOf[i]] = highs.infinity
  })
  for (const row of optionalGroupMetRowOf.values()) {
    // `groupMet - sum(reached in this group) <= 0` -- `groupMet` can only be
    // 1 once at least one member's `reached` is 1 (see `OptionalSkillRequirement
    // .priority`'s interchangeable-group docstring); any number of members
    // reached beyond the first earns nothing further, since only `groupMet`
    // itself carries the tier's reward.
    rowLower[row] = -highs.infinity
    rowUpper[row] = 0
  }
  for (const row of cuffGroupRowOf) {
    rowLower[row] = 1
    rowUpper[row] = 1
  }
  if (cuffs.length > 0) {
    rowLower[cuffBudgetRow] = -highs.infinity
    rowUpper[cuffBudgetRow] = Math.max(0, CUFF_SLOT_BUDGET - pinnedCuffSlotCost)
    rowLower[cuffCountRow] = -highs.infinity
    rowUpper[cuffCountRow] = Math.max(0, MAX_EQUIPPED_CUFFS - pinnedCuffCount)
    rowLower[cuffHidenCountRow] = -highs.infinity
    rowUpper[cuffHidenCountRow] = Math.max(0, MAX_EQUIPPED_HIDEN_CUFFS - pinnedHidenCuffCount)
  }
  for (const skillId of pinnedCuffSkillIds) {
    const required = pinnedCuffSkillCounts.get(skillId)!
    const alreadyPinned = pinnedCuffs.filter((c) => pointsTowards(c.skills, skillId) !== 0).length
    rowLower[pinnedCuffSkillRowOf.get(skillId)!] = required - alreadyPinned
    rowUpper[pinnedCuffSkillRowOf.get(skillId)!] = highs.infinity
  }

  const columns: ColumnMeta[] = []
  const colCost: number[] = []
  const colLower: number[] = []
  const colUpper: number[] = []
  const integrality: VariableType[] = []
  const starts: number[] = [0]
  const indices: number[] = []
  const values: number[] = []

  function addColumn(
    cost: number,
    entries: ReadonlyMap<number, number>,
    lower = 0,
    upper = 1,
  ): void {
    colCost.push(cost)
    colLower.push(lower)
    colUpper.push(upper)
    integrality.push(highs.constants.variableType.integer)
    for (const [row, value] of [...entries].sort((a, b) => a[0] - b[0])) {
      indices.push(row)
      values.push(value)
    }
    starts.push(indices.length)
  }

  /** Every skill-related row a decoration's points feed, per copy. */
  function decorationEntries(decoration: Decoration): Map<number, number> {
    const entries = new Map<number, number>()
    requirements.forEach((req, r) => {
      const points = pointsTowards(decoration.skills, req.skillId)
      if (points !== 0) entries.set(skillRow(r), points)
    })
    excludedActiveSkillIds.forEach((skillId, i) => {
      const points = pointsTowards(decoration.skills, skillId)
      if (points !== 0) entries.set(excludedSkillRow(i), points)
    })
    for (const m of tierMachinery) {
      const points = pointsTowards(decoration.skills, m.skillId)
      if (points !== 0) entries.set(totalRowOf.get(m.skillId)!, points)
    }
    liveOptionalMembers.forEach((member, i) => {
      const points = pointsTowards(decoration.skills, member.skillId)
      if (points !== 0) entries.set(optionalReachedRowOf[i], points)
    })
    return entries
  }

  slots.forEach((slot, s) => {
    for (const candidate of slot.candidates) {
      // The open slots left for pooled decorations once this slot's pinned
      // ones are placed -- negative means the pins can't fit this candidate
      // at all, so it's kept as a column (decoding stays uniform) but can
      // never be chosen. If no candidate here can hold the pins, the
      // cardinality row makes the whole model infeasible, as it should.
      const remaining = (candidate.openSlotCount ?? 0) - pinnedSizeOfSlot[s]
      const entries = new Map<number, number>([[cardinalityRow(s), 1]])
      if (capacityRow >= 0 && remaining > 0) entries.set(capacityRow, -remaining)
      if (size2Row >= 0 && remaining >= 2) entries.set(size2Row, -1)
      if (size3Row >= 0 && remaining >= 3) entries.set(size3Row, -1)
      requirements.forEach((req, r) => {
        const points = pointsTowards(candidate.skills, req.skillId)
        if (points !== 0) entries.set(skillRow(r), points)
      })
      resistanceFloors.forEach((floor, i) => {
        const amount = candidate.resistances?.[floor.element] ?? 0
        if (amount !== 0) entries.set(resistanceRow(i), amount)
      })
      excludedActiveSkillIds.forEach((skillId, i) => {
        const points = pointsTowards(candidate.skills, skillId)
        if (points !== 0) entries.set(excludedSkillRow(i), points)
      })
      for (const m of tierMachinery) {
        const points = pointsTowards(candidate.skills, m.skillId)
        if (points !== 0) entries.set(totalRowOf.get(m.skillId)!, points)
      }
      liveOptionalMembers.forEach((member, i) => {
        const points = pointsTowards(candidate.skills, member.skillId)
        if (points !== 0) entries.set(optionalReachedRowOf[i], points)
      })
      preferredCategoryCounts.forEach((p, i) => {
        if (candidate.category === p.category) entries.set(preferredCategoryRowOf[i], -1)
      })

      columns.push({ kind: 'candidate', slotIndex: s, slotId: slot.slotId, candidate })
      addColumn(
        candidateObjectiveCost(candidate, skillPreferenceIds, options),
        entries,
        0,
        remaining < 0 ? 0 : 1,
      )
    }
  })

  for (const decoration of pooledDecorations) {
    const entries = decorationEntries(decoration)
    entries.set(capacityRow, decoration.slotSize)
    if (decoration.slotSize >= 2) entries.set(size2Row, 1)
    if (decoration.slotSize >= 3) entries.set(size3Row, 1)
    columns.push({ kind: 'decoration', decoration })
    addColumn(
      decorationObjectiveCost(decoration, skillPreferenceIds, options),
      entries,
      0,
      Math.floor(totalCapacity / decoration.slotSize),
    )
  }

  // Pinned decorations: fixed counts, feeding every skill row like a pooled
  // copy would, but no capacity row -- their size was already carved out of
  // their own slot's candidates above.
  for (const slot of slots) {
    for (const [decorationId, count] of pinnedSlotDecorationCounts.get(slot.slotId) ?? []) {
      const decoration = options
        .pinnedSlotDecorations!.get(slot.slotId)!
        .find((d) => d.id === decorationId)!
      columns.push({ kind: 'decoration', decoration, pinnedSlotId: slot.slotId })
      addColumn(
        decorationObjectiveCost(decoration, skillPreferenceIds, options),
        decorationEntries(decoration),
        count,
        count,
      )
    }
  }

  cuffs.forEach((cuff, i) => {
    // Bounded by MAX_EQUIPPED_CUFFS directly (not CUFF_SLOT_BUDGET /
    // cuff.slotSize) -- a free (slotSize === 0) cuff would otherwise divide
    // by zero, and no cuff could ever need a higher count than the item-count
    // limit allows regardless of its own cost.
    const maxCount = Math.min(MAX_EQUIPPED_CUFFS, Math.floor(CUFF_SLOT_BUDGET / cuff.slotSize))
    const groupRow = cuffGroupRowOf[i]
    const cuffBonus = preferExactMatches ? 0 : bonusPointsOf(cuff.skills, skillPreferenceIds)

    for (let count = 0; count <= maxCount; count++) {
      const entries = new Map<number, number>([[groupRow, 1]])
      if (count > 0) {
        if (cuff.slotSize !== 0) entries.set(cuffBudgetRow, count * cuff.slotSize)
        entries.set(cuffCountRow, count)
        if (cuff.category === HIDEN_CUFF_CATEGORY) entries.set(cuffHidenCountRow, count)
        requirements.forEach((req, r) => {
          const points = pointsTowards(cuff.skills, req.skillId)
          if (points !== 0) entries.set(skillRow(r), count * points)
        })
        excludedActiveSkillIds.forEach((skillId, j) => {
          const points = pointsTowards(cuff.skills, skillId)
          if (points !== 0) entries.set(excludedSkillRow(j), count * points)
        })
        for (const skillId of pinnedCuffSkillIds) {
          if (pointsTowards(cuff.skills, skillId) !== 0) {
            entries.set(pinnedCuffSkillRowOf.get(skillId)!, count)
          }
        }
        for (const m of tierMachinery) {
          const points = pointsTowards(cuff.skills, m.skillId)
          if (points !== 0) entries.set(totalRowOf.get(m.skillId)!, count * points)
        }
        liveOptionalMembers.forEach((member, i) => {
          const points = pointsTowards(cuff.skills, member.skillId)
          if (points !== 0) entries.set(optionalReachedRowOf[i], count * points)
        })
      }

      columns.push({ kind: 'cuff', cuff, count })
      const cost = count === 0 ? 0 : count * (-OPEN_SLOT_WEIGHT * cuff.slotSize + cuffBonus)
      addColumn(cost, entries)
    }
  })

  for (const m of tierMachinery) {
    const totalEntries = new Map<number, number>([[totalRowOf.get(m.skillId)!, -1]])
    if (m.needsPos) totalEntries.set(posIndicatorRowOf.get(m.skillId)!, 1)
    if (m.needsNeg) totalEntries.set(negIndicatorRowOf.get(m.skillId)!, 1)
    columns.push({ kind: 'auxiliary' })
    addColumn(0, totalEntries, m.range.min, m.range.max)

    if (m.needsPos) {
      // Smallest big-M that still makes the constraint non-binding once
      // `activatedPos` is 1 (see this function's own docstring) -- `needsPos`
      // guarantees `range.max >= posThreshold`, so this is always >= 1.
      const bigM = m.range.max - (m.posThreshold! - 1)
      columns.push({ kind: 'auxiliary', tierIndicator: true })
      addColumn(-EXACT_MATCH_SKILL_PENALTY, new Map([[posIndicatorRowOf.get(m.skillId)!, -bigM]]))
    }
    if (m.needsNeg) {
      const bigM = m.negThreshold! + 1 - m.range.min
      columns.push({ kind: 'auxiliary', tierIndicator: true })
      addColumn(-EXACT_MATCH_SKILL_PENALTY, new Map([[negIndicatorRowOf.get(m.skillId)!, bigM]]))
    }
  }

  // One `reached` indicator column per live optional-skill member (see
  // `optionalReachedRowOf`'s own row-bounds comment above for the big-M
  // direction) -- cost 0, since only the group's own `groupMet` column below
  // is ever rewarded. Also feeds `-1` into its own priority tier's
  // `groupMet` row (`entries` has two rows, not one): `groupMet <= sum(this
  // tier's reached columns)`, so `groupMet` can only be 1 once at least one
  // member here is.
  liveOptionalMembers.forEach((member, i) => {
    const entries = new Map<number, number>([[optionalReachedRowOf[i], -member.bigM]])
    entries.set(optionalGroupMetRowOf.get(member.tierIndex)!, -1)
    columns.push({ kind: 'auxiliary' })
    addColumn(0, entries)
  })

  // One `groupMet` column per priority tier that has at least one live
  // member -- the only place an optional skill's reward actually enters the
  // objective. `tierIndexForPriority`'s ordering means a higher tier index
  // here is a *more* important (lower `priority` number) group.
  for (const tierIndex of optionalGroupMembersByTier.keys()) {
    const row = optionalGroupMetRowOf.get(tierIndex)!
    columns.push({ kind: 'auxiliary' })
    addColumn(optionalSkillTierWeight(tierIndex), new Map([[row, 1]]))
  }

  // The capped accounting column for each preferred-category-count entry
  // (see this function's own docstring and `preferredCategoryRowOf` above) --
  // bounded [0, count], so the objective can never reward more than `count`
  // pieces from this category even if the build uses more of them, and its
  // own row keeps it from claiming credit the build hasn't actually earned.
  preferredCategoryCounts.forEach((p, i) => {
    columns.push({ kind: 'auxiliary' })
    addColumn(PREFERRED_ITEM_WEIGHT, new Map([[preferredCategoryRowOf[i], 1]]), 0, p.count)
  })

  const model: ModelData = {
    numCols: columns.length,
    numRows,
    sense: highs.constants.objectiveSense.maximize,
    offset: objectiveOffset,
    colCost,
    colLower,
    colUpper,
    rowLower,
    rowUpper,
    integrality,
    matrix: {
      format: 'csc',
      numRows,
      numCols: columns.length,
      starts,
      indices,
      values,
    },
  }

  return { model, columns }
}

export interface BuildResultLike {
  readonly picks: Map<string, Candidate>
  readonly decorations: Map<string, Decoration[]>
  readonly cuffs: Cuff[]
  readonly skillTotals: Map<SkillId, number>
}

/** Decodes a solved model's primal column values back into a `BuildResult`
 * shape. Auxiliary columns (see this module's own docstring) are skipped
 * outright -- they're bookkeeping, not a choice `BuildResult` cares about.
 * Candidate and cuff columns are binary, so "chosen" is read as the value
 * rounding above 0.5 (floating-point solver output is never exactly 0/1); a
 * chosen cuff column with `count > 0` is expanded into that many entries (the
 * same cuff can appear twice, confirmed allowed by the project owner).
 * Decoration columns are integer counts, rounded, then given concrete slots
 * by `placeDecorations` -- the model itself only knows how many copies the
 * build uses, not where they go. */
export function decodeSolution(
  columns: readonly ColumnMeta[],
  colValue: ArrayLike<number>,
): BuildResultLike {
  const picks = new Map<string, Candidate>()
  const pinnedBySlot = new Map<string, Decoration[]>()
  const pooled: Decoration[] = []
  const cuffsChosen: Cuff[] = []
  const skillTotals = new Map<SkillId, number>()

  function addSkills(skills: readonly SkillContribution[], times: number): void {
    for (const { skillId, points } of skills) {
      skillTotals.set(skillId, (skillTotals.get(skillId) ?? 0) + points * times)
    }
  }

  columns.forEach((column, j) => {
    if (column.kind === 'auxiliary') return

    if (column.kind === 'decoration') {
      const count = Math.round(colValue[j])
      if (count <= 0) return
      const target = column.pinnedSlotId ? (pinnedBySlot.get(column.pinnedSlotId) ?? []) : pooled
      for (let i = 0; i < count; i++) target.push(column.decoration)
      if (column.pinnedSlotId) pinnedBySlot.set(column.pinnedSlotId, target)
      addSkills(column.decoration.skills, count)
      return
    }

    if (colValue[j] <= 0.5) return

    if (column.kind === 'candidate') {
      picks.set(column.slotId, column.candidate)
      addSkills(column.candidate.skills, 1)
      return
    }

    if (column.count <= 0) return
    for (let i = 0; i < column.count; i++) cuffsChosen.push(column.cuff)
    addSkills(column.cuff.skills, column.count)
  })

  return {
    picks,
    decorations: placeDecorations(picks, pinnedBySlot, pooled),
    cuffs: cuffsChosen,
    skillTotals,
  }
}

/** Assigns pooled decorations to concrete slots with exactly the rule
 * `buildModel`'s pooled capacity rows prove always succeeds (see its
 * comment there): size-3s into 3-slot bins, size-2s into 2-slot bins before
 * 3-slot ones, size-1s into whatever is left, earliest slot first. Each
 * slot's pinned decorations are placed first and shrink its bin. Throws if a
 * decoration doesn't fit, which would mean the model and this rule disagree
 * -- a bug, not a user-facing outcome. */
function placeDecorations(
  picks: ReadonlyMap<string, Candidate>,
  pinnedBySlot: ReadonlyMap<string, readonly Decoration[]>,
  pooled: readonly Decoration[],
): Map<string, Decoration[]> {
  const bins = [...picks].map(([slotId, candidate]) => {
    const placed = [...(pinnedBySlot.get(slotId) ?? [])]
    const used = placed.reduce((sum, d) => sum + d.slotSize, 0)
    return { slotId, placed, remaining: (candidate.openSlotCount ?? 0) - used }
  })
  const bySizeDescending = [...pooled].sort((a, b) => b.slotSize - a.slotSize)
  for (const decoration of bySizeDescending) {
    const size = decoration.slotSize
    const bin =
      (size === 2 ? bins.find((b) => b.remaining === 2) : undefined) ??
      bins.find((b) => b.remaining >= size)
    if (!bin) {
      throw new Error(`Decoration ${decoration.id} doesn't fit the solved build's open slots`)
    }
    bin.placed.push(decoration)
    bin.remaining -= size
  }
  return new Map(bins.filter((b) => b.placed.length > 0).map((b) => [b.slotId, b.placed]))
}

export interface RowSpec {
  readonly lower: number
  readonly upper: number
  readonly indices: readonly number[]
  readonly values: readonly number[]
}

/**
 * A "no-good cut" forbidding the gear set in `colValue` -- which candidate
 * fills each slot and which cuffs are equipped -- from being chosen again,
 * the standard technique for getting a ranked list of distinct results out
 * of a MIP solver, which (unlike commercial solvers) has no built-in
 * solution pool: solve, cut out the answer just found, re-solve (see
 * `engine.ts`).
 *
 * This is the textbook binary no-good cut (`sum(previously chosen columns)
 * <= chosen count - 1`), valid across candidate and cuff columns because
 * both are binary and every feasible solution picks exactly one column from
 * each slot's cardinality row and each cuff's count group. Decoration
 * columns are general integers and left out on purpose: results are
 * distinct by gear set, each with its own best decoration fill (see this
 * module's own docstring). Auxiliary columns are a deterministic function of
 * the choice columns, so they never need naming either.
 */
export function exclusionRow(
  highs: Highs,
  columns: readonly ColumnMeta[],
  colValue: ArrayLike<number>,
): RowSpec {
  const indices: number[] = []
  const values: number[] = []
  let chosenCount = 0

  columns.forEach((column, j) => {
    if (column.kind === 'auxiliary' || column.kind === 'decoration') return
    if (colValue[j] > 0.5) {
      indices.push(j)
      values.push(1)
      chosenCount++
    }
  })

  return { lower: -highs.infinity, upper: chosenCount - 1, indices, values }
}

/**
 * Whether a round's solver outcome is usable as a yielded `BuildResult` (see
 * `engine.ts`'s per-round time box). Every skill requirement is a hard
 * constraint on the model, never part of the objective -- so *any* primal
 * feasible solution already satisfies every one of them exactly, whether or
 * not the solver ever finished proving it's the single best-ranked one.
 * `interrupted` with a feasible incumbent is therefore just as usable a
 * result as `optimal`, only possibly not the best-ranked one; `interrupted`
 * with no incumbent yet (or genuine `infeasible`) means there's nothing
 * valid to yield this round.
 */
export function isUsableResult(
  highs: Highs,
  modelStatus: ModelStatusCode,
  primalSolutionStatus: number,
): boolean {
  if (modelStatus === highs.constants.modelStatus.optimal) return true
  return (
    modelStatus === highs.constants.modelStatus.interrupted &&
    primalSolutionStatus === highs.constants.solutionStatus.feasible
  )
}
