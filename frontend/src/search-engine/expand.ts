/**
 * Expands raw slot/decoration input into per-slot options the search
 * algorithm operates on (see docs/PLAN.md §6-7). Shared between the
 * meet-in-the-middle frontier computation (`pareto.ts`) and the engine's
 * final pairwise merge (`engine.ts`).
 */

import { fillSlots } from './decorations'
import type {
  Candidate,
  Decoration,
  SkillContribution,
  SkillId,
  SkillRequirement,
  SlotQuery,
} from './types'

/** One way to fill a slot: a candidate piece plus (possibly empty) a choice
 * of decorations for its open slots, with their contributions pre-merged. */
export interface ExpandedOption {
  readonly candidate: Candidate
  readonly skills: readonly SkillContribution[]
  readonly decorationsUsed: readonly Decoration[]
}

export interface ExpandedSlot {
  readonly slotId: string
  readonly options: readonly ExpandedOption[]
}

/**
 * A decoration that contributes to none of the requested skills can never
 * change whether a requirement is met or how results are ranked -- only
 * relevant decorations are worth expanding into options. This isn't just an
 * optimization: without it, every candidate's open slots get filled with
 * every combination of *all* decorations in the catalog (hundreds in the
 * real dataset), which blows up the per-slot option count combinatorially
 * before the search even starts and exhausts memory long before producing a
 * single result.
 */
export function filterRelevantDecorations(
  decorations: readonly Decoration[],
  requirements: readonly SkillRequirement[],
): Decoration[] {
  const requestedSkillIds = new Set(requirements.map((r) => r.skillId))
  return decorations.filter((d) => d.skills.some((s) => requestedSkillIds.has(s.skillId)))
}

export function expandSlot(slot: SlotQuery, decorations: readonly Decoration[]): ExpandedSlot {
  const options: ExpandedOption[] = []
  for (const candidate of slot.candidates) {
    const fillings = fillSlots(candidate.openSlots ?? [], decorations)
    for (const filling of fillings) {
      options.push({
        candidate,
        skills: mergeSkills(candidate.skills, filling.skills),
        decorationsUsed: filling.placements.map((p) => p.decoration),
      })
    }
  }
  return { slotId: slot.slotId, options }
}

export function mergeSkills(
  a: readonly SkillContribution[],
  b: readonly SkillContribution[],
): SkillContribution[] {
  const totals = new Map<SkillId, number>()
  for (const { skillId, points } of [...a, ...b]) {
    totals.set(skillId, (totals.get(skillId) ?? 0) + points)
  }
  return [...totals.entries()].map(([skillId, points]) => ({ skillId, points }))
}

export function applyContribution(
  totals: Map<SkillId, number>,
  skills: readonly SkillContribution[],
  sign: 1 | -1,
): void {
  for (const contribution of skills) {
    const next = (totals.get(contribution.skillId) ?? 0) + sign * contribution.points
    if (next === 0) {
      totals.delete(contribution.skillId)
    } else {
      totals.set(contribution.skillId, next)
    }
  }
}
