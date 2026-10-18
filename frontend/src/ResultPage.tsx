/**
 * The dedicated single-result page a shared build-result link opens into --
 * see docs/skill-system-roadmap.md TODO #9's refined scope. Shows just the
 * one `BuildResult` the link points at (reusing `ResultsList.tsx`'s own
 * `ResultCard` rendering, not a second copy of it), with no search form
 * around it, plus a "Use this as a base for a new search" button that hands
 * every part of the result back to the main search page as pinned state
 * (`App.tsx`'s `AppInitialState`, applied via `AppRoot.tsx`).
 *
 * Renders the result straight from the link's own encoded data -- no solver
 * re-run, no lookup against the live data bundle's equipment/decoration/cuff
 * catalogs (docs/skill-system-roadmap.md TODO #15: re-deriving the display
 * by re-solving against whatever bundle/defaults happen to be current when a
 * link is opened made the shown build depend on things that routinely change
 * during this project's active development, not just on the link itself).
 * The data bundle is still loaded, but only for its skill catalogs
 * (`skillNames`/`skills`/`zenithSkills`, needed for `ResultCard`'s own
 * display/active-skill-cap logic) and `weaponZenithSkillIds` (needed for
 * "use as a base"'s weapon-pin reconstruction) -- never to resolve a pick/
 * decoration/cuff id back to its current data.
 */

import { useEffect, useMemo, useState } from 'react'
import type { AppInitialState } from './App'
import { ResultCard } from './components/ResultsList'
import type { NamedBuildResult } from './components/types'
import { useDataBundle } from './data/useDataBundle'
import { pinnedArmorFromResult, pinnedWeaponExclusion } from './search-engine/build-query'
import type { NamedCandidate, NamedCuff, NamedDecoration } from './search-engine/load-bundle'
import { decodeSharedState } from './search-engine/shared-state'
import type { SharedBuildResult, SharedSearchState } from './search-engine/shared-state'

export interface ResultPageProps {
  /** The still-compressed/base64url payload from the location hash -- see
   * `shared-state.ts`'s own docstring on why decoding is `async`. */
  readonly encoded: string
  readonly onUseAsBase: (initialState: AppInitialState) => void
  readonly onBackToSearch: () => void
}

type DecodeStatus = 'loading' | 'found' | 'invalid-link'

/** `category` is left empty on every reconstructed pick/decoration/cuff --
 * nothing on this page's display path (`ResultCard`, `active-skill-cap.ts`)
 * ever reads it, only `grankOrLater`, `exoticSkillId`, `defenseMax`, and
 * `resistances` (all kept, from the link itself) -- see `shared-state.ts`'s
 * own `SharedPick` docstring. `hunterType` is a placeholder ('common') -- it
 * only matters pre-solve, never on an already-solved result's own display or
 * cap logic. */
function toNamedBuildResult(result: SharedBuildResult): NamedBuildResult {
  const picks = new Map<string, NamedCandidate>(
    result.picks.map((p) => [
      p.slotId,
      {
        id: p.id,
        name: p.name,
        skills: [],
        openSlotCount: p.openSlotCount ?? undefined,
        category: '',
        grankOrLater: p.grankOrLater,
        hunterType: 'common',
        exoticSkillId: p.exoticSkillId,
        defenseMax: p.defenseMax,
        resistances: p.resistances,
      },
    ]),
  )
  const decorations = new Map<string, NamedDecoration[]>(
    result.decorations.map((d) => [
      d.slotId,
      d.decorations.map((dec) => ({
        id: dec.id,
        name: dec.name,
        slotSize: dec.slotSize,
        skills: [],
        isTower: false,
        isSp: false,
        category: '',
      })),
    ]),
  )
  const cuffs: NamedCuff[] = result.cuffs.map((c) => ({
    id: c.id,
    name: c.name,
    slotSize: 0,
    skills: c.skills,
    category: '',
  }))
  return { picks, decorations, cuffs, skillTotals: new Map(result.skillTotals) }
}

export function ResultPage({ encoded, onUseAsBase, onBackToSearch }: ResultPageProps) {
  const bundleQuery = useDataBundle()
  const bundle = bundleQuery.data

  const [state, setState] = useState<SharedSearchState | null>(null)
  const [decodeStatus, setDecodeStatus] = useState<DecodeStatus>('loading')

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(null)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDecodeStatus('loading')
    void decodeSharedState(encoded).then((decoded) => {
      if (cancelled) return
      if (!decoded) {
        setDecodeStatus('invalid-link')
        return
      }
      setState(decoded)
      setDecodeStatus('found')
    })
    return () => {
      cancelled = true
    }
  }, [encoded])

  const result = useMemo(() => (state ? toNamedBuildResult(state.result) : null), [state])

  function handleUseAsBase(): void {
    if (!bundle || !result || !state) return
    const weaponCandidate = result.picks.get('weapon')
    onUseAsBase({
      requirements: state.requirements,
      zenithRequirements: state.zenithRequirements,
      excludedCategories: new Set(state.excludedCategories),
      excludedCuffCategories: new Set(state.excludedCuffCategories),
      excludedDecorationCategories: new Set(state.excludedDecorationCategories),
      excludedWeaponZenithSkillIds: weaponCandidate
        ? pinnedWeaponExclusion(bundle.weaponZenithSkillIds, weaponCandidate.id)
        : new Set(state.excludedWeaponZenithSkillIds ?? []),
      weaponSlotCount: state.weaponSlotCount,
      hunterTypeFilter: state.hunterTypeFilter,
      pinnedArmor: pinnedArmorFromResult(result.picks, result.decorations),
      pinnedCuffSlots: result.cuffs.map((c) => ({ mode: 'exact' as const, cuffId: c.id })),
      excludedArmorIds: new Set(state.excludedArmorIds),
      excludedDecorationIds: new Set(state.excludedDecorationIds),
      excludedCuffIds: new Set(state.excludedCuffIds),
      excludedSkillIds: new Set(state.excludedSkillIds),
      nonNegativeResistances: new Set(state.nonNegativeResistances),
      preferExactMatches: state.preferExactMatches,
    })
  }

  return (
    <main className="app-shell">
      <h1>Shared build</h1>
      <p className="app-intro">
        <button type="button" className="btn btn-link p-0" onClick={onBackToSearch}>
          ← Back to search
        </button>
      </p>

      {(bundleQuery.isLoading || decodeStatus === 'loading') && <p>Loading…</p>}
      {bundleQuery.isError && (
        <p role="alert">Couldn't load equipment data. Try reloading the page.</p>
      )}
      {decodeStatus === 'invalid-link' && (
        <p role="alert">
          This link is corrupted, or was created before an update changed how links are encoded,
          and can no longer be opened.
        </p>
      )}

      {bundle && result && decodeStatus === 'found' && (
        <>
          <div className="app-results">
            <div className="border rounded p-3 text-start">
              <ResultCard
                result={result}
                skillNames={bundle.skillNames}
                skills={bundle.skills}
                zenithSkills={bundle.zenithSkills}
              />
            </div>
          </div>

          <div className="app-action-bar">
            <button type="button" className="btn btn-primary" onClick={handleUseAsBase}>
              Use as a base for a new search
            </button>
          </div>
        </>
      )}
    </main>
  )
}
