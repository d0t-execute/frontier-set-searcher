import { useMemo, useState } from 'react'
import { ArmorPicker } from './components/ArmorPicker'
import { CategoryFilter } from './components/CategoryFilter'
import type { CategoryFilterGroup } from './components/CategoryFilter'
import { ResultsList } from './components/ResultsList'
import { SkillPicker } from './components/SkillPicker'
import type { NamedBuildResult } from './components/types'
import { useDataBundle } from './data/useDataBundle'
import { useSearchWorker } from './search/useSearchWorker'
import { CUFF_CATEGORY_GROUPS } from './search-engine/cuff-categories'
import { GEAR_CATEGORY_GROUPS } from './search-engine/gear-categories'
import type { NamedCandidate, NamedCuff, NamedDecoration, NamedSlotQuery } from './search-engine/load-bundle'
import type { PinnedSlot } from './search-engine/pinned-armor'
import type { SkillRequirement, SkillTierThresholds } from './search-engine/types'

/** Key used for the weapon Zenith-skill checklist's "carries no Zenith skill
 * at all" leaf -- every real Zenith skill id is a positive number (see
 * `ZENITH_SKILL_ID_OFFSET`), so this string can never collide with one. */
const WEAPON_NO_ZENITH_SKILL_KEY = 'none'

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

// Premium cuffs only equip while Poogie is wearing Premium clothes (see
// cuff-categories.ts's own docstring) -- a precondition this app has no way
// to know is actually met, so it starts excluded rather than assumed true.
// Standard and Hiden cuffs carry no such precondition and stay included by
// default, matching every other category filter's all-included default.
const DEFAULT_EXCLUDED_CUFF_CATEGORIES = new Set(
  CUFF_CATEGORY_GROUPS.find((group) => group.label === 'Premium Poogie Cuffs')!.categories.map(
    (c) => c.key,
  ),
)

function App() {
  const bundleQuery = useDataBundle()
  const worker = useSearchWorker()

  const [requirements, setRequirements] = useState<SkillRequirement[]>([])
  const [zenithRequirements, setZenithRequirements] = useState<SkillRequirement[]>([])
  const [excludedCategories, setExcludedCategories] = useState<Set<string>>(new Set())
  const [excludedCuffCategories, setExcludedCuffCategories] = useState<Set<string>>(
    () => new Set(DEFAULT_EXCLUDED_CUFF_CATEGORIES),
  )
  // `null` until the user first touches the checklist -- the weapon Zenith
  // skill catalog is bundle-provided data, not a static constant like
  // CUFF_CATEGORY_GROUPS, so there's no fixed default set to seed useState
  // with up front (see `defaultExcludedWeaponZenithSkillIds` below).
  const [excludedWeaponZenithSkillIds, setExcludedWeaponZenithSkillIds] = useState<Set<
    string
  > | null>(null)
  const [weaponSlotCount, setWeaponSlotCount] = useState(0)
  const [pinnedArmor, setPinnedArmor] = useState<ReadonlyMap<string, PinnedSlot>>(new Map())
  const [preferExactMatches, setPreferExactMatches] = useState(false)
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

  // The weapon slot is virtual (see etl/src/etl/export.py's module docstring
  // -- a weapon's identity never matters to this tool, only which Zenith
  // skill, if any, it carries), so its candidates are synthesized here from
  // the bundle's id list and the UI's own controls instead of loaded as-is
  // like every other slot. Always has at least one candidate (falling back to
  // "no Zenith skill" if the checklist excludes everything) so the mandatory
  // one-per-slot choice this slot takes in `buildModel` never finds itself
  // with nothing to choose from.
  function buildWeaponSlot(): NamedSlotQuery {
    const nameById = new Map(bundle?.zenithSkills.map((skill) => [skill.id, skill.name]))
    const candidates: NamedCandidate[] = []
    if (!effectiveExcludedWeaponZenithSkillIds.has(WEAPON_NO_ZENITH_SKILL_KEY)) {
      candidates.push({
        id: 'weapon:none',
        name: 'Plain weapon (no Zenith skill)',
        category: 'weapon',
        skills: [],
        openSlotCount: weaponSlotCount,
      })
    }
    for (const id of bundle?.weaponZenithSkillIds ?? []) {
      if (effectiveExcludedWeaponZenithSkillIds.has(String(id))) continue
      const name = nameById.get(id) ?? `Zenith skill ${id}`
      candidates.push({
        id: `weapon:${id}`,
        name: `Zenith weapon (${name})`,
        category: 'weapon',
        skills: [{ skillId: id, points: 1 }],
        openSlotCount: weaponSlotCount,
      })
    }
    if (candidates.length === 0) {
      candidates.push({
        id: 'weapon:none',
        name: 'Plain weapon (no Zenith skill)',
        category: 'weapon',
        skills: [],
        openSlotCount: weaponSlotCount,
      })
    }
    return { slotId: 'weapon', candidates }
  }

  function slotsAfterCategoryFilter(slots: readonly NamedSlotQuery[]): NamedSlotQuery[] {
    if (excludedCategories.size === 0) return [...slots]
    return slots.map((slot) => ({
      ...slot,
      candidates: slot.candidates.filter((c) => !excludedCategories.has(c.category)),
    }))
  }

  // A pinned slot is forced by narrowing its candidate list down to exactly
  // one synthesized candidate -- the same technique `buildWeaponSlot` already
  // uses, not new ILP machinery (see docs/skill-system-roadmap.md TODO #7):
  // `buildModel`'s per-slot "exactly one candidate" row already forces the
  // solver's hand once there's only one option. The user's chosen decorations
  // are baked directly into this candidate's own `skills` (merged by skillId)
  // and its `openSlotCount` is reduced by their total size, so the solver can
  // still freely fill whatever capacity is left over; they're also folded
  // into the displayed name (mirroring the weapon slot's own
  // "Zenith weapon (<skill>)" convention) since they're never a solver
  // "placement" `ResultsList` would otherwise show. Overrides the category
  // filter for this slot entirely -- a piece the player explicitly pinned
  // shouldn't be silently blocked by an unrelated gear-level checkbox.
  function slotsAfterPinning(
    slots: readonly NamedSlotQuery[],
    decorations: readonly NamedDecoration[],
  ): NamedSlotQuery[] {
    if (pinnedArmor.size === 0) return [...slots]
    const decorationsById = new Map(decorations.map((d) => [d.id, d]))
    return slots.map((slot) => {
      const pin = pinnedArmor.get(slot.slotId)
      if (!pin) return slot
      const original = bundle?.slots
        .find((s) => s.slotId === slot.slotId)
        ?.candidates.find((c) => c.id === pin.candidateId)
      if (!original) return slot

      const placedDecorations = pin.decorationIds
        .map((id) => decorationsById.get(id))
        .filter((d): d is NamedDecoration => d !== undefined)
      const skillTotals = new Map(original.skills.map((s) => [s.skillId, s.points]))
      for (const decoration of placedDecorations) {
        for (const { skillId, points } of decoration.skills) {
          skillTotals.set(skillId, (skillTotals.get(skillId) ?? 0) + points)
        }
      }
      const usedSlots = placedDecorations.reduce((sum, d) => sum + d.slotSize, 0)
      const name = [original.name, ...placedDecorations.map((d) => d.name)].join(' + ')

      const candidate: NamedCandidate = {
        id: original.id,
        name,
        category: original.category,
        skills: [...skillTotals.entries()].map(([skillId, points]) => ({ skillId, points })),
        openSlotCount: (original.openSlotCount ?? 0) - usedSlots,
      }
      return { slotId: slot.slotId, candidates: [candidate] }
    })
  }

  function cuffsAfterCategoryFilter(cuffs: readonly NamedCuff[]): NamedCuff[] {
    if (excludedCuffCategories.size === 0) return [...cuffs]
    return cuffs.filter((c) => !excludedCuffCategories.has(c.category))
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
    const slots = [
      ...slotsAfterPinning(slotsAfterCategoryFilter(bundle.slots), bundle.decorations),
      buildWeaponSlot(),
    ]
    const cuffs = cuffsAfterCategoryFilter(bundle.cuffs)
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
      { preferExactMatches, skillTiers },
      cuffs,
    )
    setActiveRequestId(requestId)
  }

  function handleCancel(): void {
    if (worker && activeRequestId) worker.cancel(activeRequestId)
    setStatus('done')
  }

  return (
    <main className="container py-4">
      <h1>Frontier Set Searcher</h1>

      {bundleQuery.isLoading && <p>Loading equipment data…</p>}
      {bundleQuery.isError && (
        <p role="alert">Couldn't load equipment data. Try reloading the page.</p>
      )}

      {bundle && (
        <>
          <section className="mb-3">
            <h2 className="h5">Skills</h2>
            <SkillPicker
              skills={bundle.skills}
              requirements={requirements}
              onChange={setRequirements}
            />
          </section>

          <section className="mb-3">
            <h2 className="h5">Zenith skills</h2>
            <SkillPicker
              skills={bundle.zenithSkills}
              requirements={zenithRequirements}
              onChange={setZenithRequirements}
              addLabel="Add a Zenith skill"
            />
          </section>

          <section className="mb-3">
            <h2 className="h5">Pin specific armor</h2>
            <p className="form-text">
              Force a specific piece (and its decorations) into a slot instead of letting the
              solver choose -- useful for optimizing around gear you already own, or pinning part
              of a build while exploring the rest. Unpinned slots stay solver-optimized.
            </p>
            <ArmorPicker
              slots={bundle.slots}
              decorations={bundle.decorations}
              pinned={pinnedArmor}
              onChange={setPinnedArmor}
              skills={bundle.skills}
            />
          </section>

          <section className="mb-3">
            <h2 className="h5">Gear levels</h2>
            <CategoryFilter
              groups={GEAR_CATEGORY_GROUPS}
              excludedCategories={excludedCategories}
              onChange={setExcludedCategories}
            />
          </section>

          <section className="mb-3">
            <h2 className="h5">Poogie cuffs</h2>
            <CategoryFilter
              groups={CUFF_CATEGORY_GROUPS}
              excludedCategories={excludedCuffCategories}
              onChange={setExcludedCuffCategories}
            />
          </section>

          <section className="mb-3">
            <h2 className="h5">Weapon</h2>
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
                A Zenith-infused weapon always has 3 open slots (a plain one can too). Slots left
                unassigned here are yours to spend on Weapon Sigils instead -- a separate mechanic
                this tool doesn't model.
              </div>
            </div>
          </section>

          <div className="form-check mb-3">
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
            <div className="form-text">
              Rank builds that pick up the fewest skills you didn't ask for above ones with more of
              them. More skills isn't automatically better -- an unrequested skill can still reach
              one of its own thresholds and have a real (sometimes negative) effect you didn't want.
            </div>
          </div>

          <div className="d-flex gap-2 mb-3">
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

          {status === 'error' && errorMessage && <p role="alert">{errorMessage}</p>}
          {status === 'searching' && results.length === 0 && <p>Searching…</p>}
          {status === 'done' && results.length === 0 && <p>No matching builds found.</p>}
          {status === 'done' && reachedCap && (
            <p>
              Showing the top {MAX_RESULTS} results. Narrow your requirements to see a more specific
              set.
            </p>
          )}

          <ResultsList
            results={results}
            skillNames={bundle.skillNames}
            skills={bundle.skills}
            zenithSkills={bundle.zenithSkills}
          />
        </>
      )}
    </main>
  )
}

export default App
