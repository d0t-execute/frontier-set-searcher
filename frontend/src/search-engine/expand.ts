/**
 * Expands raw slot/decoration input into per-slot options the search
 * algorithm operates on (see docs/PLAN.md §6-7). Shared between the
 * meet-in-the-middle frontier computation (`pareto.ts`) and the engine's
 * final pairwise merge (`engine.ts`).
 */

import { fillSlots } from './decorations'
import { dominates } from './dominance'
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

interface DecorationFillingOption {
  readonly skills: readonly SkillContribution[]
  readonly decorationsUsed: readonly Decoration[]
}

/**
 * Caches each capacity's decoration-filling frontier across every slot in a
 * single search -- `fillSlots(capacity, decorations)` depends only on a
 * candidate's openSlotCount and the shared decoration catalog, never on
 * which slot or candidate it is. A handful of relevant decorations can still
 * enumerate into hundreds of thousands of raw multisets per distinct
 * capacity; computing that fresh for *every slot* (five real equipment
 * types sharing the same few capacity values) rather than once for the
 * whole search was itself costing several seconds per slot at real-dataset
 * scale with multiple simultaneous skill requirements. One cache, created
 * once per search and threaded through every `expandSlot` call, fixes that.
 */
export class DecorationFillingCache {
  private readonly byCapacity = new Map<number, readonly DecorationFillingOption[]>()

  get(
    capacity: number,
    decorations: readonly Decoration[],
    requirements: readonly SkillRequirement[],
  ): readonly DecorationFillingOption[] {
    let frontier = this.byCapacity.get(capacity)
    if (frontier === undefined) {
      frontier = computeDecorationFillingFrontier(capacity, decorations, requirements)
      this.byCapacity.set(capacity, frontier)
    }
    return frontier
  }
}

export function expandSlot(
  slot: SlotQuery,
  decorations: readonly Decoration[],
  requirements: readonly SkillRequirement[],
  cache: DecorationFillingCache = new DecorationFillingCache(),
): ExpandedSlot {
  const options: ExpandedOption[] = []
  for (const candidate of slot.candidates) {
    for (const filling of cache.get(candidate.openSlotCount ?? 0, decorations, requirements)) {
      options.push({
        candidate,
        skills: mergeSkills(candidate.skills, filling.skills),
        decorationsUsed: filling.decorationsUsed,
      })
    }
  }
  return { slotId: slot.slotId, options }
}

/** A single capacity's decoration fillings, Pareto-pruned over the requested
 * skills in isolation (no candidate involved yet) -- same "reduce before
 * combining" technique `pareto.ts` uses per slot, applied one level earlier. */
function computeDecorationFillingFrontier(
  capacity: number,
  decorations: readonly Decoration[],
  requirements: readonly SkillRequirement[],
): DecorationFillingOption[] {
  const frontier: { vector: readonly number[]; option: DecorationFillingOption }[] = []

  for (const filling of fillSlots(capacity, decorations)) {
    const totals = new Map<SkillId, number>()
    applyContribution(totals, filling.skills, 1)
    const vector = requirements.map((r) => totals.get(r.skillId) ?? 0)
    const candidate = {
      vector,
      option: { skills: filling.skills, decorationsUsed: filling.decorationsUsed },
    }

    if (frontier.some((existing) => dominates(existing.vector, vector))) continue
    for (let i = frontier.length - 1; i >= 0; i--) {
      if (dominates(vector, frontier[i].vector)) frontier.splice(i, 1)
    }
    frontier.push(candidate)
  }

  return frontier.map((entry) => entry.option)
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
