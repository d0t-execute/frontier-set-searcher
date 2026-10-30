/**
 * The active-skill cap's own numbers and per-piece rules, shared by
 * `active-skill-cap.ts` (which applies the cap to a finished build) and
 * `ilp-model.ts` (which models it as a constraint) -- kept separate from both
 * so neither has to import the other. See `active-skill-cap.ts`'s module
 * docstring for the game rules these encode.
 */

import type { Candidate } from './types'

export const BASE_ACTIVE_SKILL_CAP = 10
export const MAX_SKILL_SLOTS_UP_BONUS = 7

/** G-Rank-or-later piece counts that each add one to the cap: 3 pieces for
 * +1, 5 for +2. */
export const GRANK_BONUS_PIECE_THRESHOLDS = [3, 5] as const

/** Origin armor's category key (gear-categories.ts) -- excluded from the
 * G-Rank-or-later piece-count bonus; see `active-skill-cap.ts`'s docstring. */
export const ORIGIN_CATEGORY = 'grank_origin'

export function grankSetBonus(grankPieceCount: number): number {
  return GRANK_BONUS_PIECE_THRESHOLDS.filter((threshold) => grankPieceCount >= threshold).length
}

/** Whether a piece counts toward the G-Rank-or-later piece-count bonus. */
export function countsTowardGrankBonus(candidate: Candidate): boolean {
  return candidate.grankOrLater === true && candidate.category !== ORIGIN_CATEGORY
}

/** Whether a skill total turns on one of its tiers -- smallest positive /
 * largest negative threshold, untiered skills on any positive total. See
 * `active-skill-cap.ts`'s `isSkillActive`, which delegates here. */
export function isActiveAt(points: number, tierThresholds: readonly number[]): boolean {
  if (points === 0) return false
  const positives = tierThresholds.filter((t) => t > 0)
  const negatives = tierThresholds.filter((t) => t < 0)
  if (positives.length === 0 && negatives.length === 0) return points > 0
  return (
    (positives.length > 0 && points >= Math.min(...positives)) ||
    (negatives.length > 0 && points <= Math.max(...negatives))
  )
}
