/**
 * The game caps how many *distinct normal skills* can be simultaneously
 * active on one build (see docs/skill-system-roadmap.md TODO #1, citing
 * https://mertna.github.io/MHFZ-Skills/?skills=Priority): a base of 10,
 * +1/+2 more for a build using >=3/>=5 G-Rank-or-later armor pieces, and
 * +1 per stacked level of the Zenith skill "Skill Slots Up" (up to +7,
 * theoretical max 19). Once a build's active normal-skill count would
 * exceed that cap, the lowest-priority ones (per the same page's
 * activation-priority table, see etl's `load_skill_priority`) are
 * force-disabled first. Scope is normal skills only -- Zenith skills are a
 * wholly separate pool, never subject to this cap.
 */

import type { NamedCandidate, NamedSkill } from './load-bundle'
import type { SkillId } from './types'

const BASE_ACTIVE_SKILL_CAP = 10
const SKILL_SLOTS_UP_ZENITH_SKILL_NAME = 'Skill Slots Up'
const MAX_SKILL_SLOTS_UP_BONUS = 7

function grankSetBonus(grankPieceCount: number): number {
  if (grankPieceCount >= 5) return 2
  if (grankPieceCount >= 3) return 1
  return 0
}

/** Counts how many of a build's picks are "G Rank or later" for the in-game
 * "3/5 G-Rank-or-later pieces (including Z, ZF, ZY, ZP and ZX)" piece-
 * counting rule -- see `NamedCandidate.grankOrLater`'s own docstring for why
 * this can't be derived from `category` alone (several display categories,
 * e.g. every "Paid and Premium" one, mix below-G-rank and G-Rank-or-later
 * pieces together). The weapon slot's synthesized candidates are never
 * G-Rank-or-later (a weapon has no such concept here), so they fall out of
 * this count naturally. */
export function countGrankOrLaterPieces(picks: ReadonlyMap<string, NamedCandidate>): number {
  let count = 0
  for (const candidate of picks.values()) {
    if (candidate.grankOrLater) count++
  }
  return count
}

/** The active-skill cap for one build: 10, plus the G-Rank-or-later armor
 * piece-count bonus, plus the build's "Skill Slots Up" Zenith skill level
 * (capped at +7). `skillTotals` is the build's full combined point totals
 * (`BuildResult.skillTotals`, spanning both normal and Zenith skill ids --
 * see load-bundle.ts's `DataBundle` docstring), and `zenithSkills` is the
 * catalog used to resolve "Skill Slots Up" by name to its id within it. */
export function computeActiveSkillCap(
  picks: ReadonlyMap<string, NamedCandidate>,
  skillTotals: ReadonlyMap<SkillId, number>,
  zenithSkills: readonly NamedSkill[],
): number {
  const grankBonus = grankSetBonus(countGrankOrLaterPieces(picks))
  const skillSlotsUpId = zenithSkills.find(
    (s) => s.name === SKILL_SLOTS_UP_ZENITH_SKILL_NAME,
  )?.id
  const skillSlotsUpLevel = skillSlotsUpId !== undefined ? (skillTotals.get(skillSlotsUpId) ?? 0) : 0
  const skillSlotsUpBonus = Math.min(skillSlotsUpLevel, MAX_SKILL_SLOTS_UP_BONUS)
  return BASE_ACTIVE_SKILL_CAP + grankBonus + skillSlotsUpBonus
}

/** Whether a skill's accumulated points would turn on one of its named
 * tiers at all -- mirrors `ilp-model.ts`'s own tier-crossing convention
 * (smallest positive threshold / largest, closest-to-zero negative
 * threshold are the only two that matter, since same-side tiers nest). A
 * skill with no tier data at all (untiered) falls back to "any positive
 * points," since a flat point value with no named tier still represents an
 * in-game effect once it's non-zero. */
export function isSkillActive(points: number, skill: NamedSkill | undefined): boolean {
  if (points === 0) return false
  const tiers = skill?.tiers ?? []
  const positives = tiers.filter((t) => t.minPoints > 0).map((t) => t.minPoints)
  const negatives = tiers.filter((t) => t.minPoints < 0).map((t) => t.minPoints)
  if (positives.length === 0 && negatives.length === 0) return points > 0
  const posThreshold = positives.length > 0 ? Math.min(...positives) : undefined
  const negThreshold = negatives.length > 0 ? Math.max(...negatives) : undefined
  return (
    (posThreshold !== undefined && points >= posThreshold) ||
    (negThreshold !== undefined && points <= negThreshold)
  )
}

export interface SkillActivationResult {
  readonly cap: number
  /** Active skill ids in priority order (most-protected first) -- a prefix
   * of this list, up to `cap`, is what actually takes effect in-game. */
  readonly rankedActive: readonly SkillId[]
  /** The subset of `rankedActive` beyond `cap`, force-disabled by the game.
   * Empty when the build's active-skill count doesn't exceed its cap. */
  readonly disabled: readonly SkillId[]
}

/** An unranked skill (never matched a row on the priority source page) is
 * sorted after every ranked skill -- first to go once the cap is exceeded,
 * same as `skill_priority.py`'s own module docstring describes for a skill
 * "absent from this table." */
const UNRANKED_SORT_RANK = Number.POSITIVE_INFINITY

/** Determines which of a build's active normal skills survive its
 * active-skill cap, and which get force-disabled -- see this module's own
 * docstring. `skillTotals` is the build's full combined point totals
 * (`BuildResult.skillTotals`, spanning both normal and Zenith skill ids --
 * see load-bundle.ts's `DataBundle` docstring); only the entries matching an
 * id in `skills` (the normal-skill catalog) are considered, since Zenith
 * skills are a wholly separate, unaffected pool. */
export function determineActiveSkills(
  picks: ReadonlyMap<string, NamedCandidate>,
  skillTotals: ReadonlyMap<SkillId, number>,
  skills: readonly NamedSkill[],
  zenithSkills: readonly NamedSkill[],
): SkillActivationResult {
  const skillsById = new Map(skills.map((s) => [s.id, s]))
  const cap = computeActiveSkillCap(picks, skillTotals, zenithSkills)

  const active = [...skillTotals.entries()]
    .filter(([skillId]) => skillsById.has(skillId))
    .filter(([skillId, points]) => isSkillActive(points, skillsById.get(skillId)))
  const rankedActive = active
    .map(([skillId]) => skillId)
    .sort((a, b) => {
      const rankA = skillsById.get(a)?.priorityRank ?? UNRANKED_SORT_RANK
      const rankB = skillsById.get(b)?.priorityRank ?? UNRANKED_SORT_RANK
      return rankA - rankB
    })

  return {
    cap,
    rankedActive,
    disabled: rankedActive.slice(cap),
  }
}
