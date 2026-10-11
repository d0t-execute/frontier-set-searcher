/**
 * Expands raw slot/decoration input into per-slot options the search
 * algorithm operates on (see docs/PLAN.md §6-7). Shared between the
 * meet-in-the-middle frontier computation (`pareto.ts`) and the engine's
 * final pairwise merge (`engine.ts`).
 */

import { cappedVector, ParetoFrontier } from './dominance'
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

/** A single option's requested-skill-plus-open-slots vector: one capped
 * dimension per requirement (see `cappedVector`'s docstring) -- the same
 * "only the dimensions dominance and ranking ever look at" restriction
 * `pareto.ts` applies, computed here so `expandSlot` can prune as it
 * generates instead of after (see its docstring) -- followed by one uncapped
 * scoring dimension: decoration slots left unused. Confirmed project
 * direction: among options that already tie on every requested skill,
 * leaving more decoration capacity open for the player's own playstyle
 * choices makes an option strictly better, not merely different -- a large
 * amount of real build customization comes from hitting a skill's breakpoint
 * and then spending whatever capacity is left on personal preference, so
 * burying that capacity in an unnecessary extra decoration (or a plainer
 * piece with no open slots at all) must never look "just as good" as a
 * build that preserves it. Capping the requested dimensions matters here for
 * the same reason it matters in `pareto.ts`: without it, the "just meets it"
 * option would already be discarded as dominated before ever getting a
 * chance to be ranked as equally good on everything that *was* asked for.
 *
 * Deliberately doesn't fold in bonus points the way
 * `computeDecorationFillingFrontier`'s own vector now does (see its
 * docstring) -- that DP processes a handful of decorations against a shared
 * capacity, where tracking bonus points per *group* is cheap, but
 * `expandSlot` applies this dominance across every (candidate, decoration
 * filling) pair for a slot, up to ~13,000 real candidates each with their
 * own distinct bonus skills -- almost nothing ties exactly once bonus points
 * is part of the vector at that scale, which pushed a real multi-skill
 * search over its 5-second budget when tried. Bonus points still counts here
 * -- via `tieBreakScore` below -- just only to break ties between options
 * that already match on requested skill and open slots, not as a further
 * dominance dimension of its own. */
function skillAndSlotsVector(
  skills: readonly SkillContribution[],
  openSlots: number,
  requirements: readonly SkillRequirement[],
): number[] {
  const raw = requirements.map((r) => skills.find((s) => s.skillId === r.skillId)?.points ?? 0)
  return cappedVector([...raw, openSlots], requirements)
}

/** Total points in skills not in `requestedSkillIds` -- additive the same
 * way summed skill points always are (`mergeSkills(a, b)`'s bonus total is
 * always `bonus(a) + bonus(b)`, regardless of whether `a` and `b` share any
 * skill IDs), which is what lets `computeDecorationFillingFrontier` track it
 * incrementally per group instead of rescanning a merged `skills` array on
 * every origin -- see that function's own docstring. */
function bonusPointsOf(
  skills: readonly SkillContribution[],
  requestedSkillIds: ReadonlySet<SkillId>,
): number {
  let bonusPoints = 0
  for (const skill of skills) {
    if (!requestedSkillIds.has(skill.skillId)) bonusPoints += skill.points
  }
  return bonusPoints
}

/** Total decoration-slot capacity a set of placed decorations consumes --
 * exported for `pareto.ts`'s `vectorOf`, which needs the same computation to
 * build a `FrontierEntry`'s own open-slots dimension. */
export function usedSlotSize(decorationsUsed: readonly Decoration[]): number {
  let total = 0
  for (const decoration of decorationsUsed) total += decoration.slotSize
  return total
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
  const requestedSkillIds = new Set(requirements.map((r) => r.skillId))
  const tieBreakScore = (option: ExpandedOption): number =>
    bonusPointsOf(option.skills, requestedSkillIds)

  const frontier = new ParetoFrontier<ExpandedOption>(tieBreakScore)
  for (const candidate of slot.candidates) {
    const capacity = candidate.openSlotCount ?? 0
    for (const filling of cache.get(capacity, decorations, requirements)) {
      const skills = mergeSkills(candidate.skills, filling.skills)
      const openSlots = capacity - usedSlotSize(filling.decorationsUsed)
      const option: ExpandedOption = { candidate, skills, decorationsUsed: filling.decorationsUsed }
      frontier.insert(skillAndSlotsVector(skills, openSlots, requirements), option)
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
 *
 * The vector tracked here is *fuller* than `expandSlot`'s own
 * `skillAndSlotsVector` one level up (see its docstring for why that one
 * deliberately stops short of bonus points): requested-skill dimensions,
 * then open slots left unused, then bonus points, all three in full
 * dominance. This DP only ever processes a handful of relevant decorations
 * against one shared capacity (not ~13,000 real candidates), so none of
 * `skillAndSlotsVector`'s scale concerns apply here -- what matters instead
 * is computing each dimension once per distinct *group*, not once per tied
 * origin (see the two loops below). Every origin tied together in one group
 * necessarily shares the same open-slots and bonus-points figures too, not
 * just the same requested-skill total -- both are derived from the shared
 * vector itself, and bonus points specifically composes the same way
 * requested skill does (`mergeSkills`'s bonus total is always the sum of
 * each side's own bonus total, regardless of whether they share any skill
 * IDs -- see `bonusPointsOf`'s docstring), so there's never a need to
 * separately re-derive either from an origin's own
 * `skills`/`decorationsUsed`. An earlier version recomputed open slots fresh
 * per *origin* instead of reusing this invariant, measurably costing seconds
 * on a real multi-skill query despite open slots itself being bounded by
 * `capacity + 1` distinct values -- the cost was from the redundant
 * per-origin recomputation, not from however many groups exist, which is
 * also why extending this same per-group treatment to bonus points turned
 * out not to reintroduce that cost either (an earlier version tracked bonus
 * points only as a `ParetoFrontier` tie-break here too, assuming it had to,
 * before realizing the per-group computation applies to it exactly the same
 * way it does to open slots). Open slots earns a spot in dominance at all
 * because without it, "place nothing, leave every slot open" is
 * unconditionally dominated by any single relevant decoration that raises
 * the requested skill at all, *even when every other slot in the build
 * already meets the requirement on its own* -- confirmed on a real
 * single-skill query, where every one of 5 armor pieces ended up carrying a
 * decoration it didn't need, instead of 4 of them staying undecorated once
 * the 5th already supplied enough.
 */
function computeDecorationFillingFrontier(
  capacity: number,
  decorations: readonly Decoration[],
  requirements: readonly SkillRequirement[],
): DecorationFillingOption[] {
  const requestedSkillIds = new Set(requirements.map((r) => r.skillId))

  // The vector's last two elements are always [open slots remaining, bonus
  // points] at whichever bucket a group was inserted into; subtracting open
  // slots from that bucket's own capacity recovers total decoration-slot
  // capacity used so far -- a fact about the origins themselves, not about
  // which bucket they're sitting in, so it stays valid when re-deriving open
  // slots for a *different* (target) bucket below. Bonus points needs no
  // such re-derivation: it doesn't depend on capacity at all.
  function usedSlotSizeOfGroup(vector: readonly number[], atCapacity: number): number {
    return atCapacity - vector[requirements.length]
  }

  // Seeded only at capacity 0 -- the capacity-carry-forward pass below is
  // what propagates "place nothing" (and everything else) up through every
  // higher capacity exactly once. Seeding every level independently here
  // too would double-count it there: an "empty filling" object seeded fresh
  // at level 1 and a structurally-identical one carried forward from level 0
  // are the exact same real-world origin (place nothing), but two different
  // object instances, so `ParetoFrontier` can't tell they're not a genuine
  // second tie.
  const zeroVector = new Array<number>(requirements.length).fill(0)
  const frontierByCapacity: ParetoFrontier<DecorationFillingOption>[] = Array.from(
    { length: capacity + 1 },
    () => new ParetoFrontier<DecorationFillingOption>(),
  )
  frontierByCapacity[0].insert([...zeroVector, 0, 0], { skills: [], decorationsUsed: [] })

  for (const decoration of decorations) {
    if (decoration.slotSize <= 0 || decoration.slotSize > capacity) continue

    const contribution = requirements.map(
      (r) => decoration.skills.find((s) => s.skillId === r.skillId)?.points ?? 0,
    )
    // A decoration contributing to none of the requested skills is skipped
    // here as a pure performance short-circuit -- this relies on `search()`'s
    // documented precondition (see this module's own docstring) that
    // `decorations` has already been filtered down to ones relevant to a
    // requested skill (`filterRelevantDecorations`) before ever reaching
    // `expandSlot`/this DP.
    if (contribution.every((points) => points === 0)) continue

    // Computed once per decoration, not once per group or origin -- a
    // decoration's own bonus contribution never depends on what it's being
    // combined with.
    const decorationBonus = bonusPointsOf(decoration.skills, requestedSkillIds)

    for (let c = decoration.slotSize; c <= capacity; c++) {
      const sourceCapacity = c - decoration.slotSize
      const source = frontierByCapacity[sourceCapacity]
      const target = frontierByCapacity[c]
      for (const { vector, origins } of source.entries()) {
        // Computed once per group, same as the pre-open-slots version of
        // this DP did for the skill dimensions alone -- see this function's
        // own docstring on why that's safe to do for open slots and bonus
        // points too.
        const newUsedSlotSize = usedSlotSizeOfGroup(vector, sourceCapacity) + decoration.slotSize
        const newBonus = vector[requirements.length + 1] + decorationBonus
        const newVector = cappedVector(
          [
            ...vector.slice(0, requirements.length).map((v, k) => v + contribution[k]),
            c - newUsedSlotSize,
            newBonus,
          ],
          requirements,
        )
        for (const origin of origins) {
          target.insert(newVector, {
            skills: mergeSkills(origin.skills, decoration.skills),
            decorationsUsed: [...origin.decorationsUsed, decoration],
          })
        }
      }
    }
  }

  // Capacity is always usable up to, not required to be filled exactly --
  // anything reachable with c-1 capacity is trivially also reachable with c
  // (just leave the extra unit unused), so it belongs in frontierByCapacity[c]
  // too. Without this, a vector only ever reaches a higher capacity bucket by
  // some transition adding *another* decoration on top, which can silently
  // lose a tie: once capping (`cappedVector`) makes "use 1 of a decoration"
  // and "use 2 of the same decoration" reach the identical capped vector,
  // placing the 2nd copy no longer dominates placing just the 1st -- they
  // tie -- but the 1-copy origin, sitting only in frontierByCapacity[1], was
  // never otherwise copied into frontierByCapacity[2] to tie with it there.
  // Carrying forward in ascending order means each step already reflects
  // every lower capacity transitively. Open slots is recomputed against the
  // *target* bucket's own capacity (one more than the source bucket's own
  // open-slots figure, since no further decoration gets placed), not simply
  // copied from the source -- carrying "1 copy of a jewel" from capacity 1
  // into capacity 2 leaves one more slot open there than it did at capacity
  // 1, which reusing the old vector wouldn't reflect. Bonus points carries
  // forward unchanged, since it never depended on capacity.
  for (let c = 1; c <= capacity; c++) {
    const source = frontierByCapacity[c - 1]
    for (const { vector, origins } of source.entries()) {
      const newVector = [
        ...vector.slice(0, requirements.length),
        vector[requirements.length] + 1,
        vector[requirements.length + 1],
      ]
      for (const origin of origins) {
        frontierByCapacity[c].insert(newVector, origin)
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
