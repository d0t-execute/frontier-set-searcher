import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { ArmorPicker } from './components/ArmorPicker'
import { CategoryFilter, GroupCheckbox } from './components/CategoryFilter'
import type { CategoryFilterGroup } from './components/CategoryFilter'
import { CuffPicker } from './components/CuffPicker'
import { Disclosure } from './components/Disclosure'
import { EquipmentExclusionPicker } from './components/EquipmentExclusionPicker'
import { InfoTooltip } from './components/InfoTooltip'
import { PreferredArmorPicker } from './components/PreferredArmorPicker'
import { PreferredCategoryPicker } from './components/PreferredCategoryPicker'
import { ResultsList } from './components/ResultsList'
import { SkillPicker } from './components/SkillPicker'
import type { NamedBuildResult } from './components/types'
import { useDataBundle } from './data/useDataBundle'
import { useSearchWorker } from './search/useSearchWorker'
import { previewActiveSkillCap } from './search-engine/active-skill-cap'
import {
  buildSearchQuery,
  decorationsAfterCategoryFilter,
  slotsAfterCategoryFilter,
  slotsAfterHunterTypeFilter,
  WEAPON_NO_ZENITH_SKILL_KEY,
} from './search-engine/build-query'
import type { HunterTypeFilter, PinnedCuffSlot, QueryFormState } from './search-engine/build-query'
import { categoryRouteHash } from './search-engine/category-route'
import { CUFF_CATEGORY_GROUPS } from './search-engine/cuff-categories'
import { DECORATION_CATEGORY_GROUPS } from './search-engine/decoration-categories'
import { findUnreachableRequirements } from './search-engine/feasibility'
import {
  GEAR_CATEGORY_GROUPS,
  GEAR_LEVEL_GRANK_CATEGORIES,
  GEAR_LEVEL_PRE_GRANK_CATEGORIES,
  GEAR_LEVEL_ZENITH_CATEGORIES,
  GEAR_LEVEL_ZP_CATEGORIES,
} from './search-engine/gear-categories'
import type { PinnedSlot } from './search-engine/pinned-armor'
import { decodeQueryCode, encodeQueryCode } from './search-engine/query-code'
import type { QueryCodeCatalog } from './search-engine/query-code'
import { computeResultStats, resistanceScore } from './search-engine/result-stats'
import type { SearchFormState } from './search-engine/search-form-state'
import {
  clearSearchFormState,
  loadSearchFormState,
  saveSearchFormState,
} from './search-engine/search-form-state'
import { buildResultUrl } from './search-engine/shared-state'
import type { SharedSearchState } from './search-engine/shared-state'
import type {
  PreferredCategoryCount,
  ResistanceElement,
  SearchOptions,
  SkillRequirement,
  SkillTierThresholds,
} from './search-engine/types'

/** How many of a weapon's (always up to 3, confirmed against the real
 * dataset -- every Zenith-infused weapon has exactly 3, and a plain one can
 * always reach 3 too) open slots the search is allowed to spend on
 * decorations. Defaults to 0 -- unlike every other slot/cuff, a weapon's
 * remaining slots are commonly spent on Weapon Sigils instead (a mechanic
 * entirely outside this tool's scope, confirmed by the project owner), so
 * assuming the solver can freely claim all of them would silently assume
 * away the player's own use for them. */
const WEAPON_SLOT_COUNT_OPTIONS = [0, 1, 2, 3] as const

const HUNTER_TYPE_FILTER_OPTIONS: readonly {
  readonly value: HunterTypeFilter
  readonly label: string
}[] = [
  { value: 'blademaster', label: 'Blademaster' },
  { value: 'gunner', label: 'Gunner' },
]

/** The 5 elements `SearchOptions.resistanceFloors` can constrain (docs/
 * feedback.md Round 1 #4) -- labels capitalized for display, values matching
 * `ResistanceElement` exactly. */
const RESISTANCE_ELEMENT_OPTIONS: readonly {
  readonly value: ResistanceElement
  readonly label: string
}[] = [
  { value: 'fire', label: 'Fire' },
  { value: 'water', label: 'Water' },
  { value: 'thunder', label: 'Thunder' },
  { value: 'ice', label: 'Ice' },
  { value: 'dragon', label: 'Dragon' },
]

/** A two-position slider standing in for a plain `<select>` (2026-10-15, per
 * the project owner: Hunter Type is a required, build-defining choice -- not
 * an optional filter -- so it got pulled out of the collapsible Weapon
 * section into its own always-visible control, styled as an on/off-style
 * switch except each side is labeled with the option it picks rather than
 * generic "on"/"off"). Sits directly above the Weapon section it used to live
 * inside (2026-10-15, per the project owner) -- it's a weapon-driven choice,
 * so it reads naturally right next to that section without needing its own
 * explanatory text (also dropped per the project owner: what it does is
 * self-evident from the two labeled halves of the switch itself). */
function HunterTypeToggle({
  value,
  onChange,
}: {
  readonly value: HunterTypeFilter
  readonly onChange: (next: HunterTypeFilter) => void
}) {
  return (
    <div className="app-field-group app-hunter-type-field">
      <div
        className="hunter-type-toggle"
        role="group"
        aria-labelledby="hunter-type-label"
        data-selected={value}
      >
        <div className="hunter-type-toggle-thumb" aria-hidden="true" />
        {HUNTER_TYPE_FILTER_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className="hunter-type-toggle-option"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

type SearchStatus = 'idle' | 'searching' | 'done' | 'error'

// The search engine formulates each query as a mixed-integer program and
// gets additional ranked results via a "solve, exclude, re-solve" loop (see
// search-engine/engine.ts's module docstring) -- each one is a real solver
// round-trip costing anywhere from milliseconds to tens of seconds,
// unlike the old Pareto-dominance engine's sub-second streaming. A "top 20"
// cap made sense when results were nearly free; now it risks the UI sitting
// on a search for minutes just to fill a page nobody asked to wait that long
// for. Defaults lower, and still stopping the search as soon as the cap is
// reached (the same cancellation the user's own Cancel button uses) -- results
// still stream in one at a time as each round completes, so the user sees
// progress immediately rather than waiting for the whole batch.
const DEFAULT_MAX_RESULTS = 5

// A user-facing dropdown (docs/skill-system-roadmap.md TODO #13) rather than
// a free-typed number: each extra result is a full extra solver round-trip
// (see above), so the options stay in the same cheap-to-expensive range the
// old hardcoded default lived in rather than letting an arbitrary number
// stall the page. Extended past 50 (docs/feedback.md Round 2 #1, 2026-10-19
// per the project owner) -- no engine change needed, just more iterations of
// the same loop.
const MAX_RESULTS_OPTIONS = [1, 3, 5, 10, 20, 50, 100, 150, 250] as const

/** Result-sort options (docs/feedback.md Round 2 #3, 2026-10-19) -- a pure
 * client-side re-sort of the already-solved `results` array, since every
 * value sorted on here (`result-stats.ts`'s `computeResultStats`) is cheap
 * to derive and already computed per-card for display. 'default' keeps the
 * solver's own ranking (best match first), the same order shown before this
 * control existed. */
type ResultSortOption = 'default' | 'defense' | 'resistances' | 'skillsOverCap'

const RESULT_SORT_LABELS: Record<ResultSortOption, string> = {
  default: 'Best match',
  defense: 'Total defense (highest first)',
  resistances: 'Resistances (best first)',
  skillsOverCap: 'Skills over cap (fewest first)',
}

// A cuff that's unobtainable in the real game (removed, unimplemented, or
// training-quest-only) is excluded from the general pool unconditionally --
// not even a leaf in CUFF_CATEGORY_GROUPS at all (see its own docstring and
// `cuffsAfterCategoryFilter`'s `UNOBTAINABLE_CUFF_CATEGORIES` in
// build-query.ts). Equipment's own matching leaves ("Unavailable") got the
// same treatment on 2026-10-20, and cuffs' own (previously a narrower,
// default-excluded-but-togglable `DEFAULT_EXCLUDED_CUFF_CATEGORIES` set)
// followed suit the same day -- there was never a legitimate reason to
// re-include any of them. Premium cuffs themselves are still fine to offer by
// default despite needing Poogie to be wearing Premium clothes (confirmed by
// the project owner, 2026-10-15) -- only their own Unavailable leaf is gone,
// not the whole "Premium Poogie Cuffs" group.
//
// Tower Gems and the 3 equipment-side "Unavailable" leaves get the identical
// unconditional treatment on the decoration side -- not even leaves in
// DECORATION_CATEGORY_GROUPS at all (see decoration-categories.ts's own
// docstring and `decorationsAfterCategoryFilter`'s
// `UNOBTAINABLE_DECORATION_CATEGORIES`, which also folds in Lottery Hiden
// Decorations as of 2026-10-20, previously this set's own
// `deco_lottery_hiden` entry). SP Decorations are ALSO excluded
// unconditionally via that same mechanism, but stay real, visible leaves
// here -- default-excluded purely so their checkbox state matches that
// unconditional exclusion (2026-10-18, per the project owner).
const DEFAULT_EXCLUDED_DECORATION_CATEGORIES = new Set(['deco_sp', 'deco_sp_lv2', 'deco_sp_lv3'])

function countLeaves(groups: readonly CategoryFilterGroup[]): number {
  return groups.reduce((sum, group) => sum + group.categories.length, 0)
}

const GEAR_LEVEL_LEAF_COUNT = countLeaves(GEAR_CATEGORY_GROUPS)
const CUFF_LEAF_COUNT = countLeaves(CUFF_CATEGORY_GROUPS)
const DECORATION_LEAF_COUNT = countLeaves(DECORATION_CATEGORY_GROUPS)

/** The "Gear categories" disclosure's own top-level quick toggles -- one
 * checkbox per gear-strength tier, each including/excluding every leaf
 * category under it in one click (docs/feedback.md Round 2 #6, 2026-10-19).
 * Separate from `GEAR_CATEGORY_GROUPS`'s own group headers, since a tier
 * here spans several of those groups (e.g. "Zenith" covers the base Zenith
 * group plus the Zenith leaves inside Hunter's Road and Event Armor).
 *
 * **Update (2026-10-20):** added "ZP" as its own 4th tier (previously folded
 * into "Zenith"), per the project owner -- it sits last, after "Zenith" on
 * the rank ladder (see `GEAR_LEVEL_ZP_CATEGORIES`'s own doc comment). */
const GEAR_LEVEL_TIERS: readonly { readonly label: string; readonly keys: readonly string[] }[] = [
  { label: 'Pre-G-Rank', keys: GEAR_LEVEL_PRE_GRANK_CATEGORIES },
  { label: 'G-Rank', keys: GEAR_LEVEL_GRANK_CATEGORIES },
  { label: 'Zenith', keys: GEAR_LEVEL_ZENITH_CATEGORIES },
  { label: 'ZP', keys: GEAR_LEVEL_ZP_CATEGORIES },
]

function pluralize(count: number, noun: string, plural: string = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : plural}`
}

/** Renders the "Searching…" suffix from HiGHS's own `mip_gap` for the round
 * in progress (docs/feedback.md Round 3 #3) -- e.g. "… (85%)" -- as a
 * completion percentage (`1 - gap`), clamped since `mip_gap` can run above 1
 * before a first incumbent is found. `null` (no callback has fired yet for
 * this round, or `gap` wasn't a finite number) renders nothing, same as
 * before this feature existed. */
function formatSearchProgress(gap: number | null): string {
  if (gap === null || !Number.isFinite(gap)) return '…'
  const percent = Math.round(Math.max(0, Math.min(1, 1 - gap)) * 100)
  return `… (${percent}%)`
}

/** Groups any `{category, name}`-shaped catalog (armor candidates, cuffs,
 * decorations) by its own `category` key, for `CategoryFilter`'s "View"
 * toggle (docs/feedback.md Round 1 #2). */
function groupByCategory<T extends { readonly category: string; readonly name: string }>(
  items: readonly T[],
): ReadonlyMap<string, readonly T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const list = map.get(item.category)
    if (list) list.push(item)
    else map.set(item.category, [item])
  }
  return map
}

/** Every piece of the main search page's own state that a shared result's
 * "use as a base for a new search" button (docs/skill-system-roadmap.md
 * TODO #9) can hand back in -- a one-time seed read by `App`'s own
 * `useState` initializers, not a controlled prop (`App` still owns all of
 * this once mounted). `AppRoot` forces a fresh `App` mount (via its `key`)
 * whenever it hands over a new `initialState`, since `useState`'s initial
 * value is otherwise only read once. */
export interface AppInitialState {
  readonly requirements: readonly SkillRequirement[]
  readonly zenithRequirements: readonly SkillRequirement[]
  readonly excludedCategories: ReadonlySet<string>
  readonly excludedCuffCategories: ReadonlySet<string>
  readonly excludedDecorationCategories: ReadonlySet<string>
  readonly excludedWeaponZenithSkillIds: ReadonlySet<string> | null
  readonly weaponSlotCount: number
  readonly hunterTypeFilter?: HunterTypeFilter
  readonly pinnedArmor: ReadonlyMap<string, PinnedSlot>
  readonly pinnedCuffSlots: readonly PinnedCuffSlot[]
  readonly pinnedSlotDecorationIds?: ReadonlyMap<string, readonly string[]>
  readonly excludedArmorIds?: ReadonlySet<string>
  readonly excludedDecorationIds?: ReadonlySet<string>
  readonly excludedCuffIds?: ReadonlySet<string>
  readonly excludedSkillIds?: ReadonlySet<string>
  readonly preferredArmorIds?: ReadonlySet<string>
  /** Gear categories (and piece counts) to favor using several pieces from
   * (2026-10-20, per the project owner) -- optional, same "not every seed
   * source has an opinion on every field" convention as the other optional
   * fields here. */
  readonly preferredCategoryCounts?: readonly PreferredCategoryCount[]
  /** Elements required to stay at or above zero, summed across every chosen
   * candidate (docs/feedback.md Round 1 #4) -- optional, same "not every
   * seed source has an opinion on every field" convention as the other
   * optional fields here. */
  readonly nonNegativeResistances?: ReadonlySet<ResistanceElement>
  readonly preferExactMatches: boolean
  readonly maxResults?: number
}

function App({ initialState }: { readonly initialState?: AppInitialState } = {}) {
  const bundleQuery = useDataBundle()
  const worker = useSearchWorker()

  // Only consulted as a fallback for a field `initialState` doesn't already
  // specify -- an explicit "use as a base for a new search"/shared-link seed
  // always wins over whatever was merely left over from a previous session
  // (docs/skill-system-roadmap.md TODO #18). Computed once via `useState`'s
  // own lazy-initializer trick (not a plain `const`), since re-reading
  // `localStorage` on every render would be wasted work for a value that's
  // only ever consulted while seeding the `useState` calls below.
  const [persisted] = useState(() => loadSearchFormState())

  const [requirements, setRequirements] = useState<SkillRequirement[]>(() => [
    ...(initialState?.requirements ?? persisted?.requirements ?? []),
  ])
  const [zenithRequirements, setZenithRequirements] = useState<SkillRequirement[]>(() => [
    ...(initialState?.zenithRequirements ?? persisted?.zenithRequirements ?? []),
  ])
  const [excludedCategories, setExcludedCategories] = useState<Set<string>>(
    () => new Set(initialState?.excludedCategories ?? persisted?.excludedCategories ?? []),
  )
  const [excludedCuffCategories, setExcludedCuffCategories] = useState<Set<string>>(
    () => new Set(initialState?.excludedCuffCategories ?? persisted?.excludedCuffCategories ?? []),
  )
  const [excludedDecorationCategories, setExcludedDecorationCategories] = useState<Set<string>>(
    () =>
      new Set(
        initialState?.excludedDecorationCategories ??
          persisted?.excludedDecorationCategories ??
          DEFAULT_EXCLUDED_DECORATION_CATEGORIES,
      ),
  )
  // `null` until the user first touches the checklist -- the weapon Zenith
  // skill catalog is bundle-provided data, not a static constant like
  // CUFF_CATEGORY_GROUPS, so there's no fixed default set to seed useState
  // with up front (see `defaultExcludedWeaponZenithSkillIds` below).
  const [excludedWeaponZenithSkillIds, setExcludedWeaponZenithSkillIds] =
    useState<Set<string> | null>(() => {
      const seed =
        initialState?.excludedWeaponZenithSkillIds ?? persisted?.excludedWeaponZenithSkillIds
      return seed ? new Set(seed) : null
    })
  const [weaponSlotCount, setWeaponSlotCount] = useState(
    () => initialState?.weaponSlotCount ?? persisted?.weaponSlotCount ?? 0,
  )
  // Defaults to Blademaster (2026-10-15, per the project owner): Hunter Type
  // is fixed by weapon choice in-game, not a per-piece trait -- Blademaster-
  // and Gunner-restricted armor can never be mixed in the same build, so
  // this is a required choice, not an optional filter like the category
  // checklists above it.
  const [hunterTypeFilter, setHunterTypeFilter] = useState<HunterTypeFilter>(
    () => initialState?.hunterTypeFilter ?? persisted?.hunterTypeFilter ?? 'blademaster',
  )
  const [pinnedArmor, setPinnedArmor] = useState<ReadonlyMap<string, PinnedSlot>>(
    () => new Map(initialState?.pinnedArmor ?? persisted?.pinnedArmor ?? []),
  )
  // Up to MAX_EQUIPPED_CUFFS (2) pins, index 0 = cuff slot 1 -- see
  // CuffPicker's own docstring and PinnedCuffSlot.
  const [pinnedCuffSlots, setPinnedCuffSlots] = useState<readonly PinnedCuffSlot[]>(() => [
    ...(initialState?.pinnedCuffSlots ?? persisted?.pinnedCuffSlots ?? []),
  ])
  // Decorations forced into a slot without pinning its piece (TODO #12) --
  // see ArmorPicker.tsx's own docstring.
  const [pinnedSlotDecorationIds, setPinnedSlotDecorationIds] = useState<
    ReadonlyMap<string, readonly string[]>
  >(
    () =>
      new Map(initialState?.pinnedSlotDecorationIds ?? persisted?.pinnedSlotDecorationIds ?? []),
  )
  // Armor/decoration/cuff ids the player never wants to see in a result at
  // all (docs/skill-system-roadmap.md's equipment-exclusion feature) -- see
  // EquipmentExclusionPicker.tsx's own docstring.
  const [excludedArmorIds, setExcludedArmorIds] = useState<Set<string>>(
    () => new Set(initialState?.excludedArmorIds ?? persisted?.excludedArmorIds ?? []),
  )
  const [excludedDecorationIds, setExcludedDecorationIds] = useState<Set<string>>(
    () => new Set(initialState?.excludedDecorationIds ?? persisted?.excludedDecorationIds ?? []),
  )
  const [excludedCuffIds, setExcludedCuffIds] = useState<Set<string>>(
    () => new Set(initialState?.excludedCuffIds ?? persisted?.excludedCuffIds ?? []),
  )
  // Skill ids (stringified) excluded the same way -- any armor piece,
  // decoration, or cuff granting one of these is dropped entirely (docs/
  // skill-system-roadmap.md's exclusions generalization, 2026-10-18 per the
  // project owner).
  const [excludedSkillIds, setExcludedSkillIds] = useState<Set<string>>(
    () => new Set(initialState?.excludedSkillIds ?? persisted?.excludedSkillIds ?? []),
  )
  // Armor piece ids the solver should favor using when it can (docs/
  // feedback.md Round 2 #2, "prefer using any of these pieces if possible")
  // -- see build-query.ts's `QueryFormState.preferredArmorIds` own docstring.
  const [preferredArmorIds, setPreferredArmorIds] = useState<Set<string>>(
    () => new Set(initialState?.preferredArmorIds ?? persisted?.preferredArmorIds ?? []),
  )
  // Gear categories (and piece counts) to favor using several pieces from
  // (2026-10-20, per the project owner) -- see PreferredCategoryPicker.tsx's
  // own docstring. A `Map` (category -> count), not a `Set` like the other
  // preference/exclusion state above, since each entry also carries a count.
  const [preferredCategoryCounts, setPreferredCategoryCounts] = useState<Map<string, number>>(
    () =>
      new Map(
        (initialState?.preferredCategoryCounts ?? persisted?.preferredCategoryCounts ?? []).map(
          (p) => [p.category, p.count],
        ),
      ),
  )
  // Elements required to stay at or above zero (docs/feedback.md Round 1 #4)
  // -- empty by default, same "don't silently assume a new feature's most
  // restrictive state" precedent as `DEFAULT_EXCLUDED_DECORATION_CATEGORIES`,
  // just in the opposite direction (nothing constrained until the player
  // opts an element in).
  const [nonNegativeResistances, setNonNegativeResistances] = useState<Set<ResistanceElement>>(
    () => new Set(initialState?.nonNegativeResistances ?? persisted?.nonNegativeResistances ?? []),
  )
  // Defaults to on (2026-10-15, per the project owner): an unrequested skill
  // reaching one of its own tiers unprompted is more often a surprise than a
  // win, so this app now ranks against that by default rather than requiring
  // an opt-in.
  const [preferExactMatches, setPreferExactMatches] = useState(
    () => initialState?.preferExactMatches ?? persisted?.preferExactMatches ?? true,
  )
  const [maxResults, setMaxResults] = useState(
    () => initialState?.maxResults ?? persisted?.maxResults ?? DEFAULT_MAX_RESULTS,
  )
  const [results, setResults] = useState<NamedBuildResult[]>([])
  const [sortBy, setSortBy] = useState<ResultSortOption>('default')
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null)
  const [reachedCap, setReachedCap] = useState(false)
  // Set when a search round's own time box ran out without proving the query
  // either way (`engine.ts`'s `SearchEndReason`), with zero results so far --
  // distinct from a confirmed-impossible query, which never sets this
  // (docs/feedback.md Round 3 #4's "search longer" retry). Only meaningful
  // together with `results.length === 0`; a later successful search clears it
  // via `handleSearch`'s own reset, same as `reachedCap`.
  const [timedOutEmpty, setTimedOutEmpty] = useState(false)
  // HiGHS's own `mip_gap` for the round currently solving (docs/feedback.md
  // Round 3 #3) -- `null` until the first callback fires each round, so the
  // UI shows plain "Searching…" rather than a stale number from a prior one.
  const [searchProgress, setSearchProgress] = useState<number | null>(null)

  const bundle = bundleQuery.data

  // Deferred (React 19 `useDeferredValue`), same reasoning as
  // `deferredQueryFormState` further down -- `pinnableSlots`/
  // `pinnableDecorations` below re-filter the whole ~62k-candidate bundle on
  // every change, and the top-level "Gear categories" rank-toggle checkboxes
  // (Pre-G-Rank/G-Rank/Zenith/ZP) can each flip dozens of categories in one
  // click, so without this a click there stalls until that refilter finishes
  // instead of repainting immediately (2026-10-20, per the project owner:
  // "the gear level checkboxes at the top can still be quite slow... fix
  // that the same way").
  const deferredExcludedCategories = useDeferredValue(excludedCategories)
  const deferredExcludedDecorationCategories = useDeferredValue(excludedDecorationCategories)
  const deferredHunterTypeFilter = useDeferredValue(hunterTypeFilter)

  // Pure client-side re-sort of the already-solved `results` (docs/
  // feedback.md Round 2 #3) -- 'default' keeps the solver's own ranking
  // untouched (including while `bundle` hasn't loaded yet, though `results`
  // is always empty at that point anyway). Every card already computes these
  // same stats for display (`ResultsList.tsx`, via this same
  // `result-stats.ts` module), so sorting by them here can't disagree with
  // what's shown.
  const sortedResults = useMemo<NamedBuildResult[]>(() => {
    if (sortBy === 'default' || !bundle) return results
    const withStats = results.map((result) => ({
      result,
      stats: computeResultStats(
        result.picks,
        result.skillTotals,
        bundle.skills,
        bundle.zenithSkills,
        result.cuffs,
      ),
    }))
    if (sortBy === 'defense') {
      withStats.sort((a, b) => b.stats.totalDefense - a.stats.totalDefense)
    } else if (sortBy === 'resistances') {
      withStats.sort(
        (a, b) => resistanceScore(b.stats.resistances) - resistanceScore(a.stats.resistances),
      )
    } else {
      withStats.sort((a, b) => a.stats.disabledCount - b.stats.disabledCount)
    }
    return withStats.map((w) => w.result)
  }, [results, sortBy, bundle])

  // Decorations excluded by the filter below are excluded from manual
  // pinning the same way they're excluded from the solver's own pool (see
  // build-query.ts's `decorationsAfterCategoryFilter`) -- otherwise a player
  // could still pin an excluded decoration into a slot through ArmorPicker
  // even though the search itself never would.
  const pinnableDecorations = useMemo(
    () =>
      bundle
        ? decorationsAfterCategoryFilter(bundle.decorations, deferredExcludedDecorationCategories)
        : [],
    [bundle, deferredExcludedDecorationCategories],
  )

  // Same reasoning, for "Pin specific armor" itself (docs/skill-system-
  // roadmap.md TODOs #33/#35): without this, the piece search/pin could
  // still find and pin a piece from an excluded Gear-level category, or one
  // restricted to the Hunter Type the build isn't using, even though the
  // free search would never suggest either. Deliberately NOT applied to
  // `allArmorCandidates` below -- the equipment-exclusion picker excludes a
  // specific item by id regardless of category, a broader net than this.
  //
  // An already-pinned piece is kept available even if a later category/
  // Hunter Type change would now exclude it, so the picker keeps showing it
  // (with its Change/Clear controls) instead of silently acting as if
  // nothing were pinned there -- the actual search still honors the pin
  // either way, since `slotsAfterPinning` resolves it from the unfiltered
  // `bundle.slots`.
  const pinnableSlots = useMemo(() => {
    if (!bundle) return []
    return slotsAfterHunterTypeFilter(
      slotsAfterCategoryFilter(bundle.slots, deferredExcludedCategories),
      deferredHunterTypeFilter,
    ).map((slot) => {
      const pin = pinnedArmor.get(slot.slotId)
      if (!pin || slot.candidates.some((c) => c.id === pin.candidateId)) return slot
      const pinnedCandidate = bundle.slots
        .find((s) => s.slotId === slot.slotId)
        ?.candidates.find((c) => c.id === pin.candidateId)
      return pinnedCandidate ? { ...slot, candidates: [...slot.candidates, pinnedCandidate] } : slot
    })
  }, [bundle, deferredExcludedCategories, deferredHunterTypeFilter, pinnedArmor])

  // Flattened once for the exclusion picker (EquipmentExclusionPicker.tsx),
  // which searches across every slot's armor at once rather than per-slot
  // the way ArmorPicker's pinning UI does -- excluding a piece by id doesn't
  // care which slot it happens to belong to.
  const allArmorCandidates = useMemo(
    () => bundle?.slots.flatMap((slot) => slot.candidates) ?? [],
    [bundle],
  )

  // ArmorPicker builds its own name/tier lookups from this (not `bundle.skillNames`
  // directly -- it also needs each skill's own tiers for its "Pinned skill
  // totals" active-cap display, not just its name). Needs both catalogs --
  // a Zenith-armor piece's own `skills` entries can include a Zenith skill
  // contribution alongside its normal ones (e.g. "Skill Slots Up"), which
  // `bundle.skills` alone can't name (bug found 2026-10-19, per the project
  // owner: a pinned piece's hover summary showed "Skill 1000001" instead of
  // its real Zenith skill name).
  const armorPickerSkills = useMemo(
    () => [...(bundle?.skills ?? []), ...(bundle?.zenithSkills ?? [])],
    [bundle],
  )

  // Every skill id's own name plus its tier labels, pre-joined and lowercased
  // -- lets `EquipmentExclusionPicker.tsx`'s armor/decoration/cuff exclusion
  // lists match a tier/threshold name too, not just a skill's own name (docs/
  // feedback.md Round 2 #8, 2026-10-19 per the project owner), the same
  // extension `ArmorPicker.tsx` makes to its own piece search.
  const skillSearchTextById = useMemo(
    () =>
      new Map(
        [...(bundle?.skills ?? []), ...(bundle?.zenithSkills ?? [])].map((s) => [
          s.id,
          [s.name, ...s.tiers.map((t) => t.label)].join(' ').toLowerCase(),
        ]),
      ),
    [bundle],
  )

  // {id, name} pairs for the "Skills" exclusion list (EquipmentExclusionPicker.tsx)
  // -- ids are stringified to match every other exclusion set's convention
  // (see AppInitialState.excludedSkillIds's own docstring), converted back to
  // numbers only where build-query.ts actually filters by skill id.
  const excludableSkillOptions = useMemo(
    () => (bundle?.skills ?? []).map((s) => ({ id: String(s.id), name: s.name })),
    [bundle],
  )

  // {id, name} pairs for CuffPicker's "By skill" pin mode (docs/skill-system-
  // roadmap.md TODO #25) -- unlike excludableSkillOptions above, includes
  // Zenith skills too (the project owner: "pin a skill or Zenith skill
  // instead of a specific cuff"), since a cuff can grant either.
  const pinnableCuffSkillOptions = useMemo(
    () =>
      [...(bundle?.skills ?? []), ...(bundle?.zenithSkills ?? [])].map((s) => ({
        id: String(s.id),
        name: s.name,
      })),
    [bundle],
  )

  // Lets query-code.ts resolve every id it stores (skills, armor,
  // decorations, cuffs) to its real name and back -- see that module's own
  // docstring (2026-10-17, per the project owner: "human readable... instead
  // of base64 encoded"). `null` while the bundle hasn't loaded yet, same as
  // `worker` above; the Save/load section is only ever reachable once it has.
  const queryCodeCatalog = useMemo<QueryCodeCatalog | null>(
    () =>
      bundle
        ? {
            skills: bundle.skills,
            zenithSkills: bundle.zenithSkills,
            armorCandidates: allArmorCandidates,
            decorations: bundle.decorations,
            cuffs: bundle.cuffs,
            gearCategories: GEAR_CATEGORY_GROUPS,
            cuffCategories: CUFF_CATEGORY_GROUPS,
            decorationCategories: DECORATION_CATEGORY_GROUPS,
          }
        : null,
    [bundle, allArmorCandidates],
  )

  // Grouped by category key for each category tree's own "View" toggle
  // (docs/feedback.md Round 1 #2: "see what's actually in a category") --
  // `CategoryFilter`'s own `itemsByCategory` prop. Armor is grouped from the
  // already-flattened `allArmorCandidates` above rather than re-flattening.
  const gearItemsByCategory = useMemo(
    () => groupByCategory(allArmorCandidates),
    [allArmorCandidates],
  )
  const cuffItemsByCategory = useMemo(() => groupByCategory(bundle?.cuffs ?? []), [bundle])
  const decorationItemsByCategory = useMemo(
    () => groupByCategory(bundle?.decorations ?? []),
    [bundle],
  )

  // The engine only needs each skill's point thresholds (not its name or
  // description) to tell a harmless incidental bonus point apart from one
  // that actually crosses into one of the skill's own tiers -- see
  // SearchOptions.skillTiers and ilp-model.ts's buildModel.
  const skillTiers = useMemo<SkillTierThresholds[]>(
    () =>
      [...(bundle?.skills ?? []), ...(bundle?.zenithSkills ?? [])].map((skill) => ({
        skillId: skill.id,
        tierThresholds: skill.tiers.map((tier) => tier.minPoints),
      })),
    [bundle],
  )

  // Starts with every real Zenith skill excluded (only the "no Zenith skill"
  // leaf included) -- today's app has no weapon slot at all, so this exact
  // starting point is the one that changes nothing about an existing search
  // until the player opts a skill in, matching
  // DEFAULT_EXCLUDED_DECORATION_CATEGORIES's own "don't silently assume a new
  // feature's most permissive state" precedent.
  const defaultExcludedWeaponZenithSkillIds = useMemo(
    () => new Set((bundle?.weaponZenithSkillIds ?? []).map(String)),
    [bundle],
  )
  const effectiveExcludedWeaponZenithSkillIds =
    excludedWeaponZenithSkillIds ?? defaultExcludedWeaponZenithSkillIds

  const weaponZenithSkillGroups = useMemo<CategoryFilterGroup[]>(() => {
    if (!bundle) return []
    const nameById = new Map(bundle.zenithSkills.map((skill) => [skill.id, skill.name]))
    return [
      {
        label: 'Weapon Zenith skill',
        categories: [
          { key: WEAPON_NO_ZENITH_SKILL_KEY, label: 'No Zenith skill' },
          ...bundle.weaponZenithSkillIds.map((id) => ({
            key: String(id),
            label: nameById.get(id) ?? `Zenith skill ${id}`,
          })),
        ],
      },
    ]
  }, [bundle])

  // One-line descriptions shown on each collapsed section's header (see
  // components/Disclosure.tsx) so a closed section still communicates its
  // current state at a glance, rather than requiring a click to check.
  const skillsSummary =
    requirements.length === 0 ? 'None yet' : pluralize(requirements.length, 'skill')
  const zenithSkillsSummary =
    zenithRequirements.length === 0 ? 'None yet' : pluralize(zenithRequirements.length, 'skill')
  const pinnedArmorSummary = (() => {
    const pieceCount = pinnedArmor.size
    const decorationOnlyCount = [...pinnedSlotDecorationIds.keys()].filter(
      (slotId) => !pinnedArmor.has(slotId),
    ).length
    if (pieceCount === 0 && decorationOnlyCount === 0) return 'None pinned'
    const parts = [
      pieceCount > 0 ? `${pluralize(pieceCount, 'slot')} pinned` : null,
      decorationOnlyCount > 0 ? `${pluralize(decorationOnlyCount, 'slot')} deco-only` : null,
    ].filter((p): p is string => p !== null)
    return parts.join(', ')
  })()
  const pinnedCuffsSummary =
    pinnedCuffSlots.length === 0
      ? 'None pinned'
      : `${pluralize(pinnedCuffSlots.length, 'cuff')} pinned`
  const exclusionsSummary = (() => {
    const total =
      excludedArmorIds.size +
      excludedDecorationIds.size +
      excludedCuffIds.size +
      excludedSkillIds.size
    return total === 0 ? 'None excluded' : `${pluralize(total, 'item')} excluded`
  })()
  const preferredSummary = (() => {
    const parts = [
      preferredArmorIds.size > 0 ? pluralize(preferredArmorIds.size, 'piece') : null,
      preferredCategoryCounts.size > 0
        ? pluralize(preferredCategoryCounts.size, 'category', 'categories')
        : null,
    ].filter((p): p is string => p !== null)
    return parts.length === 0 ? 'None preferred' : `${parts.join(', ')} preferred`
  })()
  const resistancesSummary =
    nonNegativeResistances.size === 0
      ? 'None required'
      : `${pluralize(nonNegativeResistances.size, 'element')} required ≥ 0`
  const gearLevelsSummary =
    excludedCategories.size === 0
      ? 'All included'
      : `${pluralize(excludedCategories.size, 'category', 'categories')} of ${GEAR_LEVEL_LEAF_COUNT} excluded`
  const cuffsSummary =
    excludedCuffCategories.size === 0
      ? 'All included'
      : `${pluralize(excludedCuffCategories.size, 'category', 'categories')} of ${CUFF_LEAF_COUNT} excluded`
  const decorationsSummary =
    excludedDecorationCategories.size === 0
      ? 'All included'
      : `${pluralize(excludedDecorationCategories.size, 'tier', 'tiers')} of ${DECORATION_LEAF_COUNT} excluded`
  const weaponSummary = (() => {
    const total = bundle?.weaponZenithSkillIds.length ?? 0
    const excludedRealSkills = [...effectiveExcludedWeaponZenithSkillIds].filter(
      (key) => key !== WEAPON_NO_ZENITH_SKILL_KEY,
    ).length
    const allowed = total - excludedRealSkills
    return `${allowed} of ${total} Zenith skills allowed, ${weaponSlotCount} of 3 slots used for decorations`
  })()

  // Memoized (unlike before docs/feedback.md Round 2 #4) since the new live
  // skill-cap preview below now calls `buildSearchQuery` reactively on every
  // render affected by a selection change, not just once per button click
  // the way `handleSearch` alone used to -- a fresh object here would defeat
  // `builtQuery`'s own memoization and re-filter the full armor catalog on
  // every unrelated render.
  const queryFormState: QueryFormState = useMemo(
    () => ({
      excludedCategories,
      excludedCuffCategories,
      excludedDecorationCategories,
      excludedWeaponZenithSkillIds: effectiveExcludedWeaponZenithSkillIds,
      weaponSlotCount,
      hunterTypeFilter,
      pinnedArmor,
      pinnedCuffSlots,
      pinnedSlotDecorationIds,
      excludedArmorIds,
      excludedDecorationIds,
      excludedCuffIds,
      excludedSkillIds,
      preferredArmorIds,
      preferredCategoryCounts: [...preferredCategoryCounts].map(([category, count]) => ({
        category,
        count,
      })),
    }),
    [
      excludedCategories,
      excludedCuffCategories,
      excludedDecorationCategories,
      effectiveExcludedWeaponZenithSkillIds,
      weaponSlotCount,
      hunterTypeFilter,
      pinnedArmor,
      pinnedCuffSlots,
      pinnedSlotDecorationIds,
      excludedArmorIds,
      excludedDecorationIds,
      excludedCuffIds,
      excludedSkillIds,
      preferredArmorIds,
      preferredCategoryCounts,
    ],
  )

  // Deferred (React 19 `useDeferredValue`), not the raw state, so a checkbox
  // click -- especially a parent/group toggle, which can flip dozens of
  // category keys in one `onChange` -- repaints immediately instead of
  // waiting on `buildSearchQuery`/`previewActiveSkillCap` below to finish
  // re-filtering the ~62k-candidate bundle first (2026-10-20, per the project
  // owner: "clicking the checkmark on a parent category ... doesn't feel
  // responsive"). The checkboxes themselves still render off the immediate
  // `excludedCategories` etc. (via `queryFormState`), so they flip instantly;
  // only this expensive downstream preview lags behind by one low-priority
  // render, then catches up on its own.
  const deferredQueryFormState = useDeferredValue(queryFormState)

  // The solver's exact resolved candidate pool for the *current* selection,
  // before running an actual search -- reused by the live active-skill-cap
  // preview below (docs/feedback.md Round 2 #4) so it automatically honors
  // every existing category/id exclusion, pin, and Hunter Type filter the
  // same way a real search does, with no separate filtering logic of its own.
  const builtQuery = useMemo(
    () => (bundle ? buildSearchQuery(bundle, deferredQueryFormState) : null),
    [bundle, deferredQueryFormState],
  )

  // Shown before running a search, so the player can see the ceiling their
  // current Zenith-skill selections and pins still leave for the active-skill
  // cap to reach (docs/feedback.md Round 2 #4) -- see active-skill-cap.ts's
  // `previewActiveSkillCap` for the full algorithm.
  const skillCapPreview = useMemo(
    () =>
      builtQuery && bundle
        ? previewActiveSkillCap(
            builtQuery.slots,
            builtQuery.cuffs,
            builtQuery.pinnedCuffs,
            builtQuery.pinnedCuffSkillIds,
            zenithRequirements,
            bundle.zenithSkills,
          )
        : null,
    [builtQuery, bundle, zenithRequirements],
  )

  // Persists every search input on each change (docs/skill-system-roadmap.md
  // TODO #18), so refreshing the page restores the last search instead of
  // resetting to defaults. Saves `excludedWeaponZenithSkillIds` itself
  // (possibly `null`), not `effectiveExcludedWeaponZenithSkillIds` above --
  // saving the resolved default as if the user had explicitly chosen it would
  // freeze in today's Zenith-skill catalog, permanently losing the "untouched,
  // defer to whatever the default turns out to be" meaning `null` carries.
  useEffect(() => {
    saveSearchFormState({
      requirements,
      zenithRequirements,
      excludedCategories: [...excludedCategories],
      excludedCuffCategories: [...excludedCuffCategories],
      excludedDecorationCategories: [...excludedDecorationCategories],
      excludedWeaponZenithSkillIds: excludedWeaponZenithSkillIds
        ? [...excludedWeaponZenithSkillIds]
        : null,
      weaponSlotCount,
      hunterTypeFilter,
      pinnedArmor: [...pinnedArmor.entries()],
      pinnedCuffSlots,
      pinnedSlotDecorationIds: [...pinnedSlotDecorationIds.entries()],
      excludedArmorIds: [...excludedArmorIds],
      excludedDecorationIds: [...excludedDecorationIds],
      excludedCuffIds: [...excludedCuffIds],
      excludedSkillIds: [...excludedSkillIds],
      preferredArmorIds: [...preferredArmorIds],
      preferredCategoryCounts: [...preferredCategoryCounts].map(([category, count]) => ({
        category,
        count,
      })),
      nonNegativeResistances: [...nonNegativeResistances],
      preferExactMatches,
      maxResults,
    })
  }, [
    requirements,
    zenithRequirements,
    excludedCategories,
    excludedCuffCategories,
    excludedDecorationCategories,
    excludedWeaponZenithSkillIds,
    weaponSlotCount,
    hunterTypeFilter,
    pinnedArmor,
    pinnedCuffSlots,
    pinnedSlotDecorationIds,
    nonNegativeResistances,
    excludedArmorIds,
    excludedDecorationIds,
    excludedCuffIds,
    excludedSkillIds,
    preferredArmorIds,
    preferredCategoryCounts,
    preferExactMatches,
    maxResults,
  ])

  /** `timeBoxOverride` is only ever passed by the "Search longer" button
   * (docs/feedback.md Round 3 #4) -- an ordinary search always uses
   * `engine.ts`'s production defaults (`{}`). Kept as a parameter rather than
   * a second function so the retry reruns the *exact* same query (every
   * other option, requirement, and exclusion derived identically) with only
   * the time box itself widened. */
  function handleSearch(timeBoxOverride: Pick<SearchOptions, 'timeBoxSeconds' | 'maxTimeBoxAttempts'> = {}): void {
    const allRequirements = [...requirements, ...zenithRequirements]
    if (!worker || !bundle || allRequirements.length === 0) return

    setResults([])
    setErrorMessage(null)
    setReachedCap(false)
    setTimedOutEmpty(false)

    const {
      slots,
      decorations,
      cuffs,
      pinnedCuffs,
      pinnedSlotDecorations,
      excludedActiveSkillIds,
      pinnedCuffSkillIds,
      preferredCandidateIds,
    } = buildSearchQuery(bundle, queryFormState)

    // Splits on `SkillRequirement.optional` (docs/feedback.md Round 3 #2,
    // `SkillPicker.tsx`'s own "Optional" checkbox) -- only the hard ones ever
    // reach `search()`'s own `requirements` parameter or the up-front
    // unreachability check below; an optional one that can't be reached is
    // never a reason to block the search, that's the entire point of marking
    // it optional instead of leaving it a hard requirement.
    const hardRequirements = allRequirements.filter((r) => !r.optional)
    const optionalSkillRequirements = allRequirements
      .filter((r) => r.optional)
      .map((r) => ({ skillId: r.skillId, minPoints: r.minPoints, priority: r.priority ?? 1 }))

    // Caught before ever handing this to the solver (docs/feedback.md Round 1
    // #14) -- a requirement flagged here is provably unreachable no matter
    // what the solver tries, so there's no reason to spend a search round
    // (and the player's own wait) just to rediscover that the slow way.
    const unreachable = findUnreachableRequirements(
      slots,
      decorations,
      cuffs,
      hardRequirements,
      pinnedCuffs,
      pinnedSlotDecorations,
    )
    if (unreachable.length > 0) {
      const skillNames = bundle.skillNames
      const description = unreachable
        .map((u) => {
          const name = skillNames.get(u.skillId) ?? `Skill ${u.skillId}`
          return `${name} needs ${u.required}, but at most ${u.maxReachable} is reachable`
        })
        .join('; ')
      setStatus('error')
      setErrorMessage(
        `This search can never succeed: ${description}. Lower the requirement, or include more equipment that grants it.`,
      )
      return
    }

    setStatus('searching')
    setSearchProgress(null)

    let count = 0
    let capped = false
    const requestId = worker.search(
      slots,
      hardRequirements,
      decorations,
      {
        onResult: (result) => {
          // `worker.cancel` below races a message round-trip to the worker,
          // so a result or two can still arrive after the cap is hit --
          // ignoring them here keeps "top N" an actual guarantee, not just a
          // request.
          if (capped) return
          count++
          setResults((prev) => [...prev, result as unknown as NamedBuildResult])
          setSearchProgress(null) // next round starts fresh
          if (count >= maxResults) {
            capped = true
            worker.cancel(requestId)
            setReachedCap(true)
            setStatus('done')
          }
        },
        onProgress: (gap) => setSearchProgress(gap),
        onDone: () => setStatus('done'),
        onTimedOut: () => {
          setTimedOutEmpty(true)
          setStatus('done')
        },
        onError: (message) => {
          setStatus('error')
          setErrorMessage(message)
        },
      },
      {
        ...timeBoxOverride,
        preferExactMatches,
        skillTiers,
        pinnedCuffs,
        pinnedSlotDecorations,
        resistanceFloors: [...nonNegativeResistances].map((element) => ({ element, minTotal: 0 })),
        excludedActiveSkillIds,
        pinnedCuffSkillIds,
        preferredCandidateIds,
        preferredCategoryCounts: [...preferredCategoryCounts].map(([category, count]) => ({
          category,
          count,
        })),
        optionalSkillRequirements,
      },
      cuffs,
    )
    setActiveRequestId(requestId)
  }

  /** The "Search longer" retry (docs/feedback.md Round 3 #4) -- reruns the
   * exact same query with a much bigger per-round time box, for the one case
   * where that's worth the wait: a prior round gave up without ever proving
   * the query impossible (`onTimedOut` above), not a confirmed dead end.
   * These exact values (worst case 60+120+240=420s) are the ones
   * `engine.real-data.performance.test.ts` already confirmed reliably find a
   * result for the hardest known real query at this scale -- not raised as
   * the production *default* for every search, since that would equally
   * slow down the far more common case of a query that's genuinely
   * infeasible but slow for HiGHS to prove infeasible (see `engine.ts`'s
   * module docstring). */
  function handleSearchLonger(): void {
    handleSearch({ timeBoxSeconds: 60, maxTimeBoxAttempts: 3 })
  }

  // Save/load this search by a pasteable text code (docs/feedback.md #18) --
  // see query-code.ts's own docstring for how this differs from the
  // automatic localStorage persistence above.
  const [generatedQueryCode, setGeneratedQueryCode] = useState<string | null>(null)
  const [isGeneratingQueryCode, setIsGeneratingQueryCode] = useState(false)
  const [queryCodeInput, setQueryCodeInput] = useState('')
  const [queryCodeError, setQueryCodeError] = useState<string | null>(null)

  function handleGenerateQueryCode(): void {
    if (!queryCodeCatalog) return
    setIsGeneratingQueryCode(true)
    void encodeQueryCode(
      {
        requirements,
        zenithRequirements,
        excludedCategories: [...excludedCategories],
        excludedCuffCategories: [...excludedCuffCategories],
        excludedDecorationCategories: [...excludedDecorationCategories],
        excludedWeaponZenithSkillIds: excludedWeaponZenithSkillIds
          ? [...excludedWeaponZenithSkillIds]
          : null,
        weaponSlotCount,
        hunterTypeFilter,
        pinnedArmor: [...pinnedArmor.entries()],
        pinnedCuffSlots,
        pinnedSlotDecorationIds: [...pinnedSlotDecorationIds.entries()],
        excludedArmorIds: [...excludedArmorIds],
        excludedDecorationIds: [...excludedDecorationIds],
        excludedCuffIds: [...excludedCuffIds],
        excludedSkillIds: [...excludedSkillIds],
        preferredArmorIds: [...preferredArmorIds],
        preferredCategoryCounts: [...preferredCategoryCounts].map(([category, count]) => ({
          category,
          count,
        })),
        nonNegativeResistances: [...nonNegativeResistances],
        preferExactMatches,
        maxResults,
      },
      queryCodeCatalog,
    )
      .then(setGeneratedQueryCode)
      .finally(() => setIsGeneratingQueryCode(false))
  }

  function applyLoadedQueryState(state: SearchFormState): void {
    setRequirements([...state.requirements])
    setZenithRequirements([...state.zenithRequirements])
    setExcludedCategories(new Set(state.excludedCategories))
    setExcludedCuffCategories(new Set(state.excludedCuffCategories))
    setExcludedDecorationCategories(new Set(state.excludedDecorationCategories))
    setExcludedWeaponZenithSkillIds(
      state.excludedWeaponZenithSkillIds ? new Set(state.excludedWeaponZenithSkillIds) : null,
    )
    setWeaponSlotCount(state.weaponSlotCount)
    setHunterTypeFilter(state.hunterTypeFilter)
    setPinnedArmor(new Map(state.pinnedArmor))
    setPinnedCuffSlots([...state.pinnedCuffSlots])
    setPinnedSlotDecorationIds(new Map(state.pinnedSlotDecorationIds))
    setExcludedArmorIds(new Set(state.excludedArmorIds))
    setExcludedDecorationIds(new Set(state.excludedDecorationIds))
    setExcludedCuffIds(new Set(state.excludedCuffIds))
    setExcludedSkillIds(new Set(state.excludedSkillIds))
    setPreferredArmorIds(new Set(state.preferredArmorIds))
    setPreferredCategoryCounts(
      new Map(state.preferredCategoryCounts.map((p) => [p.category, p.count])),
    )
    setNonNegativeResistances(new Set(state.nonNegativeResistances))
    setPreferExactMatches(state.preferExactMatches)
    setMaxResults(state.maxResults)
  }

  function handleLoadQueryCode(): void {
    if (!queryCodeCatalog) return
    setQueryCodeError(null)
    void decodeQueryCode(queryCodeInput, queryCodeCatalog).then((state) => {
      if (!state) {
        setQueryCodeError('That code could not be read -- check it was copied in full.')
        return
      }
      applyLoadedQueryState(state)
      setQueryCodeInput('')
      setGeneratedQueryCode(null)
    })
  }

  function handleCancel(): void {
    if (worker && activeRequestId) worker.cancel(activeRequestId)
    setStatus('done')
  }

  // Discards every saved skill/pin/exclusion/etc and reloads to pick the
  // hardcoded defaults back up (2026-10-19, per the project owner) -- a full
  // reload rather than resetting each of this component's ~20 individual
  // `useState` calls by hand, since every one of them only ever reads
  // `loadSearchFormState()` once, at mount.
  function handleReset(): void {
    clearSearchFormState()
    window.location.reload()
  }

  // Builds a link to this exact result (docs/skill-system-roadmap.md TODO
  // #9) -- encodes the solved result itself (not just the query that
  // produced it, see shared-state.ts's own docstring for why TODO #15
  // changed this), so the result page never has to re-run the solver to
  // reconstruct what to show. Returns a Promise because encoding compresses
  // the payload (TODO #14) -- see shared-state.ts's own docstring.
  function buildShareUrl(resultIndex: number): Promise<string> {
    const result = sortedResults[resultIndex]
    const state: SharedSearchState = {
      requirements,
      zenithRequirements,
      excludedCategories: [...excludedCategories],
      excludedCuffCategories: [...excludedCuffCategories],
      excludedDecorationCategories: [...excludedDecorationCategories],
      excludedWeaponZenithSkillIds: excludedWeaponZenithSkillIds
        ? [...excludedWeaponZenithSkillIds]
        : null,
      weaponSlotCount,
      hunterTypeFilter,
      excludedArmorIds: [...excludedArmorIds],
      excludedDecorationIds: [...excludedDecorationIds],
      excludedCuffIds: [...excludedCuffIds],
      excludedSkillIds: [...excludedSkillIds],
      preferredArmorIds: [...preferredArmorIds],
      preferredCategoryCounts: [...preferredCategoryCounts].map(([category, count]) => ({
        category,
        count,
      })),
      nonNegativeResistances: [...nonNegativeResistances],
      preferExactMatches,
      result: {
        picks: [...result.picks.entries()].map(([slotId, c]) => ({
          slotId,
          id: c.id,
          name: c.name,
          openSlotCount: c.openSlotCount ?? null,
          grankOrLater: c.grankOrLater,
          exoticSkillId: c.exoticSkillId,
          defenseMax: c.defenseMax,
          resistances: c.resistances,
        })),
        decorations: [...result.decorations.entries()].map(([slotId, decorations]) => ({
          slotId,
          decorations: decorations.map((d) => ({ id: d.id, name: d.name, slotSize: d.slotSize })),
        })),
        cuffs: result.cuffs.map((c) => ({ id: c.id, name: c.name, skills: c.skills })),
        skillTotals: [...result.skillTotals.entries()],
      },
    }
    return buildResultUrl(state)
  }

  return (
    <main className="app-shell">
      <h1>Frontier Set Searcher</h1>
      <p className="app-intro">
        Thank you to <b>mertna</b> for the info and explanations at{' '}
        <b>mertna.github.io/MHFZ-Skills/</b>, thank you to <b>Ferias/xl3lackout</b> for the data
        gathered and categorized at <b>xl3lackout.github.io/MHFZ-Ferias-English-Project/</b>, and
        thank you to the makers and maintainers of <b>MHSX2G</b> for sanity checks and
        categorization, and for providing a basis to work from. <br />
        <b>Nenrikido</b>'s work on <b>github.com/Nenrikido/MH-Optimizer</b> is what made the search
        algorithm possible and actually usable for queries of this magnitude. <br />
        For transparency, much of this project was made by or with the help of AI in a strict
        environment based on test-driven-development.
      </p>

      {bundleQuery.isLoading && <p>Loading equipment data…</p>}
      {bundleQuery.isError && (
        <p role="alert">Couldn't load equipment data. Try reloading the page.</p>
      )}

      {bundle && (
        <>
          <div className="app-columns">
            <div className="app-column">
              <Disclosure
                title="Skills"
                summary={skillsSummary}
                defaultOpen
                info={
                  <InfoTooltip label="About skills">
                    Define the skills that the Set Searcher should look for. These are hard
                    requirements: each returned result has to contain every single one of these
                    skills at the specified level. <br />
                    <b>You can search by skill name and skill level/threshold names.</b>
                  </InfoTooltip>
                }
              >
                <SkillPicker
                  skills={bundle.skills}
                  requirements={requirements}
                  onChange={setRequirements}
                />
              </Disclosure>

              <Disclosure
                title="Zenith skills"
                summary={zenithSkillsSummary}
                info={
                  <InfoTooltip label="About Zenith skills">
                    Define the Zenith skills that the Set Searcher should look for. These are hard
                    requirements: each returned result has to contain every single one of these
                    skills at the specified level. <br />
                    <b>You can search by skill name and skill level/threshold names.</b>
                  </InfoTooltip>
                }
              >
                <SkillPicker
                  skills={bundle.zenithSkills}
                  requirements={zenithRequirements}
                  onChange={setZenithRequirements}
                  addLabel="Add a Zenith skill"
                />
              </Disclosure>
            </div>

            <div className="app-column">
              <Disclosure
                title="Pin specific armor"
                summary={pinnedArmorSummary}
                info={
                  <InfoTooltip label="About pinning armor">
                    Pins a specific piece or decoration to force the solver to use it. Type at least
                    2 characters to search. <br />
                    <b>You can search by skill name and skill level/threshold names.</b>
                  </InfoTooltip>
                }
              >
                <ArmorPicker
                  slots={pinnableSlots}
                  decorations={pinnableDecorations}
                  pinned={pinnedArmor}
                  onChange={setPinnedArmor}
                  pinnedSlotDecorationIds={pinnedSlotDecorationIds}
                  onChangeSlotDecorations={setPinnedSlotDecorationIds}
                  skills={armorPickerSkills}
                />
              </Disclosure>

              <Disclosure
                title="Preferred pieces"
                summary={preferredSummary}
                info={
                  <InfoTooltip label="About favoring gear">
                    The solver favors using more of your preferred pieces, and at least the chosen
                    count from each preferred category, outranking any other difference in a build
                    -- only falling short of either if it would otherwise make a skill requirement
                    unreachable. Neither forces an exact slot assignment the way pinning does.
                    <br />
                    <b>Pieces:</b> type at least 2 characters to search (also matches skill
                    name/level names); using more is always better.
                    <br />
                    <b>Categories:</b> set a 1-5 target per category; using more than the target is
                    never penalized.
                  </InfoTooltip>
                }
              >
                <div className="small text-muted mb-1">Pieces</div>
                <PreferredArmorPicker
                  armorCandidates={allArmorCandidates}
                  preferredIds={preferredArmorIds}
                  onChange={setPreferredArmorIds}
                  skillNameById={bundle.skillNames}
                  skillSearchTextById={skillSearchTextById}
                />
                <hr className="my-2" />
                <div className="small text-muted mb-1">Categories</div>
                <PreferredCategoryPicker
                  counts={preferredCategoryCounts}
                  onChange={setPreferredCategoryCounts}
                />
              </Disclosure>

              <Disclosure
                title="Gear categories"
                summary={gearLevelsSummary}
                info={
                  <InfoTooltip label="About the gear category list">
                    Choose which armor categories are included in the search. This affects both the
                    final results as well as the search elements in the sections. The categories can
                    be expanded and collapsed. The gear rank buttons at the top will include/exclude
                    all categories of that rank.
                  </InfoTooltip>
                }
              >
                <div className="gear-level-tiers d-flex gap-3 mb-2">
                  {GEAR_LEVEL_TIERS.map((tier) => {
                    const excludedCount = tier.keys.filter((key) =>
                      excludedCategories.has(key),
                    ).length
                    return (
                      <GroupCheckbox
                        key={tier.label}
                        label={tier.label}
                        checked={excludedCount === 0}
                        indeterminate={excludedCount > 0 && excludedCount < tier.keys.length}
                        // Distinct from the "Zenith" (etc.) *leaf* checkbox's
                        // own plain accessible name further down the tree --
                        // without this, two checkboxes would share the name
                        // "Zenith" and be indistinguishable to a screen
                        // reader (and to tests).
                        ariaLabel={`${tier.label} gear level`}
                        onChange={(checked) => {
                          setExcludedCategories((prev) => {
                            const next = new Set(prev)
                            for (const key of tier.keys) {
                              if (checked) next.delete(key)
                              else next.add(key)
                            }
                            return next
                          })
                        }}
                      />
                    )
                  })}
                </div>
                <CategoryFilter
                  groups={GEAR_CATEGORY_GROUPS}
                  excludedCategories={excludedCategories}
                  onChange={setExcludedCategories}
                  itemsByCategory={gearItemsByCategory}
                  tableLinkHash={(key) => categoryRouteHash('gear', key)}
                  defaultCollapsed
                  persistCollapseKey="frontier-set-searcher:gear-category-collapse:v1"
                />
                <a href={categoryRouteHash('gear')} className="category-filter-show-all-link">
                  Show all armor
                </a>
              </Disclosure>

              <Disclosure
                title="Poogie Cuff Categories"
                summary={cuffsSummary}
                info={
                  <InfoTooltip label="About the cuff category list">
                    Choose which cuff categories are included in the search. This affects both the
                    final results as well as the search elements in the sections. The categories can
                    be expanded and collapsed.
                  </InfoTooltip>
                }
              >
                <CategoryFilter
                  groups={CUFF_CATEGORY_GROUPS}
                  excludedCategories={excludedCuffCategories}
                  onChange={setExcludedCuffCategories}
                  itemsByCategory={cuffItemsByCategory}
                  tableLinkHash={(key) => categoryRouteHash('cuffs', key)}
                />
                <a href={categoryRouteHash('cuffs')} className="category-filter-show-all-link">
                  Show all cuffs
                </a>
              </Disclosure>

              <Disclosure
                title="Decoration Categories"
                summary={decorationsSummary}
                info={
                  <InfoTooltip label="About the decoration category list">
                    Choose which decoration categories are included in the search. This affects both
                    the final results as well as the search elements in the sections. The categories
                    can be expanded and collapsed.
                  </InfoTooltip>
                }
              >
                <CategoryFilter
                  groups={DECORATION_CATEGORY_GROUPS}
                  excludedCategories={excludedDecorationCategories}
                  onChange={setExcludedDecorationCategories}
                  itemsByCategory={decorationItemsByCategory}
                  tableLinkHash={(key) => categoryRouteHash('decorations', key)}
                />
                <a href={categoryRouteHash('decorations')} className="category-filter-show-all-link">
                  Show all decorations
                </a>
              </Disclosure>

              <Disclosure
                title="Pin specific cuffs"
                summary={pinnedCuffsSummary}
                info={
                  <InfoTooltip label="About pinning cuffs">
                    Pins a specific cuff to force the solver to use it, or pins a skill (or Zenith
                    skill), letting the solver pick whichever cuff with that skill best serves the
                    rest of the build. Type at least 2 characters to search. <br />
                    <b>You can also search cuffs by skill name.</b>
                  </InfoTooltip>
                }
              >
                <CuffPicker
                  cuffs={bundle.cuffs}
                  pinned={pinnedCuffSlots}
                  onChange={setPinnedCuffSlots}
                  skillNameById={bundle.skillNames}
                  pinnableSkills={pinnableCuffSkillOptions}
                  skillSearchTextById={skillSearchTextById}
                />
              </Disclosure>

              <Disclosure
                title="Exclusions"
                summary={exclusionsSummary}
                info={
                  <InfoTooltip label="About excluding gear">
                    Exclude armor, decorations, cuffs and skills to never appear in a search result.
                    If that same piece is pinned above, the pin is prioritized. Excluding a skill
                    means a result is never allowed to make that skill active, but equipment that
                    grants it stays eligible otherwise. Type at least 2 characters to search.
                    <br />
                    <b>
                      You can search armor, decorations, and cuffs by skill name and skill
                      level/threshold names.
                    </b>
                  </InfoTooltip>
                }
              >
                <EquipmentExclusionPicker
                  armorCandidates={allArmorCandidates}
                  decorations={bundle.decorations}
                  cuffs={bundle.cuffs}
                  skills={excludableSkillOptions}
                  excludedArmorIds={excludedArmorIds}
                  onChangeExcludedArmorIds={setExcludedArmorIds}
                  excludedDecorationIds={excludedDecorationIds}
                  onChangeExcludedDecorationIds={setExcludedDecorationIds}
                  excludedCuffIds={excludedCuffIds}
                  onChangeExcludedCuffIds={setExcludedCuffIds}
                  excludedSkillIds={excludedSkillIds}
                  onChangeExcludedSkillIds={setExcludedSkillIds}
                  skillNameById={bundle.skillNames}
                  skillSearchTextById={skillSearchTextById}
                />
              </Disclosure>
            </div>

            <div className="app-column">
              <div className="app-hunter-type-row">
                <HunterTypeToggle value={hunterTypeFilter} onChange={setHunterTypeFilter} />
                <button
                  type="button"
                  className="btn btn-sm btn-outline-danger"
                  onClick={handleReset}
                >
                  Reset
                </button>
              </div>

              <Disclosure
                title="Weapon"
                summary={weaponSummary}
                info={
                  <InfoTooltip label="About the weapon">
                    Choose which Zenith skill is allowed to be on the weapon and how many decoration
                    slots are reserved for sigils and should not be used to reach the skill
                    requirements.
                  </InfoTooltip>
                }
              >
                <div className="app-field-group">
                  <CategoryFilter
                    groups={weaponZenithSkillGroups}
                    excludedCategories={effectiveExcludedWeaponZenithSkillIds}
                    onChange={setExcludedWeaponZenithSkillIds}
                  />
                </div>
                <div className="app-field-group">
                  <label className="form-label" htmlFor="weapon-slot-count">
                    Weapon slots to use for decorations
                  </label>
                  <select
                    id="weapon-slot-count"
                    className="form-select w-auto"
                    value={weaponSlotCount}
                    onChange={(e) => setWeaponSlotCount(Number(e.target.value))}
                  >
                    {WEAPON_SLOT_COUNT_OPTIONS.map((count) => (
                      <option key={count} value={count}>
                        {count}
                      </option>
                    ))}
                  </select>
                </div>
              </Disclosure>

              <Disclosure
                title="Resistances"
                summary={resistancesSummary}
                info={
                  <InfoTooltip label="About resistances">
                    Force a result's summed resistance to never drop below zero for the elements
                    checked below.
                  </InfoTooltip>
                }
              >
                <div className="app-field-group d-flex flex-column gap-1">
                  <GroupCheckbox
                    label="All"
                    ariaLabel="All resistances"
                    checked={nonNegativeResistances.size === RESISTANCE_ELEMENT_OPTIONS.length}
                    indeterminate={
                      nonNegativeResistances.size > 0 &&
                      nonNegativeResistances.size < RESISTANCE_ELEMENT_OPTIONS.length
                    }
                    onChange={(checked) =>
                      setNonNegativeResistances(
                        checked
                          ? new Set(RESISTANCE_ELEMENT_OPTIONS.map((o) => o.value))
                          : new Set(),
                      )
                    }
                  />
                  {RESISTANCE_ELEMENT_OPTIONS.map((option) => (
                    <div className="form-check" key={option.value}>
                      <input
                        type="checkbox"
                        className="form-check-input"
                        id={`resistance-${option.value}`}
                        checked={nonNegativeResistances.has(option.value)}
                        onChange={(e) => {
                          const next = new Set(nonNegativeResistances)
                          if (e.target.checked) next.add(option.value)
                          else next.delete(option.value)
                          setNonNegativeResistances(next)
                        }}
                      />
                      <label className="form-check-label" htmlFor={`resistance-${option.value}`}>
                        {option.label}
                      </label>
                    </div>
                  ))}
                </div>
              </Disclosure>

              <Disclosure
                title="Save/load this query"
                summary="By text code"
                info={
                  <InfoTooltip label="About save/load">
                    Get a text code for every search input above, to reuse or share later. More
                    compact text codes can be generated by clicking "Get shareable link" on a
                    result, which also allows to use that result as the basis for another search
                    query.
                  </InfoTooltip>
                }
              >
                <div className="app-field-group d-flex flex-column gap-1">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary align-self-start"
                    disabled={isGeneratingQueryCode}
                    onClick={handleGenerateQueryCode}
                  >
                    {isGeneratingQueryCode ? 'Generating…' : 'Get a save code'}
                  </button>
                  {generatedQueryCode && (
                    <textarea
                      className="form-control form-control-sm"
                      aria-label="Save code for this search"
                      readOnly
                      rows={10}
                      value={generatedQueryCode}
                      onFocus={(e) => e.target.select()}
                    />
                  )}
                </div>
                <div className="app-field-group d-flex flex-column gap-1">
                  <textarea
                    className="form-control form-control-sm"
                    aria-label="Save code to load"
                    placeholder="Paste a save code…"
                    rows={10}
                    value={queryCodeInput}
                    onChange={(e) => {
                      setQueryCodeInput(e.target.value)
                      setQueryCodeError(null)
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary align-self-start"
                    disabled={queryCodeInput.trim().length === 0}
                    onClick={handleLoadQueryCode}
                  >
                    Load
                  </button>
                </div>
                {queryCodeError && <div className="form-text text-danger">{queryCodeError}</div>}
              </Disclosure>
            </div>
          </div>

          {skillCapPreview !== null && (
            <p className="form-text mt-3">
              Highest active-skill cap still reachable from here: <strong>{skillCapPreview}</strong>
            </p>
          )}

          <div className="app-action-bar">
            <div className="app-toggle">
              <div className="app-toggle-row form-check mb-0">
                <input
                  type="checkbox"
                  className="form-check-input"
                  id="prefer-exact-matches"
                  checked={preferExactMatches}
                  onChange={(e) => setPreferExactMatches(e.target.checked)}
                />
                <label className="form-check-label" htmlFor="prefer-exact-matches">
                  Prefer exact matches
                </label>
              </div>
              <div className="form-text">
                Rank builds that pick up the fewest skills you didn't ask for above ones with more
                of them.
              </div>
            </div>

            <div>
              <label className="form-label mb-0" htmlFor="max-results">
                Results to show
              </label>
              <select
                id="max-results"
                className="form-select w-auto"
                value={maxResults}
                onChange={(e) => setMaxResults(Number(e.target.value))}
              >
                {MAX_RESULTS_OPTIONS.map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="form-label mb-0" htmlFor="results-sort-by">
                Sort by
              </label>
              <select
                id="results-sort-by"
                className="form-select w-auto"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as ResultSortOption)}
              >
                {(Object.keys(RESULT_SORT_LABELS) as ResultSortOption[]).map((option) => (
                  <option key={option} value={option}>
                    {RESULT_SORT_LABELS[option]}
                  </option>
                ))}
              </select>
            </div>

            <div className="d-flex gap-2 ms-auto">
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  (requirements.length === 0 && zenithRequirements.length === 0) ||
                  !worker ||
                  status === 'searching'
                }
                onClick={() => handleSearch()}
              >
                Search
              </button>
              {status === 'searching' && (
                <button type="button" className="btn btn-outline-secondary" onClick={handleCancel}>
                  Cancel
                </button>
              )}
            </div>
          </div>

          {status !== 'idle' && (
            <div className="app-status">
              {status === 'error' && errorMessage && <p role="alert">{errorMessage}</p>}
              {status === 'done' && results.length === 0 && !timedOutEmpty && (
                <p>No matching builds found.</p>
              )}
              {status === 'done' && results.length === 0 && timedOutEmpty && (
                <p>
                  No build found within the normal time limit -- this doesn't necessarily mean one
                  doesn't exist, just that the search didn't finish checking in time.{' '}
                  <button type="button" className="btn btn-link p-0" onClick={handleSearchLonger}>
                    Search longer
                  </button>{' '}
                  (can take several minutes).
                </p>
              )}
              {status === 'done' && reachedCap && (
                <p>
                  Showing the top {maxResults} {maxResults === 1 ? 'result' : 'results'}. Narrow
                  your requirements or raise the result count above to see more.
                </p>
              )}
            </div>
          )}

          <div className="app-results">
            <ResultsList
              results={sortedResults}
              skillNames={bundle.skillNames}
              skills={bundle.skills}
              zenithSkills={bundle.zenithSkills}
              getShareUrl={buildShareUrl}
            />
            {status === 'searching' && (
              <p>Searching{formatSearchProgress(searchProgress)}</p>
            )}
          </div>
        </>
      )}
    </main>
  )
}

export default App
