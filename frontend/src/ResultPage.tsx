/**
 * The dedicated single-result page a shared build-result link opens into --
 * see docs/skill-system-roadmap.md TODO #9's refined scope. Shows just the
 * one `BuildResult` the link points at (reusing `ResultsList.tsx`'s own
 * `ResultCard` rendering, not a second copy of it), with no search form
 * around it, plus a "Use this as a base for a new search" button that hands
 * every part of the result back to the main search page as pinned state
 * (`App.tsx`'s `AppInitialState`, applied via `AppRoot.tsx`).
 *
 * Reconstructs the result by re-running the real solver for the link's
 * encoded query and taking its `resultIndex`'th streamed result -- see
 * `shared-state.ts`'s own docstring for why a link encodes the query rather
 * than the solved result data itself.
 */

import { useEffect, useMemo, useState } from 'react'
import type { AppInitialState } from './App'
import { ResultCard } from './components/ResultsList'
import type { NamedBuildResult } from './components/types'
import { useDataBundle } from './data/useDataBundle'
import { useSearchWorker } from './search/useSearchWorker'
import type { QueryFormState } from './search-engine/build-query'
import {
  buildSearchQuery,
  pinnedArmorFromResult,
  pinnedWeaponExclusion,
} from './search-engine/build-query'
import { decodeSharedState } from './search-engine/shared-state'
import type { SharedSearchState } from './search-engine/shared-state'
import type { SkillTierThresholds } from './search-engine/types'

export interface ResultPageProps {
  /** The still-compressed/base64url payload from the location hash -- see
   * `shared-state.ts`'s own docstring on why decoding is `async` now, and
   * why that pushed the decode step down into this component (which already
   * has its own loading/error states for the equally-async solver
   * reconstruction) rather than `AppRoot.tsx` doing it up front. */
  readonly encoded: string
  readonly onUseAsBase: (initialState: AppInitialState) => void
  readonly onBackToSearch: () => void
}

type ReconstructStatus = 'loading' | 'found' | 'not-found' | 'error' | 'invalid-link'

export function ResultPage({ encoded, onUseAsBase, onBackToSearch }: ResultPageProps) {
  const bundleQuery = useDataBundle()
  const worker = useSearchWorker()
  const bundle = bundleQuery.data

  const [state, setState] = useState<SharedSearchState | null>(null)
  const [result, setResult] = useState<NamedBuildResult | null>(null)
  const [reconstructStatus, setReconstructStatus] = useState<ReconstructStatus>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(null)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReconstructStatus('loading')
    void decodeSharedState(encoded).then((decoded) => {
      if (cancelled) return
      if (!decoded) {
        setReconstructStatus('invalid-link')
        return
      }
      setState(decoded)
    })
    return () => {
      cancelled = true
    }
  }, [encoded])

  const formState = useMemo<QueryFormState | null>(() => {
    if (!state) return null
    return {
      excludedCategories: new Set(state.excludedCategories),
      excludedCuffCategories: new Set(state.excludedCuffCategories),
      excludedDecorationCategories: new Set(state.excludedDecorationCategories),
      excludedWeaponZenithSkillIds: new Set(
        state.excludedWeaponZenithSkillIds ?? bundle?.weaponZenithSkillIds.map(String) ?? [],
      ),
      weaponSlotCount: state.weaponSlotCount,
      pinnedArmor: new Map(state.pinnedArmor),
      pinnedCuffIds: state.pinnedCuffIds,
      pinnedSlotDecorationIds: new Map(state.pinnedSlotDecorationIds),
    }
    // `bundle` only matters here as a fallback default for an omitted
    // `excludedWeaponZenithSkillIds` (see `SharedSearchState`'s own
    // docstring) -- re-deriving once the bundle loads is intentional, not an
    // accidental extra dependency.
  }, [state, bundle])

  useEffect(() => {
    if (!worker || !bundle || !state || !formState) return undefined

    // Resetting before kicking off a new worker search is the same
    // "synchronize with an external system" case `useSearchWorker.ts`'s own
    // suppression already carves out -- the Worker is the external system,
    // and a changed `state`/`bundle` genuinely means a different search just
    // started.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResult(null)
    setReconstructStatus('loading')
    setErrorMessage(null)

    const { slots, decorations, cuffs, pinnedCuffs, pinnedSlotDecorations } = buildSearchQuery(
      bundle,
      formState,
    )
    const allRequirements = [...state.requirements, ...state.zenithRequirements]
    const skillTiers: SkillTierThresholds[] = [...bundle.skills, ...bundle.zenithSkills].map(
      (skill) => ({
        skillId: skill.id,
        tierThresholds: skill.tiers.map((tier) => tier.minPoints),
      }),
    )

    let cancelled = false
    const collected: NamedBuildResult[] = []
    const requestId = worker.search(
      slots,
      allRequirements,
      decorations,
      {
        onResult: (found) => {
          if (cancelled) return
          collected.push(found as unknown as NamedBuildResult)
          if (collected.length === state.resultIndex + 1) {
            setResult(collected[state.resultIndex])
            setReconstructStatus('found')
            worker.cancel(requestId)
          }
        },
        onDone: () => {
          if (cancelled) return
          if (collected.length <= state.resultIndex) setReconstructStatus('not-found')
        },
        onError: (message) => {
          if (cancelled) return
          setReconstructStatus('error')
          setErrorMessage(message)
        },
      },
      { preferExactMatches: state.preferExactMatches, skillTiers, pinnedCuffs, pinnedSlotDecorations },
      cuffs,
    )

    return () => {
      cancelled = true
      worker.cancel(requestId)
    }
  }, [worker, bundle, state, formState])

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
      pinnedArmor: pinnedArmorFromResult(result.picks, result.decorations),
      pinnedCuffIds: result.cuffs.map((c) => c.id),
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

      {(bundleQuery.isLoading || reconstructStatus === 'loading') && <p>Loading…</p>}
      {bundleQuery.isError && (
        <p role="alert">Couldn't load equipment data. Try reloading the page.</p>
      )}
      {reconstructStatus === 'invalid-link' && (
        <p role="alert">
          This link is corrupted, or was created before an update changed how links are encoded,
          and can no longer be opened.
        </p>
      )}
      {reconstructStatus === 'not-found' && (
        <p role="alert">
          This link's build could no longer be found -- the underlying data may have changed
          since it was shared.
        </p>
      )}
      {reconstructStatus === 'error' && errorMessage && <p role="alert">{errorMessage}</p>}

      {bundle && result && reconstructStatus === 'found' && (
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
