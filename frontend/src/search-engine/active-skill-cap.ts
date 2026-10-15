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
 *
 * One exemption (confirmed by the project owner, 2026-10-15): a "Hiden/Tech
 * Skills"-category skill (e.g. "SnS Tech") doesn't count against the cap at
 * all -- doesn't consume one of its slots, and is never itself a candidate
 * for being force-disabled -- when a cuff is what's contributing to it. A
 * Hiden skill reached purely through armor/decorations has no such
 * exemption and is capped normally.
 */

import type { NamedCandidate, NamedCuff, NamedSkill } from './load-bundle'
import type { SkillId } from './types'

const HIDEN_SKILL_CATEGORY = 'Hiden/Tech Skills'

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
  /** Every active normal skill id, most-protected first -- any Hiden/cuff
   * exemptions (see this module's own docstring) always sort first, since
   * they're never force-disabled regardless of `cap`; the rest are in
   * priority order the same as before this exemption existed. Not simply "a
   * prefix of this list up to `cap` is what's active" anymore once an
   * exemption exists, since an exempted skill doesn't consume a cap slot --
   * use `disabled` to know what's actually force-disabled. */
  readonly rankedActive: readonly SkillId[]
  /** Every id in `rankedActive` that's force-disabled by the cap. Empty when
   * the build's non-exempt active-skill count doesn't exceed its cap. */
  readonly disabled: readonly SkillId[]
}

/** An unranked skill (never matched a row on the priority source page) is
 * sorted after every ranked skill -- first to go once the cap is exceeded,
 * same as `skill_priority.py`'s own module docstring describes for a skill
 * "absent from this table." */
const UNRANKED_SORT_RANK = Number.POSITIVE_INFINITY

/** Every normal skill id a build's equipped cuffs contribute any (nonzero)
 * points towards -- used only to find this module's own Hiden-skill cap
 * exemption (see its docstring); a skill a cuff contributes to is still
 * capped normally unless it's also in the Hiden/Tech category. */
function cuffContributedSkillIds(cuffs: readonly NamedCuff[]): ReadonlySet<SkillId> {
  const ids = new Set<SkillId>()
  for (const cuff of cuffs) {
    for (const { skillId, points } of cuff.skills) {
      if (points !== 0) ids.add(skillId)
    }
  }
  return ids
}

/** Determines which of a build's active normal skills survive its
 * active-skill cap, and which get force-disabled -- see this module's own
 * docstring, including the Hiden/cuff exemption. `skillTotals` is the
 * build's full combined point totals (`BuildResult.skillTotals`, spanning
 * both normal and Zenith skill ids -- see load-bundle.ts's `DataBundle`
 * docstring); only the entries matching an id in `skills` (the normal-skill
 * catalog) are considered, since Zenith skills are a wholly separate,
 * unaffected pool. `cuffs` is the build's equipped cuffs (`BuildResult.cuffs`
 * -- omitted defaults to none, so every existing call site without a cuff
 * exemption to apply still behaves exactly as before). */
export function determineActiveSkills(
  picks: ReadonlyMap<string, NamedCandidate>,
  skillTotals: ReadonlyMap<SkillId, number>,
  skills: readonly NamedSkill[],
  zenithSkills: readonly NamedSkill[],
  cuffs: readonly NamedCuff[] = [],
): SkillActivationResult {
  const skillsById = new Map(skills.map((s) => [s.id, s]))
  const cap = computeActiveSkillCap(picks, skillTotals, zenithSkills)
  const cuffSkillIds = cuffContributedSkillIds(cuffs)

  const active = [...skillTotals.entries()]
    .filter(([skillId]) => skillsById.has(skillId))
    .filter(([skillId, points]) => isSkillActive(points, skillsById.get(skillId)))

  const isCapExempt = (skillId: SkillId): boolean =>
    skillsById.get(skillId)?.category === HIDEN_SKILL_CATEGORY && cuffSkillIds.has(skillId)

  const exempt = active.map(([skillId]) => skillId).filter(isCapExempt)
  const rankedCapped = active
    .map(([skillId]) => skillId)
    .filter((skillId) => !isCapExempt(skillId))
    .sort((a, b) => {
      const rankA = skillsById.get(a)?.priorityRank ?? UNRANKED_SORT_RANK
      const rankB = skillsById.get(b)?.priorityRank ?? UNRANKED_SORT_RANK
      return rankA - rankB
    })

  return {
    cap,
    rankedActive: [...exempt, ...rankedCapped],
    disabled: rankedCapped.slice(cap),
  }
}
