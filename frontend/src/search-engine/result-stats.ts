/**
 * Per-result summary stats shared between `ResultsList.tsx`'s own display
 * and `App.tsx`'s result sorting (docs/feedback.md Round 2 #3) -- kept in
 * one place so sorting always agrees with what a result card actually shows
 * (e.g. "skills over cap" sorts by the exact same `disabledCount` printed in
 * the card's own "Active skill cap" line).
 */

import { determineActiveSkills } from './active-skill-cap'
import type { NamedCandidate, NamedCuff, NamedResistances, NamedSkill } from './load-bundle'
import type { SkillId } from './types'

export interface ResultStats {
  readonly totalDefense: number
  readonly resistances: NamedResistances
  readonly disabledCount: number
}

/** Summed across every pick in a result (armor, weapon, cuffs aren't picks
 * here -- see `NamedBuildResult.picks`). Weapons and cuffs carry no defense/
 * resistance data at all (confirmed against the raw data, see
 * docs/data-format-notes.md: the "deco" bucket's Cuff rows and the weapon
 * buckets have no F/W/T/D/I/DEF columns, a different row shape from armor),
 * so in practice only armor picks ever contribute a non-zero amount here --
 * but summing every pick regardless costs nothing, since a non-armor pick's
 * own placeholder values (`null`/all-zero, see `build-query.ts`'s
 * `NO_RESISTANCES`) are additive no-ops. `defenseMax` (not `defenseBase`) is
 * used for "Total defense" -- the fully-forged value is what a hunter
 * actually cares about reaching, the same reasoning
 * docs/data-format-notes.md gives for storing it at all. */
function sumStats(picks: ReadonlyMap<string, NamedCandidate>): {
  readonly totalDefense: number
  readonly resistances: NamedResistances
} {
  let totalDefense = 0
  const resistances = { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 }
  for (const candidate of picks.values()) {
    totalDefense += candidate.defenseMax ?? 0
    resistances.fire += candidate.resistances.fire
    resistances.water += candidate.resistances.water
    resistances.thunder += candidate.resistances.thunder
    resistances.ice += candidate.resistances.ice
    resistances.dragon += candidate.resistances.dragon
  }
  return { totalDefense, resistances }
}

export function computeResultStats(
  picks: ReadonlyMap<string, NamedCandidate>,
  skillTotals: ReadonlyMap<SkillId, number>,
  skills: readonly NamedSkill[],
  zenithSkills: readonly NamedSkill[],
  cuffs: readonly NamedCuff[],
): ResultStats {
  const { totalDefense, resistances } = sumStats(picks)
  const { disabled } = determineActiveSkills(picks, skillTotals, skills, zenithSkills, cuffs)
  return { totalDefense, resistances, disabledCount: disabled.length }
}

/** Mirrors `resistances`' own "all five at once" presentation in the result
 * card (docs/feedback.md Round 2 #3: "sort by resistances" names no single
 * element, so this averages all five) -- but an unmitigated negative
 * resistance is a real liability in-game (it amplifies that element's
 * damage) in a way an equal-magnitude positive isn't just a mirror-image
 * bonus of, so a negative value is weighted several times more heavily than
 * a positive one of the same size, confirmed by the project owner
 * 2026-10-19 ("penalize negative values strongly"). A build with one bad
 * negative resistance should sort below one with merely mediocre positives,
 * even if their naive averages would tie. */
const NEGATIVE_RESISTANCE_PENALTY_FACTOR = 3

export function resistanceScore(resistances: NamedResistances): number {
  const values = [
    resistances.fire,
    resistances.water,
    resistances.thunder,
    resistances.ice,
    resistances.dragon,
  ]
  const weighted = values.map((v) => (v < 0 ? v * NEGATIVE_RESISTANCE_PENALTY_FACTOR : v))
  return weighted.reduce((sum, v) => sum + v, 0) / values.length
}
