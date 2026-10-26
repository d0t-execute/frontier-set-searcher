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
 *
 * A second, unconditional exemption (confirmed by the project owner,
 * 2026-10-15): a skill granted by an Exotic-armor piece (see
 * docs/skill-system-roadmap.md TODO #3) never counts against the cap
 * either, regardless of category -- equipping e.g. any Barioth piece always
 * grants "Ice Attack" on top of the cap.
 *
 * A carve-out on the G-Rank-or-later piece-count bonus itself (confirmed by
 * the project owner, docs/feedback.md Round 2 #5, 2026-10-19): an Origin
 * piece (category `grank_origin`) is G-Rank-or-later for every other purpose
 * (`NamedCandidate.grankOrLater` stays `true`, category filtering is
 * unaffected), but does NOT carry the inherent bonus-skill-cap capability
 * other G-Rank-or-later gear does -- it doesn't count toward the 3/5-piece
 * threshold above. Treated as if it were below G-Rank for this one count.
 */

import { MAX_EQUIPPED_CUFFS } from './ilp-model'
import type { NamedCandidate, NamedCuff, NamedSkill, NamedSlotQuery } from './load-bundle'
import type { SkillId, SkillRequirement } from './types'

/** Exported for `SkillPicker.tsx`, which pins skills in this category to the
 * top of the requirement list and labels them with this same cuff-only
 * exemption rule (see `isCapExempt` below) -- kept as a single shared
 * constant rather than a duplicated string literal so the two stay in sync. */
export const HIDEN_SKILL_CATEGORY = 'Hiden/Tech Skills'

/** Origin armor's category key (gear-categories.ts) -- excluded from the
 * G-Rank-or-later piece-count bonus; see this module's docstring. */
const ORIGIN_CATEGORY = 'grank_origin'

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
 * this count naturally. Origin pieces are excluded even though they're
 * `grankOrLater: true` -- see this module's own docstring. */
export function countGrankOrLaterPieces(picks: ReadonlyMap<string, NamedCandidate>): number {
  let count = 0
  for (const candidate of picks.values()) {
    if (candidate.grankOrLater && candidate.category !== ORIGIN_CATEGORY) count++
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
  const skillSlotsUpId = zenithSkills.find((s) => s.name === SKILL_SLOTS_UP_ZENITH_SKILL_NAME)?.id
  const skillSlotsUpLevel =
    skillSlotsUpId !== undefined ? (skillTotals.get(skillSlotsUpId) ?? 0) : 0
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

/** Every normal skill id at least one of a build's picks grants via its
 * Exotic-armor bonus (`NamedCandidate.exoticSkillId`) -- used only to find
 * this module's own Exotic-skill cap exemption (see its docstring). */
function exoticGrantedSkillIds(picks: ReadonlyMap<string, NamedCandidate>): ReadonlySet<SkillId> {
  const ids = new Set<SkillId>()
  for (const candidate of picks.values()) {
    if (candidate.exoticSkillId !== null) ids.add(candidate.exoticSkillId)
  }
  return ids
}

/** One equip position this preview considers for Zenith-skill purposes (an
 * armor slot, the weapon slot, or one of the `MAX_EQUIPPED_CUFFS` cuff
 * slots) -- see `previewActiveSkillCap`'s own docstring for the model this
 * supports. `guaranteed` positions (exactly one possible candidate, whether
 * because the player pinned it or because filtering narrowed it to one) grant
 * everything they have at once, with no tradeoff to make; a non-guaranteed
 * position still has a real choice to make among its candidates, so using it
 * for one purpose (satisfying a selected skill) forgoes using it for another
 * (Skill Slots Up) -- see `allocateSkillSlotsUp`. `skillSet`/`maxSsu` are
 * computed independently per position (the union of every candidate's
 * grants, not tied to one specific candidate) -- a harmless simplification
 * given this game's own gear never grants more than one Zenith skill per
 * piece, so a candidate satisfying a selected skill essentially never also
 * carries Skill Slots Up in the first place. */
interface ZenithPosition {
  readonly guaranteed: boolean
  readonly skillSet: ReadonlySet<SkillId>
  readonly maxSsu: number
}

function skillSetAndMaxSsu(
  candidates: readonly { readonly skills: readonly { skillId: SkillId; points: number }[] }[],
  skillSlotsUpId: SkillId | undefined,
): { skillSet: ReadonlySet<SkillId>; maxSsu: number } {
  const skillSet = new Set<SkillId>()
  let maxSsu = 0
  for (const candidate of candidates) {
    for (const { skillId, points } of candidate.skills) {
      if (points <= 0) continue
      if (skillId === skillSlotsUpId) {
        if (points > maxSsu) maxSsu = points
      } else {
        skillSet.add(skillId)
      }
    }
  }
  return { skillSet, maxSsu }
}

/** Every real armor slot plus the weapon slot, each as one `ZenithPosition`
 * -- `slots` is already pin/filter-resolved (`build-query.ts`'s
 * `buildSearchQuery`), so a pinned slot naturally has exactly one candidate
 * and falls out of this as `guaranteed` with no special-casing needed. */
function positionsFromSlots(
  slots: readonly NamedSlotQuery[],
  skillSlotsUpId: SkillId | undefined,
): ZenithPosition[] {
  return slots.map((slot) => ({
    guaranteed: slot.candidates.length <= 1,
    ...skillSetAndMaxSsu(slot.candidates, skillSlotsUpId),
  }))
}

/** Cuffs collectively ever carry at most this many Zenith skill points in one
 * build (confirmed by the project owner, 2026-10-19) -- unlike normal skills,
 * where both of `MAX_EQUIPPED_CUFFS`'s slots pull independent weight, only
 * one of the two can ever end up being the one Zenith-capable cuff. */
const MAX_CUFF_ZENITH_POINTS = 1

/** Whether any of `cuffs` grants at least one point of an actual Zenith
 * skill (`zenithSkillIds`, including Skill Slots Up itself) -- used only to
 * tell whether a pinned cuff has already spent the build's one shared
 * Zenith-cuff opportunity (see `MAX_CUFF_ZENITH_POINTS`). Deliberately
 * narrower than `skillSetAndMaxSsu`'s own `skillSet` (which also picks up
 * normal-skill grants, harmless for matching against `neededSkillCounts`
 * since normal- and Zenith-skill ids never collide, but wrong here -- a cuff
 * pinned for a normal skill alone hasn't used the Zenith budget at all). */
function cuffGrantsAnyZenithSkill(
  cuffs: readonly NamedCuff[],
  zenithSkillIds: ReadonlySet<SkillId>,
): boolean {
  return cuffs.some((c) => c.skills.some((s) => s.points > 0 && zenithSkillIds.has(s.skillId)))
}

/** The cuffs' total Zenith contribution, as at most one `ZenithPosition` --
 * see `MAX_CUFF_ZENITH_POINTS`'s own docstring for why this is 1 position,
 * not one per `MAX_EQUIPPED_CUFFS` slot. An exact-id pin (`pinnedCuffs`) is
 * `guaranteed` (that one cuff's own grants, no choice); a by-skill pin
 * (`pinnedCuffSkillIds`) already guarantees its pinned skill regardless of
 * which matching cuff variant ends up equipped (so that skill is folded into
 * `skillSet` unconditionally), but which variant still determines its Skill
 * Slots Up contribution -- modeled as `guaranteed` too, using the single
 * best-case `maxSsu` among cuffs granting that skill, since there's no
 * remaining tradeoff once the skill itself is locked in by the pin. If none
 * of the pins actually use a Zenith skill (`cuffGrantsAnyZenithSkill`), the
 * one Zenith-capable cuff is still up for grabs -- a single free,
 * non-`guaranteed` position drawing from the shared, unpinned `cuffs` pool --
 * unless both physical cuff slots are already pinned to something else
 * (zenith or not), leaving no slot left to put it in. */
function positionsFromCuffs(
  cuffs: readonly NamedCuff[],
  pinnedCuffs: readonly NamedCuff[],
  pinnedCuffSkillIds: readonly SkillId[],
  skillSlotsUpId: SkillId | undefined,
  zenithSkillIds: ReadonlySet<SkillId>,
): ZenithPosition[] {
  const positions: ZenithPosition[] = []
  let pinUsesZenithSkill = false
  for (const cuff of pinnedCuffs) {
    positions.push({ guaranteed: true, ...skillSetAndMaxSsu([cuff], skillSlotsUpId) })
    if (cuffGrantsAnyZenithSkill([cuff], zenithSkillIds)) pinUsesZenithSkill = true
  }
  for (const skillId of pinnedCuffSkillIds) {
    const matchingCuffs = cuffs.filter((c) =>
      c.skills.some((s) => s.skillId === skillId && s.points > 0),
    )
    const { maxSsu } = skillSetAndMaxSsu(matchingCuffs, skillSlotsUpId)
    const skillSet = skillId === skillSlotsUpId ? new Set<SkillId>() : new Set([skillId])
    positions.push({ guaranteed: true, skillSet, maxSsu })
    if (zenithSkillIds.has(skillId)) pinUsesZenithSkill = true
  }
  const pinnedPhysicalSlots = pinnedCuffs.length + pinnedCuffSkillIds.length
  const zenithCuffBudgetUsed = pinUsesZenithSkill ? MAX_CUFF_ZENITH_POINTS : 0
  const noPhysicalSlotLeft = pinnedPhysicalSlots >= MAX_EQUIPPED_CUFFS
  const freeZenithCuffPositions = noPhysicalSlotLeft
    ? 0
    : MAX_CUFF_ZENITH_POINTS - zenithCuffBudgetUsed
  const freeCuffCapability = skillSetAndMaxSsu(cuffs, skillSlotsUpId)
  for (let i = 0; i < freeZenithCuffPositions; i++) {
    positions.push({ guaranteed: false, ...freeCuffCapability })
  }
  return positions
}

/** The most Skill Slots Up points achievable across every position, after
 * reserving whatever's needed to still satisfy `neededSkillCounts` (every
 * selected Zenith requirement besides Skill Slots Up itself, keyed by its
 * `minPoints`) -- see `previewActiveSkillCap`'s own docstring for why this,
 * not a flat sum, is what the feedback actually asked for. A single piece
 * only ever grants 1 point of a given Zenith skill (confirmed by the project
 * owner, 2026-10-19), so a requirement of N points needs N *separate*
 * positions dedicated to it, not just one. A `guaranteed` position
 * contributes its `maxSsu` unconditionally (it has nothing else competing for
 * it) and also counts 1 point towards any of `neededSkillCounts` in its
 * `skillSet` for free, before any matching happens. Every remaining
 * (non-guaranteed) position then has a real choice to make: used to grant one
 * more point of one still-unmet skill (contributing 0 Skill Slots Up), or
 * left free to contribute its `maxSsu`. Matches most-constrained skills first
 * (fewest candidate positions relative to how many points they still need),
 * each claiming whichever of its available positions has the *lowest*
 * `maxSsu` -- a greedy heuristic (not a true max-weight bipartite match),
 * good enough given this is a preview, not the actual solver (`ilp-model.ts`
 * computes the real, exact result for an actual build). */
function allocateSkillSlotsUp(
  positions: readonly ZenithPosition[],
  neededSkillCounts: ReadonlyMap<SkillId, number>,
): number {
  let guaranteedSsu = 0
  const stillNeeded = new Map(neededSkillCounts)
  const freePositions: { skillSet: ReadonlySet<SkillId>; maxSsu: number }[] = []
  for (const position of positions) {
    if (!position.guaranteed) {
      freePositions.push(position)
      continue
    }
    guaranteedSsu += position.maxSsu
    for (const skillId of position.skillSet) {
      const remaining = stillNeeded.get(skillId)
      if (remaining === undefined) continue
      if (remaining <= 1) stillNeeded.delete(skillId)
      else stillNeeded.set(skillId, remaining - 1)
    }
  }

  const claimed = new Set<number>()
  const countFor = (skillId: SkillId) => freePositions.filter((p) => p.skillSet.has(skillId)).length
  const order = [...stillNeeded.keys()].sort(
    (a, b) => countFor(a) / stillNeeded.get(a)! - countFor(b) / stillNeeded.get(b)!,
  )
  for (const skillId of order) {
    let remaining = stillNeeded.get(skillId)!
    while (remaining > 0) {
      let bestIndex = -1
      for (let i = 0; i < freePositions.length; i++) {
        if (claimed.has(i) || !freePositions[i].skillSet.has(skillId)) continue
        if (bestIndex === -1 || freePositions[i].maxSsu < freePositions[bestIndex].maxSsu)
          bestIndex = i
      }
      if (bestIndex === -1) break
      claimed.add(bestIndex)
      remaining--
    }
  }

  const achievableSsu = freePositions.reduce(
    (sum, p, i) => sum + (claimed.has(i) ? 0 : p.maxSsu),
    0,
  )
  return Math.min(guaranteedSsu + achievableSsu, MAX_SKILL_SLOTS_UP_BONUS)
}

/** The best achievable active-skill cap for the player's *current
 * selection* -- shown before running an actual search (docs/feedback.md
 * Round 2 #4). Not "what cap does my current gear/pins already lock in,"
 * but "how high could the cap still go from here" (confirmed by the project
 * owner, 2026-10-19, after the first version of this conflated the two):
 * with 7 Zenith-capable positions and nothing selected yet, this is 19 (10
 * base + 2 G-Rank + 7 Skill Slots Up), since every one of those positions
 * *could* still end up being Skill Slots Up; selecting 5 other Zenith skills
 * drops that to 14, since each needs a position of its own, leaving only 2
 * free for Skill Slots Up; pinning 2 cuffs to specific non-Skill-Slots-Up
 * cuffs removes those 2 positions from play entirely, dropping the ceiling
 * further.
 *
 * `slots`/`cuffs`/`pinnedCuffs`/`pinnedCuffSkillIds` are `BuiltQuery`'s own
 * resolved fields (`build-query.ts`'s `buildSearchQuery`), so this
 * automatically honors every existing category/id exclusion, pin, and
 * Hunter Type filter with no separate filtering logic of its own.
 * Decorations are never a source here -- they don't grant Zenith skills.
 *
 * The G-Rank-or-later piece-count bonus is approximated per real armor slot
 * (the virtual `weapon` slot excluded, same as `countGrankOrLaterPieces`):
 * a slot counts toward the 3/5 threshold if *any* currently-eligible
 * candidate in it is G-Rank-or-later (excluding Origin pieces, same
 * carve-out as this module's own docstring) -- independent of which
 * position ends up granting a Zenith skill or Skill Slots Up, since a piece
 * can be both G-Rank-or-later and Zenith at once.
 *
 * The Skill Slots Up bonus is `allocateSkillSlotsUp`'s own result: every
 * *other* selected Zenith requirement (never the player's own explicit
 * Skill Slots Up selection, if any -- that's an outcome of this computation,
 * not an input to it: asking for a specific Skill Slots Up amount doesn't
 * reserve a position for it any differently than not asking at all) is
 * assumed to need `minPoints` dedicated positions among the current
 * Zenith-capable ones -- a single piece only ever grants 1 point of a given
 * Zenith skill (confirmed by the project owner, 2026-10-19), so e.g. a
 * "Stylish Assault Up +2" requirement reserves 2 positions, not 1 -- and
 * whatever's left over is the most Skill Slots Up this selection could still
 * reach, capped at `MAX_SKILL_SLOTS_UP_BONUS` same as a real build. */
export function previewActiveSkillCap(
  slots: readonly NamedSlotQuery[],
  cuffs: readonly NamedCuff[],
  pinnedCuffs: readonly NamedCuff[],
  pinnedCuffSkillIds: readonly SkillId[],
  zenithRequirements: readonly SkillRequirement[],
  zenithSkills: readonly NamedSkill[],
): number {
  const grankEligibleSlotCount = slots.filter(
    (slot) =>
      slot.slotId !== 'weapon' &&
      slot.candidates.some((c) => c.grankOrLater && c.category !== ORIGIN_CATEGORY),
  ).length
  const grankBonus = grankSetBonus(grankEligibleSlotCount)

  const skillSlotsUpId = zenithSkills.find((s) => s.name === SKILL_SLOTS_UP_ZENITH_SKILL_NAME)?.id
  const zenithSkillIds = new Set(zenithSkills.map((s) => s.id))
  const neededSkillCounts = new Map<SkillId, number>()
  for (const requirement of zenithRequirements) {
    if (requirement.skillId === skillSlotsUpId) continue
    const existing = neededSkillCounts.get(requirement.skillId) ?? 0
    neededSkillCounts.set(requirement.skillId, Math.max(existing, requirement.minPoints))
  }
  const positions = [
    ...positionsFromSlots(slots, skillSlotsUpId),
    ...positionsFromCuffs(cuffs, pinnedCuffs, pinnedCuffSkillIds, skillSlotsUpId, zenithSkillIds),
  ]
  const skillSlotsUpBonus = allocateSkillSlotsUp(positions, neededSkillCounts)

  return BASE_ACTIVE_SKILL_CAP + grankBonus + skillSlotsUpBonus
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
  const exoticSkillIds = exoticGrantedSkillIds(picks)

  const active = [...skillTotals.entries()]
    .filter(([skillId]) => skillsById.has(skillId))
    .filter(([skillId, points]) => isSkillActive(points, skillsById.get(skillId)))

  const isCapExempt = (skillId: SkillId): boolean =>
    (skillsById.get(skillId)?.category === HIDEN_SKILL_CATEGORY && cuffSkillIds.has(skillId)) ||
    exoticSkillIds.has(skillId)

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
