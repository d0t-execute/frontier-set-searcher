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

/** The 5 elemental resistance stats every real armor piece carries (see
 * `load-bundle.ts`'s `NamedResistances`, which this type mirrors so the
 * engine doesn't have to import the display-facing Named* layer just to
 * reference the same 5 field names -- same separation `SkillContribution`/
 * `NamedSkill` already keep). Decorations and cuffs never carry resistance
 * data at all (confirmed against the real dataset -- see `build-query.ts`'s
 * `NO_RESISTANCES` and its own docstring), so only `Candidate` has this
 * field. */
export type ResistanceElement = 'fire' | 'water' | 'thunder' | 'ice' | 'dragon'

export interface Resistances {
  readonly fire: number
  readonly water: number
  readonly thunder: number
  readonly ice: number
  readonly dragon: number
}

export interface Candidate {
  readonly id: string
  readonly skills: readonly SkillContribution[]
  /** Total count of open decoration slots on this piece. Slots are plain,
   * interchangeable units (confirmed by the project owner) -- a piece's slot
   * count is not a list of individually-sized slots. Omitted or 0 means no
   * open slots. */
  readonly openSlotCount?: number
  /** This piece's own elemental resistances, for `SearchOptions.resistanceFloors`
   * (docs/feedback.md Round 1 #4) -- omitted (same convention as
   * `openSlotCount`) means zero contribution, for a candidate with no
   * resistance data (a synthetic test fixture, or a context that never
   * populates it at all). */
  readonly resistances?: Resistances
  /** This piece's gear-level category key (see `NamedCandidate`, which always
   * sets this -- optional here only so a synthetic test fixture that doesn't
   * care about categories can omit it, same convention as `openSlotCount`/
   * `resistances`). Used by `SearchOptions.preferredCategoryCounts`. */
  readonly category?: string
}

export interface Decoration {
  readonly id: string
  /** Number of a piece's open slot units this decoration consumes (1-3),
   * confirmed by the project owner. A decoration fits a piece as long as the
   * summed slotSize of everything placed in it doesn't exceed the piece's
   * openSlotCount. */
  readonly slotSize: number
  readonly skills: readonly SkillContribution[]
}

export interface SlotQuery {
  readonly slotId: string
  readonly candidates: readonly Candidate[]
}

/** Shaped identically to `Decoration` (id, slotSize, skills) -- see
 * etl/src/etl/export.py's `_export_cuffs` -- but spent from a wholly separate
 * "Poogie slot" budget shared across at most 2 equipped cuffs, not an armor
 * piece's own open slots (confirmed by the project owner; see
 * docs/data-format-notes.md's "Cuffs" section). Kept as its own interface
 * rather than used as `Decoration` directly so a call site reads correctly
 * even though the shapes match today.
 *
 * `category` is optional -- unlike every other `Cuff` field, it exists only
 * so `ilp-model.ts` can identify a Hiden cuff (`HIDEN_CUFF_CATEGORY`) for the
 * game's own "at most 1 Hiden cuff equipped" rule; a caller that doesn't care
 * about that rule (most existing test fixtures, `SearchOptions.pinnedCuffs`
 * built without one) can simply omit it, same as omitting `openSlotCount` on
 * a `Candidate` with no open slots. */
export interface Cuff extends Decoration {
  readonly category?: string
}

/** The cuff category key identifying a "Hiden" cuff -- a per-weapon-type
 * technique tree (`slotSize` always 0, confirmed by the project owner against
 * the real dataset -- see docs/data-format-notes.md's "Cuffs" section). The
 * game allows at most one Hiden cuff equipped at a time, regardless of which
 * weapon type's tree it's from (confirmed by the project owner, 2026-10-16) --
 * enforced by `ilp-model.ts`'s `buildModel` via a dedicated row, the same way
 * `MAX_EQUIPPED_CUFFS`/`CUFF_SLOT_BUDGET` enforce the game's other two
 * cuff-count rules. Matches `cuff-categories.ts`'s own `cuff_hiden` key. */
export const HIDEN_CUFF_CATEGORY = 'cuff_hiden'

export interface SkillTierThresholds {
  readonly skillId: SkillId
  /** Every point threshold that activates one of this skill's tiers, in any
   * order -- some are negative (a penalty tier, e.g. "-10"), most are
   * positive. Mirrors `skills.json`'s `tiers[].minPoints` (see
   * `load-bundle.ts`'s `SkillTierRecord`), without the display-only label
   * and description `ilp-model.ts` has no use for. */
  readonly tierThresholds: readonly number[]
}

export interface ResistanceFloor {
  readonly element: ResistanceElement
  /** The minimum summed total this element's resistance must reach or
   * exceed across every chosen candidate -- typically 0 (docs/feedback.md
   * Round 1 #4: "force elemental resistances to be at least zero"), but left
   * as a caller-chosen floor rather than hardcoded, in case a stricter floor
   * ever turns out to be wanted. */
  readonly minTotal: number
}

export interface SearchOptions {
  /** When true, changes the ranking tie-break (see `ilp-model.ts`'s
   * `buildModel`) from rewarding unrequested ("bonus") skill points to
   * penalizing *builds that activate a bonus skill's tier at all* --
   * reaching 9 points of a skill nobody asked for is harmless (it does
   * nothing in-game), but 10 might turn on a real, possibly unwanted effect
   * (including a negative one, e.g. a "-10" penalty tier). Off by default to
   * preserve existing ranking behavior; a build that already needs bonus
   * points to meet a requirement is unaffected either way, since
   * requirements are hard constraints, not objective terms. */
  readonly preferExactMatches?: boolean
  /** Every requestable skill's tier thresholds, used only when
   * `preferExactMatches` is set so the engine can tell a harmless incidental
   * point or two apart from a threshold actually crossed. A skill left out
   * here (or this left undefined entirely) is simply never penalized --
   * "unknown" defaults to "assume harmless," not "assume bad." */
  readonly skillTiers?: readonly SkillTierThresholds[]
  /** Cuffs forced into the build instead of left to the solver -- 0-2
   * entries, same "at most 2, duplicates allowed" rule as a normal result's
   * `cuffs` (see `Cuff`). Their skill contributions count toward every
   * requirement exactly like a solver-chosen cuff would, and they consume
   * their share of `CUFF_SLOT_BUDGET`/`MAX_EQUIPPED_CUFFS` (`ilp-model.ts`)
   * before the solver's own free cuff pool is allowed to use what's left --
   * mirrors `App.tsx`'s armor-pinning feature (TODO #7's `PinnedSlot`), but
   * cuffs have no per-slot cardinality row to narrow to a single candidate
   * the way an armor slot does, so pinning them needs this explicit
   * mechanism instead. */
  readonly pinnedCuffs?: readonly Cuff[]
  /** Decorations forced into specific slots without pinning which candidate
   * fills that slot (docs/skill-system-roadmap.md TODO #12) -- keyed by
   * `slotId`, a flat list with duplicates allowed for multiple copies of the
   * same decoration (same "flat, duplicates = count" convention
   * `BuildResult.cuffs`/a `PinnedSlot`'s own `decorationIds` already use).
   * Unlike `pinnedCuffs`, these interact with a real per-slot capacity row
   * (`ilp-model.ts`'s `capacityRow`) rather than being folded into row
   * bounds directly, since the slot's own capacity still depends on
   * whichever candidate the solver freely picks for it -- modeled instead by
   * forcing the matching decoration-count column(s) to be selected. A slot
   * listed here is expected to never also be pinned to a specific candidate
   * (which already bakes its own decorations in) -- callers keep the two
   * mutually exclusive per slot (see `build-query.ts`'s
   * `resolvePinnedSlotDecorations`). */
  readonly pinnedSlotDecorations?: ReadonlyMap<string, readonly Decoration[]>
  /** Elements the caller requires to stay at or above their own `minTotal`
   * (summed across every chosen candidate), modeled by `ilp-model.ts`'s
   * `buildModel` as one additional hard-constraint row per entry (see its own
   * docstring) -- same "absent = no requirement" convention as
   * `pinnedCuffs`/`skillTiers`. Only candidates ever contribute; decorations
   * and cuffs carry no resistance data at all (see `Candidate.resistances`'s
   * own docstring). */
  readonly resistanceFloors?: readonly ResistanceFloor[]
  /** Skills a result must never make "active" (docs/skill-system-roadmap.md
   * TODO #37) -- modeled by `ilp-model.ts`'s `buildModel` as one additional
   * hard-constraint row per entry, keeping the summed contribution across
   * every chosen candidate, placed decoration, *and* equipped cuff strictly
   * outside whichever tier(s) would activate it (reusing `isSkillActive`'s
   * exact pos/neg threshold reduction, inverted) -- rather than banning every
   * piece/decoration/cuff that grants any points in it at all, the old (TODO
   * #32) behavior this replaces. Needs each excluded skill's own
   * `skillTiers` entry to know where its tiers actually are; a skill left out
   * of `skillTiers` is treated as untiered (activates on any positive total),
   * same "unknown defaults to the plain fallback" convention `skillTiers`
   * itself already uses. */
  readonly excludedActiveSkillIds?: readonly SkillId[]
  /** Skill ids a cuff slot is pinned to (docs/skill-system-roadmap.md TODO
   * #25) -- unlike `pinnedCuffs`, this doesn't name a specific cuff, only
   * requires the free cuff pool to supply at least one equipped cuff granting
   * this skill, letting the solver pick whichever variant serves the rest of
   * the build best (cuffs are "partially random": the same name can carry
   * different exact point values across copies). Duplicates allowed, same
   * "flat list, repeats = count" convention as `pinnedCuffs`/a `PinnedSlot`'s
   * own `decorationIds` -- pinning the same skill to both cuff slots requires
   * two qualifying cuffs (which may or may not be the same variant), modeled
   * by `ilp-model.ts`'s `buildModel` as one hard-constraint row per distinct
   * skill id requiring its summed equipped count to reach however many times
   * it was pinned, offset by any already-pinned (`pinnedCuffs`) cuff that
   * happens to also grant it. The specific-cuff pin from `pinnedCuffs` stays
   * available as a separate, more precise alternative -- this is additive,
   * not a replacement. */
  readonly pinnedCuffSkillIds?: readonly SkillId[]
  /** Candidate ids the solver should favor using whenever it can (docs/
   * feedback.md Round 2 #2, confirmed 2026-10-19 by the project owner: "the
   * preferred pieces should always win out over any other valid result...
   * meant to allow people to optimize with existing gear, similarly to
   * pinning pieces, but with a pool of gear that can be overruled if it's
   * not possible to reach the goal with it") -- modeled by `ilp-model.ts`'s
   * `buildModel` as a large per-piece bonus (`PREFERRED_ITEM_WEIGHT`) added
   * to a candidate column's objective cost whenever its id is in this set,
   * large enough to dominate every other ranking factor (including
   * `OPEN_SLOT_WEIGHT`) -- a build using one more preferred piece always
   * outranks one using fewer, regardless of anything else. Still never a
   * hard constraint, unlike `pinnedCuffs`/a `PinnedSlot`: a build that uses
   * none of these pieces is still returned (and still correctly ranked
   * against other such builds) when using any of them would make a
   * requirement unreachable -- the pool is overruled, not enforced. Scoped
   * to armor candidates only (decorations/cuffs are a separate pool, not
   * asked for here). */
  readonly preferredCandidateIds?: ReadonlySet<string>
  /** A gear category to favor using several pieces from, and how many
   * (2026-10-20, per the project owner: "a strong benefit from using exactly
   * one piece from a specific category" -- generalized to any count 1-5, and
   * to several categories at once, e.g. "2 from category A and 3 from
   * category B"). Same soft-preference family as `preferredCandidateIds`
   * (confirmed by the project owner: a build that can't reach `count` from
   * this category is still returned, using fewer, rather than the search
   * failing outright) -- but "prefer up to N armor picks from this category"
   * doesn't fit that field's own per-piece bonus directly (a flat bonus per
   * matching piece has no notion of "stop crediting after N," it would just
   * always reward using *more* of the category, same as naming every one of
   * its pieces individually). `ilp-model.ts`'s `buildModel` instead tracks,
   * per entry, how many chosen armor candidates have this `category` (summed
   * across every slot) and rewards that count up to `count` at
   * `PREFERRED_ITEM_WEIGHT` per piece (the same per-piece scale
   * `preferredCandidateIds` uses, so the two features rank consistently
   * against each other and stack additively when a piece satisfies both) --
   * see `buildModel`'s own docstring for the accounting-column mechanism,
   * shared with its `preferExactMatches` tier machinery. `count` is a floor
   * to reach, not a ceiling: a build using more than `count` pieces from this
   * category is never penalized for the excess, only not rewarded further for
   * it. A category with no matching candidates in the current query (e.g.
   * filtered out) simply never reaches any reward, the same graceful
   * degradation `preferredCandidateIds` already has for a filtered-out id. */
  readonly preferredCategoryCounts?: readonly PreferredCategoryCount[]
}

export interface PreferredCategoryCount {
  readonly category: string
  /** How many armor picks from `category` to reward reaching, 1-5 (the game's
   * own armor-slot count) -- see `SearchOptions.preferredCategoryCounts`. */
  readonly count: number
}

export interface BuildResult {
  /** One chosen candidate per slot, keyed by `slotId`. */
  readonly picks: ReadonlyMap<string, Candidate>
  /** Decorations placed into each pick's open slots, keyed by `slotId`.
   * Only present for slots whose candidate has `openSlotCount` and at least
   * one decoration was placed. */
  readonly decorations: ReadonlyMap<string, readonly Decoration[]>
  /** Cuffs equipped by this build, 0-2 entries (duplicates allowed -- the
   * same cuff can fill both of a build's two cuff slots). Flat, not keyed by
   * slot, since cuffs aren't tied to any armor slot -- see `Cuff`. Empty when
   * no cuffs were offered to the search at all, not just when none helped. */
  readonly cuffs: readonly Cuff[]
  /** Summed skill points across all picks, placed decorations, and equipped
   * cuffs, keyed by `skillId`. */
  readonly skillTotals: ReadonlyMap<SkillId, number>
}
