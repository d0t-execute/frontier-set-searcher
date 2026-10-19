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
import { CategoryTablePage } from './CategoryTablePage'
import { ResultPage } from './ResultPage'
import { categoryRouteFromLocation } from './search-engine/category-route'
import type { CategoryRoute } from './search-engine/category-route'
import { encodedResultFromLocation } from './search-engine/shared-state'

export function AppRoot() {
  // Just the still-encoded payload, not the decoded `SharedSearchState` --
  // decoding is async now (see shared-state.ts's own docstring), so
  // `ResultPage` decodes it itself alongside its already-async solver
  // reconstruction rather than this component needing its own loading state
  // for a decode step with nothing to render yet.
  const [encoded, setEncoded] = useState<string | null>(() => encodedResultFromLocation())
  const [categoryRoute, setCategoryRoute] = useState<CategoryRoute | null>(() =>
    categoryRouteFromLocation(),
  )
  const [initialState, setInitialState] = useState<AppInitialState | undefined>(undefined)
  const [appKey, setAppKey] = useState(0)

  useEffect(() => {
    function onHashChange(): void {
      setEncoded(encodedResultFromLocation())
      setCategoryRoute(categoryRouteFromLocation())
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  function goToSearch(): void {
    window.location.hash = ''
    setEncoded(null)
    setCategoryRoute(null)
  }

  function handleUseAsBase(next: AppInitialState): void {
    setInitialState(next)
    setAppKey((k) => k + 1)
    goToSearch()
  }

  if (categoryRoute !== null) {
    return (
      <CategoryTablePage
        kind={categoryRoute.kind}
        categoryKey={categoryRoute.categoryKey}
        onBackToSearch={goToSearch}
      />
    )
  }
  if (encoded !== null) {
    return (
      <ResultPage encoded={encoded} onUseAsBase={handleUseAsBase} onBackToSearch={goToSearch} />
    )
  }
  return <App key={appKey} initialState={initialState} />
}
