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

export interface BuildResult {
  /** One chosen candidate per slot, keyed by `slotId`. */
  readonly picks: ReadonlyMap<string, Candidate>
  /** Decorations placed into each pick's open slots, keyed by `slotId`.
   * Only present for slots whose candidate has `openSlotCount` and at least
   * one decoration was placed. */
  readonly decorations: ReadonlyMap<string, readonly Decoration[]>
  /** Summed skill points across all picks and placed decorations, keyed by
   * `skillId`. */
  readonly skillTotals: ReadonlyMap<SkillId, number>
}
