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
  /** Sizes of this candidate's open decoration slots, e.g. `[3, 1]`. Omitted
   * or empty means no open slots. */
  readonly openSlots?: readonly number[]
}

export interface Decoration {
  readonly id: string
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
   * Only present for slots whose candidate has `openSlots` and at least one
   * decoration was placed. */
  readonly decorations: ReadonlyMap<string, readonly Decoration[]>
  /** Summed skill points across all picks and placed decorations, keyed by
   * `skillId`. */
  readonly skillTotals: ReadonlyMap<SkillId, number>
  /**
   * Sum, over every requested skill, of (achieved points - required
   * points). Always >= 0 for a result that satisfies every requirement.
   * Higher surplus is ranked first (see docs/PLAN.md §6 step 5) -- it
   * reflects "most room to spare," not any particular skill's priority.
   */
  readonly surplus: number
}
