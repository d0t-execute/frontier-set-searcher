/**
 * Builds and decodes the integer-program formulation the search engine hands
 * to HiGHS (see `engine.ts`'s module docstring for why this replaced the
 * Pareto-frontier approach). One call to `buildModel` encodes an entire
 * query -- every slot's candidates, every relevant decoration, every
 * simultaneous skill requirement -- as a single MIP, so the solver finds a
 * complete build directly instead of this engine combining partial frontiers
 * itself.
 *
 * Every "choice" column in the model is binary, including decoration
 * placement: a decoration that could be placed 0..maxCount times in a slot
 * gets one column *per count* ("place none" through "place maxCount"),
 * constrained so exactly one of them is chosen (see `decorationGroupRow`).
 * This costs more columns than a single bounded integer variable per
 * decoration would, but it's what makes `exclusionRow`'s no-good cut (the
 * thing that lets this engine return more than one ranked result -- see
 * `engine.ts`) a single, textbook-simple row: every feasible solution
 * selects exactly one column from every slot's cardinality group *and*
 * every slot/decoration's count group, so "forbid re-selecting this exact
 * combination of columns" is exactly as valid for a count-group as it
 * already is for a candidate (binary no-good cuts only work cleanly on
 * binary variables -- forbidding "z = 3" for a general bounded integer `z`
 * by writing `z <= 2` would also wrongly forbid `z = 0, 1, 2` the *next*
 * time those are wanted again for a different reason, and a general
 * not-equal cut needs auxiliary variables and big-M rows per excluded value
 * -- the one-hot encoding sidesteps both). Decoration counts are naturally
 * small (1-3 open slots is the common real case), so this is at most a
 * handful of extra columns per relevant decoration per slot, not a
 * combinatorial blow-up.
 *
 * Columns, in order: one binary "is this candidate chosen for this slot"
 * column per (slot, candidate) pair, then one binary "place exactly this
 * many of this decoration in this slot" column -- for every count from 0 up
 * to however many could physically fit -- per (slot, relevant decoration)
 * pair whose size could ever fit there, then one binary "equip exactly this
 * many of this cuff" column per relevant cuff (same one-hot-by-count shape as
 * decorations, but global rather than per-slot -- see `buildModel`'s own
 * docstring), then (only when `options.preferExactMatches` actually needs one
 * -- see below) a handful of non-choice accounting/indicator columns per
 * bonus skill whose tier can be reached at all. `columns` (in `buildModel`'s
 * result) is a parallel array recording what each column means, so a
 * solution vector can be decoded back into a `BuildResult` without the model
 * itself carrying names; the accounting/indicator columns carry no meaning a
 * `BuildResult` needs, so they're tagged `kind: 'auxiliary'` and skipped by
 * both `decodeSolution` and `exclusionRow`.
 *
 * Rows, in order: one cardinality row per slot (exactly one candidate
 * chosen), one capacity row per slot (decorations placed there can't exceed
 * the chosen candidate's open slots), one decoration-group row per (slot,
 * relevant decoration) pair (exactly one count column chosen for it), one
 * row per skill requirement (the summed contribution across every chosen
 * candidate and placed decoration must reach its minimum), then (same
 * condition as the auxiliary columns above) a handful of rows per bonus
 * skill wiring its accounting column to the real choice columns and to its
 * tier-crossing indicator column(s), then one cuff-group row per relevant
 * cuff plus three rows global to every cuff (combined slot-cost budget, item
 * count, and Hiden-cuff count -- see `buildModel`'s own docstring).
 */

import type { Highs, ModelData, ModelStatusCode, VariableType } from 'highs'
import { HIDEN_CUFF_CATEGORY } from './types'
import type {
  Candidate,
  Cuff,
  Decoration,
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

export interface CandidateColumn {
  readonly kind: 'candidate'
  readonly slotIndex: number
  readonly slotId: string
  readonly candidate: Candidate
}

export interface DecorationColumn {
  readonly kind: 'decoration'
  readonly slotIndex: number
  readonly slotId: string
  readonly decoration: Decoration
  /** How many copies of `decoration` this column places when chosen -- 0
   * means "none of this decoration," a valid, usually-necessary member of
   * its one-hot group (see this module's own docstring). */
  readonly count: number
}

/** One-hot-encoded exactly like `DecorationColumn` (see this module's own
 * docstring), but global rather than per-slot -- cuffs aren't placed into any
 * particular armor slot, they're drawn from one shared pool of at most
 * `MAX_EQUIPPED_CUFFS`. */
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

interface TierBreakpoints {
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
function resolveTierBreakpoints(
  skillTiers: readonly SkillTierThresholds[],
  requestedSkillIds: ReadonlySet<SkillId>,
): Map<SkillId, TierBreakpoints> {
  const breakpoints = new Map<SkillId, TierBreakpoints>()
  for (const { skillId, tierThresholds } of skillTiers) {
    if (requestedSkillIds.has(skillId)) continue

    const positives = tierThresholds.filter((t) => t > 0)
    const negatives = tierThresholds.filter((t) => t < 0)
    const posThreshold = positives.length > 0 ? Math.min(...positives) : undefined
    const negThreshold = negatives.length > 0 ? Math.max(...negatives) : undefined
    if (posThreshold !== undefined || negThreshold !== undefined) {
      breakpoints.set(skillId, { posThreshold, negThreshold })
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
 * unlike `pinnedCuffs`, *are* modeled as real columns: the matching
 * decoration-count column for each pinned slot/decoration/count is forced to
 * exactly 1 (its `colLower` raised to 1) instead of left free, while the
 * slot's own candidate and every other decoration stay fully solver-chosen.
 * This works because a decoration's placement already has no coupling to
 * which candidate fills the slot beyond the shared `capacityRow` -- forcing
 * one decoration-count column doesn't need the "narrow to one synthesized
 * candidate" trick pinned armor uses (TODO #7), and naturally still goes
 * infeasible via `capacityRow` if the pin can't fit any candidate the solver
 * could otherwise pick for that slot.
 */
export function buildModel(
  highs: Highs,
  slots: readonly SlotQuery[],
  decorations: readonly Decoration[],
  requirements: readonly SkillRequirement[],
  options: SearchOptions = {},
  cuffs: readonly Cuff[] = [],
): BuiltModel {
  const requestedSkillIds = new Set(requirements.map((r) => r.skillId))
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

  const cardinalityRow = (slotIndex: number): number => slotIndex
  const capacityRow = (slotIndex: number): number => numSlots + slotIndex

  let rowCursor = 2 * numSlots
  const groupRowOf: number[][] = slotDecorationGroups.map((group) => group.map(() => rowCursor++))
  const skillRowBase = rowCursor
  const skillRow = (requirementIndex: number): number => skillRowBase + requirementIndex
  const baseNumRows = skillRowBase + requirements.length

  // Tier machinery (see this function's own docstring) -- resolved before
  // row layout is finalized, since its row/column counts depend on which
  // bonus skills can actually reach one of their own tiers in this query.
  let tierMachinery: readonly TierMachinery[] = []
  if (preferExactMatches && options.skillTiers) {
    const breakpoints = resolveTierBreakpoints(options.skillTiers, requestedSkillIds)
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

  // Cuffs (see this function's own docstring): one one-hot group row per
  // cuff, plus two rows global to every cuff (not per-slot, since cuffs
  // aren't tied to an armor slot). Skipped entirely when there are no
  // relevant cuffs, same as tier machinery above when it's not needed.
  const cuffGroupRowOf: number[] = cuffs.map(() => rowCursor++)
  const cuffBudgetRow = cuffs.length > 0 ? rowCursor++ : -1
  const cuffCountRow = cuffs.length > 0 ? rowCursor++ : -1
  const cuffHidenCountRow = cuffs.length > 0 ? rowCursor++ : -1
  const numRows = rowCursor

  const rowLower = new Array<number>(numRows)
  const rowUpper = new Array<number>(numRows)
  for (let s = 0; s < numSlots; s++) {
    rowLower[cardinalityRow(s)] = 1
    rowUpper[cardinalityRow(s)] = 1
    rowLower[capacityRow(s)] = -highs.infinity
    rowUpper[capacityRow(s)] = 0
    for (const row of groupRowOf[s]) {
      rowLower[row] = 1
      rowUpper[row] = 1
    }
  }
  requirements.forEach((req, r) => {
    rowLower[skillRow(r)] = req.minPoints - pinnedPointsTowards(req.skillId)
    rowUpper[skillRow(r)] = highs.infinity
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
    for (const [row, value] of entries) {
      indices.push(row)
      values.push(value)
    }
    starts.push(indices.length)
  }

  slots.forEach((slot, s) => {
    for (const candidate of slot.candidates) {
      const capacity = candidate.openSlotCount ?? 0
      const entries = new Map<number, number>([[cardinalityRow(s), 1]])
      if (capacity !== 0) entries.set(capacityRow(s), -capacity)
      requirements.forEach((req, r) => {
        const points = pointsTowards(candidate.skills, req.skillId)
        if (points !== 0) entries.set(skillRow(r), points)
      })
      for (const m of tierMachinery) {
        const points = pointsTowards(candidate.skills, m.skillId)
        if (points !== 0) entries.set(totalRowOf.get(m.skillId)!, points)
      }

      columns.push({ kind: 'candidate', slotIndex: s, slotId: slot.slotId, candidate })
      const bonus = preferExactMatches ? 0 : bonusPointsOf(candidate.skills, requestedSkillIds)
      addColumn(OPEN_SLOT_WEIGHT * capacity + bonus, entries)
    }

    const pinnedCounts = pinnedSlotDecorationCounts.get(slot.slotId)

    slotDecorationGroups[s].forEach((decoration, groupIndex) => {
      const maxCapacity = slotMaxCapacity[s]
      const pinnedCount = pinnedCounts?.get(decoration.id) ?? 0
      const naturalMaxCount =
        maxCapacity > 0 && decoration.slotSize > 0
          ? Math.floor(maxCapacity / decoration.slotSize)
          : 0
      // At least as large as `pinnedCount` even when that exceeds what any
      // candidate here could actually hold -- see this function's own
      // comment above where `slotDecorationGroups` is built: the forced
      // column still needs to exist so `capacityRow` can correctly reject
      // it, rather than the pin having no column to enforce it at all.
      const maxCount = Math.max(naturalMaxCount, pinnedCount)
      const groupRow = groupRowOf[s][groupIndex]
      const decorationBonus = preferExactMatches
        ? 0
        : bonusPointsOf(decoration.skills, requestedSkillIds)

      for (let count = 0; count <= maxCount; count++) {
        const entries = new Map<number, number>([[groupRow, 1]])
        if (count > 0) {
          entries.set(capacityRow(s), count * decoration.slotSize)
          requirements.forEach((req, r) => {
            const points = pointsTowards(decoration.skills, req.skillId)
            if (points !== 0) entries.set(skillRow(r), count * points)
          })
          for (const m of tierMachinery) {
            const points = pointsTowards(decoration.skills, m.skillId)
            if (points !== 0) entries.set(totalRowOf.get(m.skillId)!, count * points)
          }
        }

        columns.push({ kind: 'decoration', slotIndex: s, slotId: slot.slotId, decoration, count })
        const cost =
          count === 0 ? 0 : count * (-OPEN_SLOT_WEIGHT * decoration.slotSize + decorationBonus)
        // Forces this exact count to be selected (combined with the
        // group row's "exactly one column chosen" constraint, every other
        // column in this group -- including "place none" -- is thereby
        // forced to 0, with no need to bound them individually).
        const forced = pinnedCount > 0 && count === pinnedCount
        addColumn(cost, entries, forced ? 1 : 0)
      }
    })
  })

  cuffs.forEach((cuff, i) => {
    // Bounded by MAX_EQUIPPED_CUFFS directly (not CUFF_SLOT_BUDGET /
    // cuff.slotSize) -- a free (slotSize === 0) cuff would otherwise divide
    // by zero, and no cuff could ever need a higher count than the item-count
    // limit allows regardless of its own cost.
    const maxCount = Math.min(MAX_EQUIPPED_CUFFS, Math.floor(CUFF_SLOT_BUDGET / cuff.slotSize))
    const groupRow = cuffGroupRowOf[i]
    const cuffBonus = preferExactMatches ? 0 : bonusPointsOf(cuff.skills, requestedSkillIds)

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
        for (const m of tierMachinery) {
          const points = pointsTowards(cuff.skills, m.skillId)
          if (points !== 0) entries.set(totalRowOf.get(m.skillId)!, count * points)
        }
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
      columns.push({ kind: 'auxiliary' })
      addColumn(-EXACT_MATCH_SKILL_PENALTY, new Map([[posIndicatorRowOf.get(m.skillId)!, -bigM]]))
    }
    if (m.needsNeg) {
      const bigM = m.negThreshold! + 1 - m.range.min
      columns.push({ kind: 'auxiliary' })
      addColumn(-EXACT_MATCH_SKILL_PENALTY, new Map([[negIndicatorRowOf.get(m.skillId)!, bigM]]))
    }
  }

  const model: ModelData = {
    numCols: columns.length,
    numRows,
    sense: highs.constants.objectiveSense.maximize,
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
 * outright -- they're bookkeeping, not a choice `BuildResult` cares about,
 * and (unlike every choice column) aren't even binary, so checking their
 * value against 0.5 would be meaningless. Every remaining column is binary,
 * so "chosen" is read as the value rounding above 0.5 (floating-point solver
 * output is never exactly 0/1). A chosen decoration or cuff column with
 * `count > 0` is expanded back into that many individual entries (matching
 * the old engine's flat `decorationsUsed` list -- duplicates allowed, and a
 * cuff can equally appear twice, confirmed allowed by the project owner);
 * `count === 0` ("none of this decoration/cuff") is a normal,
 * silently-skipped outcome, not a special case. */
export function decodeSolution(
  columns: readonly ColumnMeta[],
  colValue: ArrayLike<number>,
): BuildResultLike {
  const picks = new Map<string, Candidate>()
  const decorationsBySlot = new Map<string, Decoration[]>()
  const cuffsChosen: Cuff[] = []
  const skillTotals = new Map<SkillId, number>()

  function addSkills(skills: readonly SkillContribution[], times: number): void {
    for (const { skillId, points } of skills) {
      skillTotals.set(skillId, (skillTotals.get(skillId) ?? 0) + points * times)
    }
  }

  columns.forEach((column, j) => {
    if (column.kind === 'auxiliary') return
    if (colValue[j] <= 0.5) return

    if (column.kind === 'candidate') {
      picks.set(column.slotId, column.candidate)
      addSkills(column.candidate.skills, 1)
      return
    }

    if (column.count <= 0) return

    if (column.kind === 'cuff') {
      for (let i = 0; i < column.count; i++) cuffsChosen.push(column.cuff)
      addSkills(column.cuff.skills, column.count)
      return
    }

    const placed = decorationsBySlot.get(column.slotId) ?? []
    for (let i = 0; i < column.count; i++) placed.push(column.decoration)
    decorationsBySlot.set(column.slotId, placed)
    addSkills(column.decoration.skills, column.count)
  })

  return { picks, decorations: decorationsBySlot, cuffs: cuffsChosen, skillTotals }
}

export interface RowSpec {
  readonly lower: number
  readonly upper: number
  readonly indices: readonly number[]
  readonly values: readonly number[]
}

/**
 * A "no-good cut" forbidding the exact combination of chosen columns in
 * `colValue` from being re-selected -- the standard technique for getting a
 * ranked list of distinct results out of a MIP solver, which (unlike
 * commercial solvers) has no built-in solution pool: solve, cut out the
 * answer just found, re-solve (see `engine.ts`).
 *
 * This is the textbook binary no-good cut (`sum(previously chosen columns)
 * <= chosen count - 1`), valid here across every *choice* column --
 * candidate and decoration-count alike -- specifically because every choice
 * column is binary and every feasible solution picks exactly one column from
 * each cardinality, capacity-group, and decoration-group (see this module's
 * own docstring for why decoration counts are one-hot-encoded for exactly
 * this reason). A general bounded-integer column would need auxiliary
 * variables and big-M rows per excluded value to forbid just one count
 * without also forbidding every other value on one side of it -- the
 * one-hot encoding avoids that entirely, at the cost of a few extra columns
 * up front. Auxiliary columns (see this module's own docstring) are skipped
 * outright: they're a deterministic function of the choice columns, so
 * forbidding the choice combination that produced them already forbids them
 * from recurring too, without needing to name them in the cut.
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
    if (column.kind === 'auxiliary') return
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
