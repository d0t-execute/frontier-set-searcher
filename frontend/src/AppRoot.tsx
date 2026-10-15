/**
 * Picks between the main search page and a shared single-result page based on
 * `window.location.hash` -- see docs/skill-system-roadmap.md TODO #9 and
 * `shared-state.ts`'s own docstring for why this is a hash route rather than
 * a real path (no server-side rewrite to fall back on in this static SPA).
 *
 * Also owns the "use as a base for a new search" handoff: `App`'s own search
 * inputs only exist as internal `useState`, seeded once from an optional
 * `initialState` prop (see `App.tsx`'s `AppInitialState`), so handing new
 * values in means forcing a fresh `App` mount (via `key`) rather than
 * reaching into its state from outside.
 */

import { useEffect, useState } from 'react'
import App from './App'
import type { AppInitialState } from './App'
import { ResultPage } from './ResultPage'
import { readSharedStateFromLocation } from './search-engine/shared-state'
import type { SharedSearchState } from './search-engine/shared-state'

export function AppRoot() {
  const [sharedState, setSharedState] = useState<SharedSearchState | null>(() =>
    readSharedStateFromLocation(),
  )
  const [initialState, setInitialState] = useState<AppInitialState | undefined>(undefined)
  const [appKey, setAppKey] = useState(0)

  useEffect(() => {
    function onHashChange(): void {
      setSharedState(readSharedStateFromLocation())
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  function goToSearch(): void {
    window.location.hash = ''
    setSharedState(null)
  }

  function handleUseAsBase(next: AppInitialState): void {
    setInitialState(next)
    setAppKey((k) => k + 1)
    goToSearch()
  }

  if (sharedState) {
    return (
      <ResultPage state={sharedState} onUseAsBase={handleUseAsBase} onBackToSearch={goToSearch} />
    )
  }
  return <App key={appKey} initialState={initialState} />
}
