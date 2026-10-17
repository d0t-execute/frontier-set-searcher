import { useEffect, useMemo, useState } from 'react'
import { ArmorPicker } from './components/ArmorPicker'
import { CategoryFilter, GroupCheckbox } from './components/CategoryFilter'
import type { CategoryFilterGroup } from './components/CategoryFilter'
import { CuffPicker } from './components/CuffPicker'
import { Disclosure } from './components/Disclosure'
import { EquipmentExclusionPicker } from './components/EquipmentExclusionPicker'
import { ResultsList } from './components/ResultsList'
import { SkillPicker } from './components/SkillPicker'
import type { NamedBuildResult } from './components/types'
import { useDataBundle } from './data/useDataBundle'
import { useSearchWorker } from './search/useSearchWorker'
import {
  buildSearchQuery,
  decorationsAfterCategoryFilter,
  WEAPON_NO_ZENITH_SKILL_KEY,
} from './search-engine/build-query'
import type { HunterTypeFilter, QueryFormState } from './search-engine/build-query'
import { CUFF_CATEGORY_GROUPS } from './search-engine/cuff-categories'
import { DECORATION_CATEGORY_GROUPS } from './search-engine/decoration-categories'
import { findUnreachableRequirements } from './search-engine/feasibility'
import { GEAR_CATEGORY_GROUPS } from './search-engine/gear-categories'
import type { PinnedSlot } from './search-engine/pinned-armor'
import { decodeQueryCode, encodeQueryCode } from './search-engine/query-code'
import type { QueryCodeCatalog } from './search-engine/query-code'
import type { SearchFormState } from './search-engine/search-form-state'
import { loadSearchFormState, saveSearchFormState } from './search-engine/search-form-state'
import { buildResultUrl } from './search-engine/shared-state'
import type { SharedSearchState } from './search-engine/shared-state'
import type { ResistanceElement, SkillRequirement, SkillTierThresholds } from './search-engine/types'

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
const RESISTANCE_ELEMENT_OPTIONS: readonly { readonly value: ResistanceElement; readonly label: string }[] = [
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
// stall the page.
const MAX_RESULTS_OPTIONS = [1, 3, 5, 10, 20, 50] as const

// A piece/cuff that's unobtainable in the real game (removed, unimplemented,
// or training-quest-only) is never worth surfacing by default -- these start
// excluded everywhere they exist, both for equipment's own "Unavailable"
// group and for the matching leaves under each cuff tier. Confirmed by the
// project owner (2026-10-15): Premium cuffs themselves are fine to offer by
// default despite needing Poogie to be wearing Premium clothes (an earlier
// pass here excluded the whole "Premium Poogie Cuffs" group for that reason
// -- superseded by this narrower rule).
const DEFAULT_EXCLUDED_EQUIPMENT_CATEGORIES = new Set(
  GEAR_CATEGORY_GROUPS.find((group) => group.label === 'Unavailable')!.categories.map((c) => c.key),
)
const DEFAULT_EXCLUDED_CUFF_CATEGORIES = new Set(
  ['Premium Poogie Cuffs', 'Standard Poogie Cuffs']
    .flatMap((label) => CUFF_CATEGORY_GROUPS.find((group) => group.label === label)!.categories)
    .map((c) => c.key)
    .filter((key) => key.includes('unavailable') || key.includes('training_only')),
)
// Tower Gems are excluded unconditionally, not via this set at all -- see
// `decorationsAfterCategoryFilter`'s own docstring. Lottery Hiden decorations
// ("do not use" per the reference tool's own tree) are excluded by default
// here, but stay a togglable choice since they're at least equippable.
const DEFAULT_EXCLUDED_DECORATION_CATEGORIES = new Set(['deco_lottery_hiden'])

function countLeaves(groups: readonly CategoryFilterGroup[]): number {
  return groups.reduce((sum, group) => sum + group.categories.length, 0)
}

const GEAR_LEVEL_LEAF_COUNT = countLeaves(GEAR_CATEGORY_GROUPS)
const CUFF_LEAF_COUNT = countLeaves(CUFF_CATEGORY_GROUPS)
const DECORATION_LEAF_COUNT = countLeaves(DECORATION_CATEGORY_GROUPS)

function pluralize(count: number, noun: string, plural: string = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : plural}`
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
  readonly pinnedCuffIds: readonly string[]
  readonly pinnedSlotDecorationIds?: ReadonlyMap<string, readonly string[]>
  readonly excludedArmorIds?: ReadonlySet<string>
  readonly excludedDecorationIds?: ReadonlySet<string>
  readonly excludedCuffIds?: ReadonlySet<string>
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
    () =>
      new Set(
        initialState?.excludedCategories ??
          persisted?.excludedCategories ??
          DEFAULT_EXCLUDED_EQUIPMENT_CATEGORIES,
      ),
  )
  const [excludedCuffCategories, setExcludedCuffCategories] = useState<Set<string>>(
    () =>
      new Set(
        initialState?.excludedCuffCategories ??
          persisted?.excludedCuffCategories ??
          DEFAULT_EXCLUDED_CUFF_CATEGORIES,
      ),
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
  // Up to MAX_EQUIPPED_CUFFS (2) cuff ids, index 0 = cuff slot 1 -- see
  // CuffPicker's own docstring and SearchOptions.pinnedCuffs.
  const [pinnedCuffIds, setPinnedCuffIds] = useState<readonly string[]>(() => [
    ...(initialState?.pinnedCuffIds ?? persisted?.pinnedCuffIds ?? []),
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
  // Elements required to stay at or above zero (docs/feedback.md Round 1 #4)
  // -- empty by default, same "don't silently assume a new feature's most
  // restrictive state" precedent as `DEFAULT_EXCLUDED_CUFF_CATEGORIES`, just
  // in the opposite direction (nothing constrained until the player opts an
  // element in).
  const [nonNegativeResistances, setNonNegativeResistances] = useState<Set<ResistanceElement>>(
    () =>
      new Set(initialState?.nonNegativeResistances ?? persisted?.nonNegativeResistances ?? []),
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
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null)
  const [reachedCap, setReachedCap] = useState(false)

  const bundle = bundleQuery.data

  // Decorations excluded by the filter below are excluded from manual
  // pinning the same way they're excluded from the solver's own pool (see
  // build-query.ts's `decorationsAfterCategoryFilter`) -- otherwise a player
  // could still pin an excluded decoration into a slot through ArmorPicker
  // even though the search itself never would.
  const pinnableDecorations = bundle
    ? decorationsAfterCategoryFilter(bundle.decorations, excludedDecorationCategories)
    : []

  // Flattened once for the exclusion picker (EquipmentExclusionPicker.tsx),
  // which searches across every slot's armor at once rather than per-slot
  // the way ArmorPicker's pinning UI does -- excluding a piece by id doesn't
  // care which slot it happens to belong to.
  const allArmorCandidates = useMemo(
    () => bundle?.slots.flatMap((slot) => slot.candidates) ?? [],
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
  const gearItemsByCategory = useMemo(() => groupByCategory(allArmorCandidates), [allArmorCandidates])
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
  // until the player opts a skill in, matching DEFAULT_EXCLUDED_CUFF_CATEGORIES's
  // own "don't silently assume a new feature's most permissive state" precedent.
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
    pinnedCuffIds.length === 0 ? 'None pinned' : `${pluralize(pinnedCuffIds.length, 'cuff')} pinned`
  const excludedEquipmentSummary = (() => {
    const total = excludedArmorIds.size + excludedDecorationIds.size + excludedCuffIds.size
    return total === 0 ? 'None excluded' : `${pluralize(total, 'item')} excluded`
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

  const queryFormState: QueryFormState = {
    excludedCategories,
    excludedCuffCategories,
    excludedDecorationCategories,
    excludedWeaponZenithSkillIds: effectiveExcludedWeaponZenithSkillIds,
    weaponSlotCount,
    hunterTypeFilter,
    pinnedArmor,
    pinnedCuffIds,
    pinnedSlotDecorationIds,
    excludedArmorIds,
    excludedDecorationIds,
    excludedCuffIds,
  }

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
      pinnedCuffIds,
      pinnedSlotDecorationIds: [...pinnedSlotDecorationIds.entries()],
      excludedArmorIds: [...excludedArmorIds],
      excludedDecorationIds: [...excludedDecorationIds],
      excludedCuffIds: [...excludedCuffIds],
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
    pinnedCuffIds,
    pinnedSlotDecorationIds,
    nonNegativeResistances,
    excludedArmorIds,
    excludedDecorationIds,
    excludedCuffIds,
    preferExactMatches,
    maxResults,
  ])

  function handleSearch(): void {
    const allRequirements = [...requirements, ...zenithRequirements]
    if (!worker || !bundle || allRequirements.length === 0) return

    setResults([])
    setErrorMessage(null)
    setReachedCap(false)

    const { slots, decorations, cuffs, pinnedCuffs, pinnedSlotDecorations } = buildSearchQuery(
      bundle,
      queryFormState,
    )

    // Caught before ever handing this to the solver (docs/feedback.md Round 1
    // #14) -- a requirement flagged here is provably unreachable no matter
    // what the solver tries, so there's no reason to spend a search round
    // (and the player's own wait) just to rediscover that the slow way.
    const unreachable = findUnreachableRequirements(
      slots,
      decorations,
      cuffs,
      allRequirements,
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

    let count = 0
    let capped = false
    const requestId = worker.search(
      slots,
      allRequirements,
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
          if (count >= maxResults) {
            capped = true
            worker.cancel(requestId)
            setReachedCap(true)
            setStatus('done')
          }
        },
        onDone: () => setStatus('done'),
        onError: (message) => {
          setStatus('error')
          setErrorMessage(message)
        },
      },
      {
        preferExactMatches,
        skillTiers,
        pinnedCuffs,
        pinnedSlotDecorations,
        resistanceFloors: [...nonNegativeResistances].map((element) => ({ element, minTotal: 0 })),
      },
      cuffs,
    )
    setActiveRequestId(requestId)
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
        pinnedCuffIds,
        pinnedSlotDecorationIds: [...pinnedSlotDecorationIds.entries()],
        excludedArmorIds: [...excludedArmorIds],
        excludedDecorationIds: [...excludedDecorationIds],
        excludedCuffIds: [...excludedCuffIds],
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
    setPinnedCuffIds([...state.pinnedCuffIds])
    setPinnedSlotDecorationIds(new Map(state.pinnedSlotDecorationIds))
    setExcludedArmorIds(new Set(state.excludedArmorIds))
    setExcludedDecorationIds(new Set(state.excludedDecorationIds))
    setExcludedCuffIds(new Set(state.excludedCuffIds))
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

  // Builds a link to this exact result (docs/skill-system-roadmap.md TODO
  // #9) -- encodes the solved result itself (not just the query that
  // produced it, see shared-state.ts's own docstring for why TODO #15
  // changed this), so the result page never has to re-run the solver to
  // reconstruct what to show. Returns a Promise because encoding compresses
  // the payload (TODO #14) -- see shared-state.ts's own docstring.
  function buildShareUrl(resultIndex: number): Promise<string> {
    const result = results[resultIndex]
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
              <Disclosure title="Skills" summary={skillsSummary} defaultOpen>
                <SkillPicker
                  skills={bundle.skills}
                  requirements={requirements}
                  onChange={setRequirements}
                />
              </Disclosure>

              <Disclosure title="Zenith skills" summary={zenithSkillsSummary}>
                <SkillPicker
                  skills={bundle.zenithSkills}
                  requirements={zenithRequirements}
                  onChange={setZenithRequirements}
                  addLabel="Add a Zenith skill"
                />
              </Disclosure>
            </div>

            <div className="app-column">
              <Disclosure title="Pin specific armor" summary={pinnedArmorSummary}>
                <p className="form-text">
                  Pins a specific piece or decoration to force the solver to use it. Type at least 2
                  characters to search.
                </p>
                <ArmorPicker
                  slots={bundle.slots}
                  decorations={pinnableDecorations}
                  pinned={pinnedArmor}
                  onChange={setPinnedArmor}
                  pinnedSlotDecorationIds={pinnedSlotDecorationIds}
                  onChangeSlotDecorations={setPinnedSlotDecorationIds}
                  skills={bundle.skills}
                />
              </Disclosure>

              <Disclosure title="Gear levels" summary={gearLevelsSummary}>
                <CategoryFilter
                  groups={GEAR_CATEGORY_GROUPS}
                  excludedCategories={excludedCategories}
                  onChange={setExcludedCategories}
                  itemsByCategory={gearItemsByCategory}
                />
              </Disclosure>

              <Disclosure title="Poogie cuffs" summary={cuffsSummary}>
                <CategoryFilter
                  groups={CUFF_CATEGORY_GROUPS}
                  excludedCategories={excludedCuffCategories}
                  onChange={setExcludedCuffCategories}
                  itemsByCategory={cuffItemsByCategory}
                />
              </Disclosure>

              <Disclosure title="Decorations" summary={decorationsSummary}>
                <p className="form-text">
                  Tower Gems are never included -- they're strictly stronger than their regular
                  equivalents and this tool has no way to target them at Tower armor specifically.
                </p>
                <CategoryFilter
                  groups={DECORATION_CATEGORY_GROUPS}
                  excludedCategories={excludedDecorationCategories}
                  onChange={setExcludedDecorationCategories}
                  itemsByCategory={decorationItemsByCategory}
                />
              </Disclosure>

              <Disclosure title="Pin specific cuffs" summary={pinnedCuffsSummary}>
                <p className="form-text">
                  Pins a specific cuff to force the solver to use it. Type at least 2 characters to
                  search.
                </p>
                <CuffPicker
                  cuffs={bundle.cuffs}
                  pinned={pinnedCuffIds}
                  onChange={setPinnedCuffIds}
                  skillNameById={bundle.skillNames}
                />
              </Disclosure>

              <Disclosure title="Exclude specific equipment" summary={excludedEquipmentSummary}>
                <p className="form-text">
                  Excluded equipment never appears in a search result, unless it's also pinned above
                  -- a pin always wins. Type at least 2 characters to search.
                </p>
                <EquipmentExclusionPicker
                  armorCandidates={allArmorCandidates}
                  decorations={bundle.decorations}
                  cuffs={bundle.cuffs}
                  excludedArmorIds={excludedArmorIds}
                  onChangeExcludedArmorIds={setExcludedArmorIds}
                  excludedDecorationIds={excludedDecorationIds}
                  onChangeExcludedDecorationIds={setExcludedDecorationIds}
                  excludedCuffIds={excludedCuffIds}
                  onChangeExcludedCuffIds={setExcludedCuffIds}
                  skillNameById={bundle.skillNames}
                />
              </Disclosure>
            </div>

            <div className="app-column">
              <HunterTypeToggle value={hunterTypeFilter} onChange={setHunterTypeFilter} />

              <Disclosure title="Weapon" summary={weaponSummary}>
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

              <Disclosure title="Resistances" summary={resistancesSummary}>
                <p className="form-text">
                  Force a result's summed resistance to never drop below zero for the elements checked
                  below -- avoids a build with a glaring elemental weakness.
                </p>
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
                        checked ? new Set(RESISTANCE_ELEMENT_OPTIONS.map((o) => o.value)) : new Set(),
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

              <Disclosure title="Save/load this query" summary="By text code">
                <p className="form-text">
                  Get a text code for every search input above, to reuse or share later -- unlike the
                  automatic restore-on-reload, you can keep as many of these as you want.
                </p>
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

            <div className="d-flex gap-2 ms-auto">
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  (requirements.length === 0 && zenithRequirements.length === 0) ||
                  !worker ||
                  status === 'searching'
                }
                onClick={handleSearch}
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
              {status === 'searching' && results.length === 0 && <p>Searching…</p>}
              {status === 'done' && results.length === 0 && <p>No matching builds found.</p>}
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
              results={results}
              skillNames={bundle.skillNames}
              skills={bundle.skills}
              zenithSkills={bundle.zenithSkills}
              getShareUrl={buildShareUrl}
            />
          </div>
        </>
      )}
    </main>
  )
}

export default App
