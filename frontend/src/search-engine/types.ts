/**
 * Core types for the build search engine (see docs/PLAN.md §6-7).
 *
 * Deliberately abstract over the real MHF slot taxonomy (head/chest/arms/
 * waist/legs/weapon/charm) -- this module doesn't know or care what a
 * `slotId` represents, only that each slot in a query is filled by exactly
 * one of its candidates. Phase 4 maps the real equipment data onto these
 * shapes; this module is validated against small synthetic datasets first
 * per the Phase 3 plan.
 */

export type SkillId = number

export interface SkillRequirement {
  readonly skillId: SkillId
  readonly minPoints: number
}

export interface SkillContribution {
  readonly skillId: SkillId
  readonly points: number
}

export interface Candidate {
  readonly id: string
  readonly skills: readonly SkillContribution[]
  /** Total count of open decoration slots on this piece. Slots are plain,
   * interchangeable units (confirmed by the project owner) -- a piece's slot
   * count is not a list of individually-sized slots. Omitted or 0 means no
   * open slots. */
  readonly openSlotCount?: number
}

export interface Decoration {
  readonly id: string
  /** Number of a piece's open slot units this decoration consumes (1-3),
   * confirmed by the project owner. A decoration fits a piece as long as the
   * summed slotSize of everything placed in it doesn't exceed the piece's
   * openSlotCount. */
  readonly slotSize: number
  readonly skills: readonly SkillContribution[]
}

export interface SlotQuery {
  readonly slotId: string
  readonly candidates: readonly Candidate[]
}

/** Shaped identically to `Decoration` (id, slotSize, skills) -- see
 * etl/src/etl/export.py's `_export_cuffs` -- but spent from a wholly separate
 * "Poogie slot" budget shared across at most 2 equipped cuffs, not an armor
 * piece's own open slots (confirmed by the project owner; see
 * docs/data-format-notes.md's "Cuffs" section). Kept as its own alias rather
 * than used as `Decoration` directly so a call site reads correctly even
 * though the shapes match today. */
export type Cuff = Decoration

export interface SkillTierThresholds {
  readonly skillId: SkillId
  /** Every point threshold that activates one of this skill's tiers, in any
   * order -- some are negative (a penalty tier, e.g. "-10"), most are
   * positive. Mirrors `skills.json`'s `tiers[].minPoints` (see
   * `load-bundle.ts`'s `SkillTierRecord`), without the display-only label
   * and description `ilp-model.ts` has no use for. */
  readonly tierThresholds: readonly number[]
}

export interface SearchOptions {
  /** When true, changes the ranking tie-break (see `ilp-model.ts`'s
   * `buildModel`) from rewarding unrequested ("bonus") skill points to
   * penalizing *builds that activate a bonus skill's tier at all* --
   * reaching 9 points of a skill nobody asked for is harmless (it does
   * nothing in-game), but 10 might turn on a real, possibly unwanted effect
   * (including a negative one, e.g. a "-10" penalty tier). Off by default to
   * preserve existing ranking behavior; a build that already needs bonus
   * points to meet a requirement is unaffected either way, since
   * requirements are hard constraints, not objective terms. */
  readonly preferExactMatches?: boolean
  /** Every requestable skill's tier thresholds, used only when
   * `preferExactMatches` is set so the engine can tell a harmless incidental
   * point or two apart from a threshold actually crossed. A skill left out
   * here (or this left undefined entirely) is simply never penalized --
   * "unknown" defaults to "assume harmless," not "assume bad." */
  readonly skillTiers?: readonly SkillTierThresholds[]
}

export interface BuildResult {
  /** One chosen candidate per slot, keyed by `slotId`. */
  readonly picks: ReadonlyMap<string, Candidate>
  /** Decorations placed into each pick's open slots, keyed by `slotId`.
   * Only present for slots whose candidate has `openSlotCount` and at least
   * one decoration was placed. */
  readonly decorations: ReadonlyMap<string, readonly Decoration[]>
  /** Cuffs equipped by this build, 0-2 entries (duplicates allowed -- the
   * same cuff can fill both of a build's two cuff slots). Flat, not keyed by
   * slot, since cuffs aren't tied to any armor slot -- see `Cuff`. Empty when
   * no cuffs were offered to the search at all, not just when none helped. */
  readonly cuffs: readonly Cuff[]
  /** Summed skill points across all picks, placed decorations, and equipped
   * cuffs, keyed by `skillId`. */
  readonly skillTotals: ReadonlyMap<SkillId, number>
}
