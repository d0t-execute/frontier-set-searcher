/**
 * Expands raw slot/decoration input into per-slot options the search
 * algorithm operates on (see docs/PLAN.md §6-7). Shared between the
 * meet-in-the-middle frontier computation (`pareto.ts`) and the engine's
 * final pairwise merge (`engine.ts`).
 */

import { ParetoFrontier } from './dominance'
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

/** A slot's requested-skill vector for a single option: the same "only the
 * dimensions dominance and ranking ever look at" restriction `pareto.ts`
 * applies, computed here so `expandSlot` can prune as it generates instead
 * of after (see its docstring). */
function requestedVector(
  skills: readonly SkillContribution[],
  requirements: readonly SkillRequirement[],
): number[] {
  return requirements.map((r) => skills.find((s) => s.skillId === r.skillId)?.points ?? 0)
}

/**
 * Expands a slot's candidates into every (candidate, decoration filling)
 * combination, pruned down to the non-dominated frontier over `requirements`
 * as it goes rather than after the fact. This used to build the full raw
 * cross product first (`pareto.ts`'s `reduceSlotOptions` pruned it
 * afterwards) -- fine when a slot had at most a few thousand candidates and
 * a handful of decoration fillings, but real equipment slots run to ~13,000
 * candidates each, and a capacity-3 decoration frontier under a multi-skill
 * query can easily have 100+ entries of its own: the raw cross product runs
 * into the millions of options *per slot*, which measurably exhausted
 * memory on a real search. Pruning incrementally (via the same dominance
 * rule `reduceSlotOptions` already applies one level up) keeps this
 * function's own working set bounded by the slot's actual non-dominated
 * frontier instead of candidates x fillings. Uses `ParetoFrontier` rather
 * than a plain array so that candidates tying on the exact same vector --
 * plausible at real scale (e.g. many equipment pieces contributing nothing
 * to any requested skill) -- are grouped in O(1) instead of each re-scanning
 * the whole frontier (see dominance.ts's module docstring).
 */
export function expandSlot(
  slot: SlotQuery,
  decorations: readonly Decoration[],
  requirements: readonly SkillRequirement[],
  cache: DecorationFillingCache = new DecorationFillingCache(),
): ExpandedSlot {
  const frontier = new ParetoFrontier<ExpandedOption>()
  for (const candidate of slot.candidates) {
    for (const filling of cache.get(candidate.openSlotCount ?? 0, decorations, requirements)) {
      const skills = mergeSkills(candidate.skills, filling.skills)
      const option: ExpandedOption = { candidate, skills, decorationsUsed: filling.decorationsUsed }
      frontier.insert(requestedVector(skills, requirements), option)
    }
  }
  return { slotId: slot.slotId, options: frontier.toArray() }
}

/**
 * A single capacity's decoration fillings, Pareto-pruned over the requested
 * skills -- same "reduce before combining" technique `pareto.ts` uses per
 * slot, applied one level earlier.
 *
 * Built incrementally, one decoration at a time, as an unbounded-knapsack DP
 * over capacity (`frontierByCapacity[c]` holds the non-dominated frontier
 * reachable with at most `c` capacity using decorations folded in so far;
 * processing capacity in ascending order within a single decoration's pass
 * lets that same decoration be reused any number of times, since by the time
 * capacity `c` is reached, `frontierByCapacity[c - slotSize]` already
 * reflects this decoration having been placed there too). This replaces an
 * earlier version that fully enumerated every raw multiset of decorations
 * via `fillSlots` before pruning -- fine for a handful of relevant
 * decorations, but real MHF data can make 150+ decorations "relevant" to a
 * single query (many weapon-event decorations carry a common skill like
 * Attack as a secondary stat), and at capacity 3 -- the single most common
 * open-slot count on real equipment -- that raw enumeration ran to roughly
 * 700,000 multisets *before* any pruning, which hung and then
 * out-of-memory-crashed a real search. Folding in one decoration at a time
 * and pruning after every step keeps the working set bounded by the actual
 * non-dominated frontier size instead of the raw combinatorial count.
 *
 * Each capacity's frontier is a `ParetoFrontier`, folded in by `entries()`
 * (one vector per group, however many origins tie on it) rather than by
 * individual origin -- real decoration data has many decorations worth the
 * exact same points on a skill (e.g. 44 different ones worth exactly 3
 * Vampirism points each), and with a capacity limit the number of
 * combinatorially distinct ways to pick from such a group runs into the
 * thousands. Grouping keeps the DP's own work proportional to how many
 * distinct vectors exist at each capacity, not how many tied ways reach
 * them (see dominance.ts's module docstring).
 */
function computeDecorationFillingFrontier(
  capacity: number,
  decorations: readonly Decoration[],
  requirements: readonly SkillRequirement[],
): DecorationFillingOption[] {
  const zeroVector = new Array<number>(requirements.length).fill(0)
  const frontierByCapacity: ParetoFrontier<DecorationFillingOption>[] = Array.from(
    { length: capacity + 1 },
    () => {
      const frontier = new ParetoFrontier<DecorationFillingOption>()
      frontier.insert(zeroVector, { skills: [], decorationsUsed: [] })
      return frontier
    },
  )

  for (const decoration of decorations) {
    if (decoration.slotSize <= 0 || decoration.slotSize > capacity) continue

    const contribution = requirements.map(
      (r) => decoration.skills.find((s) => s.skillId === r.skillId)?.points ?? 0,
    )
    // A decoration irrelevant to every requested dimension can never change
    // which vector a filling reaches -- placing it would only ever produce a
    // tie with not placing it, never a new non-dominated point.
    if (contribution.every((points) => points === 0)) continue

    for (let c = decoration.slotSize; c <= capacity; c++) {
      const source = frontierByCapacity[c - decoration.slotSize]
      const target = frontierByCapacity[c]
      for (const { vector, origins } of source.entries()) {
        const newVector = vector.map((v, k) => v + contribution[k])
        for (const origin of origins) {
          target.insert(newVector, {
            skills: mergeSkills(origin.skills, decoration.skills),
            decorationsUsed: [...origin.decorationsUsed, decoration],
          })
        }
      }
    }
  }

  return frontierByCapacity[capacity].toArray()
}

/**
 * Sums `a` and `b`'s points per skill. On the `expandSlot`/decoration-DP hot
 * path this runs once per (candidate, filling) or (filling, decoration)
 * pair -- millions of times for a single real search -- and both sides are
 * always tiny (a handful of skills at most), so a linear scan into a plain
 * array avoids paying Map/iterator allocation overhead on every call; a Map
 * only pays off once the inputs are large enough to make O(n*m) scanning
 * the slower choice, which never happens here.
 */
export function mergeSkills(
  a: readonly SkillContribution[],
  b: readonly SkillContribution[],
): SkillContribution[] {
  const merged = a.map((s) => ({ skillId: s.skillId, points: s.points }))
  for (const contribution of b) {
    const existing = merged.find((s) => s.skillId === contribution.skillId)
    if (existing !== undefined) {
      existing.points += contribution.points
    } else {
      merged.push({ skillId: contribution.skillId, points: contribution.points })
    }
  }
  return merged
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
