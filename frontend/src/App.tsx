import { useMemo, useState } from 'react'
import { ArmorPicker } from './components/ArmorPicker'
import { CategoryFilter } from './components/CategoryFilter'
import type { CategoryFilterGroup } from './components/CategoryFilter'
import { CuffPicker } from './components/CuffPicker'
import { Disclosure } from './components/Disclosure'
import { ResultsList } from './components/ResultsList'
import { SkillPicker } from './components/SkillPicker'
import type { NamedBuildResult } from './components/types'
import { useDataBundle } from './data/useDataBundle'
import { useSearchWorker } from './search/useSearchWorker'
import { buildSearchQuery, WEAPON_NO_ZENITH_SKILL_KEY } from './search-engine/build-query'
import type { QueryFormState } from './search-engine/build-query'
import { CUFF_CATEGORY_GROUPS } from './search-engine/cuff-categories'
import { GEAR_CATEGORY_GROUPS } from './search-engine/gear-categories'
import type { PinnedSlot } from './search-engine/pinned-armor'
import { buildResultUrl } from './search-engine/shared-state'
import type { SharedSearchState } from './search-engine/shared-state'
import type { SkillRequirement, SkillTierThresholds } from './search-engine/types'

/** How many of a weapon's (always up to 3, confirmed against the real
 * dataset -- every Zenith-infused weapon has exactly 3, and a plain one can
 * always reach 3 too) open slots the search is allowed to spend on
 * decorations. Defaults to 0 -- unlike every other slot/cuff, a weapon's
 * remaining slots are commonly spent on Weapon Sigils instead (a mechanic
 * entirely outside this tool's scope, confirmed by the project owner), so
 * assuming the solver can freely claim all of them would silently assume
 * away the player's own use for them. */
const WEAPON_SLOT_COUNT_OPTIONS = [0, 1, 2, 3] as const

type SearchStatus = 'idle' | 'searching' | 'done' | 'error'

// The search engine formulates each query as a mixed-integer program and
// gets additional ranked results via a "solve, exclude, re-solve" loop (see
// search-engine/engine.ts's module docstring) -- each one is a real solver
// round-trip costing anywhere from milliseconds to tens of seconds,
// unlike the old Pareto-dominance engine's sub-second streaming. A "top 20"
// cap made sense when results were nearly free; now it risks the UI sitting
// on a search for minutes just to fill a page nobody asked to wait that long
// for. Capped lower, and still stopping the search as soon as the cap is
// reached (the same cancellation the user's own Cancel button uses) -- results
// still stream in one at a time as each round completes, so the user sees
// progress immediately rather than waiting for the whole batch.
const MAX_RESULTS = 5

// A piece/cuff that's unobtainable in the real game (removed, unimplemented,
// or training-quest-only) is never worth surfacing by default -- these start
// excluded everywhere they exist, both for equipment's own "Unavailable"
// group and for the matching leaves under each cuff tier. Confirmed by the
// project owner (2026-10-15): Premium cuffs themselves are fine to offer by
// default despite needing Poogie to be wearing Premium clothes (an earlier
// pass here excluded the whole "Premium Poogie Cuffs" group for that reason
// -- superseded by this narrower rule).
const DEFAULT_EXCLUDED_EQUIPMENT_CATEGORIES = new Set(
  GEAR_CATEGORY_GROUPS.find((group) => group.label === 'Unavailable')!.categories.map(
    (c) => c.key,
  ),
)
const DEFAULT_EXCLUDED_CUFF_CATEGORIES = new Set(
  ['Premium Poogie Cuffs', 'Standard Poogie Cuffs']
    .flatMap(
      (label) => CUFF_CATEGORY_GROUPS.find((group) => group.label === label)!.categories,
    )
    .map((c) => c.key)
    .filter((key) => key.includes('unavailable') || key.includes('training_only')),
)

function countLeaves(groups: readonly CategoryFilterGroup[]): number {
  return groups.reduce((sum, group) => sum + group.categories.length, 0)
}

const GEAR_LEVEL_LEAF_COUNT = countLeaves(GEAR_CATEGORY_GROUPS)
const CUFF_LEAF_COUNT = countLeaves(CUFF_CATEGORY_GROUPS)

function pluralize(count: number, noun: string, plural: string = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : plural}`
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
  readonly excludedWeaponZenithSkillIds: ReadonlySet<string> | null
  readonly weaponSlotCount: number
  readonly pinnedArmor: ReadonlyMap<string, PinnedSlot>
  readonly pinnedCuffIds: readonly string[]
  readonly preferExactMatches: boolean
}

function App({ initialState }: { readonly initialState?: AppInitialState } = {}) {
  const bundleQuery = useDataBundle()
  const worker = useSearchWorker()

  const [requirements, setRequirements] = useState<SkillRequirement[]>(
    () => [...(initialState?.requirements ?? [])],
  )
  const [zenithRequirements, setZenithRequirements] = useState<SkillRequirement[]>(
    () => [...(initialState?.zenithRequirements ?? [])],
  )
  const [excludedCategories, setExcludedCategories] = useState<Set<string>>(
    () => new Set(initialState?.excludedCategories ?? DEFAULT_EXCLUDED_EQUIPMENT_CATEGORIES),
  )
  const [excludedCuffCategories, setExcludedCuffCategories] = useState<Set<string>>(
    () => new Set(initialState?.excludedCuffCategories ?? DEFAULT_EXCLUDED_CUFF_CATEGORIES),
  )
  // `null` until the user first touches the checklist -- the weapon Zenith
  // skill catalog is bundle-provided data, not a static constant like
  // CUFF_CATEGORY_GROUPS, so there's no fixed default set to seed useState
  // with up front (see `defaultExcludedWeaponZenithSkillIds` below).
  const [excludedWeaponZenithSkillIds, setExcludedWeaponZenithSkillIds] = useState<Set<
    string
  > | null>(() =>
    initialState?.excludedWeaponZenithSkillIds
      ? new Set(initialState.excludedWeaponZenithSkillIds)
      : null,
  )
  const [weaponSlotCount, setWeaponSlotCount] = useState(() => initialState?.weaponSlotCount ?? 0)
  const [pinnedArmor, setPinnedArmor] = useState<ReadonlyMap<string, PinnedSlot>>(
    () => new Map(initialState?.pinnedArmor ?? []),
  )
  // Up to MAX_EQUIPPED_CUFFS (2) cuff ids, index 0 = cuff slot 1 -- see
  // CuffPicker's own docstring and SearchOptions.pinnedCuffs.
  const [pinnedCuffIds, setPinnedCuffIds] = useState<readonly string[]>(
    () => [...(initialState?.pinnedCuffIds ?? [])],
  )
  // Defaults to on (2026-10-15, per the project owner): an unrequested skill
  // reaching one of its own tiers unprompted is more often a surprise than a
  // win, so this app now ranks against that by default rather than requiring
  // an opt-in.
  const [preferExactMatches, setPreferExactMatches] = useState(
    () => initialState?.preferExactMatches ?? true,
  )
  const [results, setResults] = useState<NamedBuildResult[]>([])
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null)
  const [reachedCap, setReachedCap] = useState(false)

  const bundle = bundleQuery.data

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
  const pinnedArmorSummary =
    pinnedArmor.size === 0 ? 'None pinned' : `${pluralize(pinnedArmor.size, 'slot')} pinned`
  const pinnedCuffsSummary =
    pinnedCuffIds.length === 0 ? 'None pinned' : `${pluralize(pinnedCuffIds.length, 'cuff')} pinned`
  const gearLevelsSummary =
    excludedCategories.size === 0
      ? 'All included'
      : `${pluralize(excludedCategories.size, 'category', 'categories')} of ${GEAR_LEVEL_LEAF_COUNT} excluded`
  const cuffsSummary =
    excludedCuffCategories.size === 0
      ? 'All included'
      : `${pluralize(excludedCuffCategories.size, 'category', 'categories')} of ${CUFF_LEAF_COUNT} excluded`
  const weaponSummary = (() => {
    const total = bundle?.weaponZenithSkillIds.length ?? 0
    const excludedRealSkills = [...effectiveExcludedWeaponZenithSkillIds].filter(
      (key) => key !== WEAPON_NO_ZENITH_SKILL_KEY,
    ).length
    const allowed = total - excludedRealSkills
    const slots = pluralize(weaponSlotCount, 'slot')
    return `${allowed} of ${total} Zenith skills allowed, ${slots} reserved`
  })()

  const queryFormState: QueryFormState = {
    excludedCategories,
    excludedCuffCategories,
    excludedWeaponZenithSkillIds: effectiveExcludedWeaponZenithSkillIds,
    weaponSlotCount,
    pinnedArmor,
    pinnedCuffIds,
  }

  function handleSearch(): void {
    const allRequirements = [...requirements, ...zenithRequirements]
    if (!worker || !bundle || allRequirements.length === 0) return

    setResults([])
    setErrorMessage(null)
    setReachedCap(false)
    setStatus('searching')

    let count = 0
    let capped = false
    const { slots, cuffs, pinnedCuffs } = buildSearchQuery(bundle, queryFormState)
    const requestId = worker.search(
      slots,
      allRequirements,
      bundle.decorations,
      {
        onResult: (result) => {
          // `worker.cancel` below races a message round-trip to the worker,
          // so a result or two can still arrive after the cap is hit --
          // ignoring them here keeps "top N" an actual guarantee, not just a
          // request.
          if (capped) return
          count++
          setResults((prev) => [...prev, result as unknown as NamedBuildResult])
          if (count >= MAX_RESULTS) {
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
      { preferExactMatches, skillTiers, pinnedCuffs },
      cuffs,
    )
    setActiveRequestId(requestId)
  }

  function handleCancel(): void {
    if (worker && activeRequestId) worker.cancel(activeRequestId)
    setStatus('done')
  }

  // Builds a link to this exact result (docs/skill-system-roadmap.md TODO
  // #9) -- encodes the query that produced it (not the solved result data
  // itself, see shared-state.ts's own docstring for why) plus which ranked
  // index to take, so the result page can reconstruct it with one re-run of
  // the solver.
  function buildShareUrl(resultIndex: number): string {
    const state: SharedSearchState = {
      requirements,
      zenithRequirements,
      excludedCategories: [...excludedCategories],
      excludedCuffCategories: [...excludedCuffCategories],
      excludedWeaponZenithSkillIds: excludedWeaponZenithSkillIds
        ? [...excludedWeaponZenithSkillIds]
        : null,
      weaponSlotCount,
      pinnedArmor: [...pinnedArmor],
      pinnedCuffIds,
      preferExactMatches,
      resultIndex,
    }
    return buildResultUrl(state)
  }

  return (
    <main className="app-shell">
      <h1>Frontier Set Searcher</h1>
      <p className="app-intro">
        Pick what your build needs, then search. Every section below is optional and remembers
        its own settings -- open only the ones you need to change.
      </p>

      {bundleQuery.isLoading && <p>Loading equipment data…</p>}
      {bundleQuery.isError && (
        <p role="alert">Couldn't load equipment data. Try reloading the page.</p>
      )}

      {bundle && (
        <>
          <div className="app-section-stack">
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

            <Disclosure title="Pin specific armor" summary={pinnedArmorSummary}>
              <p className="form-text">
                Force a specific piece (and its decorations) into a slot instead of letting the
                solver choose -- useful for optimizing around gear you already own, or pinning
                part of a build while exploring the rest. Unpinned slots stay solver-optimized.
              </p>
              <ArmorPicker
                slots={bundle.slots}
                decorations={bundle.decorations}
                pinned={pinnedArmor}
                onChange={setPinnedArmor}
                skills={bundle.skills}
              />
            </Disclosure>

            <Disclosure title="Gear levels" summary={gearLevelsSummary}>
              <CategoryFilter
                groups={GEAR_CATEGORY_GROUPS}
                excludedCategories={excludedCategories}
                onChange={setExcludedCategories}
              />
            </Disclosure>

            <Disclosure title="Poogie cuffs" summary={cuffsSummary}>
              <CategoryFilter
                groups={CUFF_CATEGORY_GROUPS}
                excludedCategories={excludedCuffCategories}
                onChange={setExcludedCuffCategories}
              />
            </Disclosure>

            <Disclosure title="Pin specific cuffs" summary={pinnedCuffsSummary}>
              <p className="form-text">
                Force a specific cuff into one or both cuff slots instead of letting the solver
                choose -- same idea as pinning an armor piece. The same cuff can fill both slots
                at once.
              </p>
              <CuffPicker cuffs={bundle.cuffs} pinned={pinnedCuffIds} onChange={setPinnedCuffIds} />
            </Disclosure>

            <Disclosure title="Weapon" summary={weaponSummary}>
              <CategoryFilter
                groups={weaponZenithSkillGroups}
                excludedCategories={effectiveExcludedWeaponZenithSkillIds}
                onChange={setExcludedWeaponZenithSkillIds}
              />
              <div className="mt-2">
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
                <div className="form-text">
                  A Zenith-infused weapon always has 3 open slots (a plain one can too). Slots
                  left unassigned here are yours to spend on Weapon Sigils instead -- a separate
                  mechanic this tool doesn't model.
                </div>
              </div>
            </Disclosure>
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
                Rank builds that pick up the fewest skills you didn't ask for above ones with
                more of them.
              </div>
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
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={handleCancel}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>

          {status === 'error' && errorMessage && <p role="alert">{errorMessage}</p>}
          {status === 'searching' && results.length === 0 && <p>Searching…</p>}
          {status === 'done' && results.length === 0 && <p>No matching builds found.</p>}
          {status === 'done' && reachedCap && (
            <p>
              Showing the top {MAX_RESULTS} results. Narrow your requirements to see a more
              specific set.
            </p>
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
