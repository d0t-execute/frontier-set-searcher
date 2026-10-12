import { useState } from 'react'
import { CategoryFilter } from './components/CategoryFilter'
import { ResultsList } from './components/ResultsList'
import { SkillPicker } from './components/SkillPicker'
import type { NamedBuildResult } from './components/types'
import { useDataBundle } from './data/useDataBundle'
import { useSearchWorker } from './search/useSearchWorker'
import { GEAR_CATEGORY_GROUPS } from './search-engine/gear-categories'
import type { NamedSlotQuery } from './search-engine/load-bundle'
import type { SkillRequirement } from './search-engine/types'

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

function App() {
  const bundleQuery = useDataBundle()
  const worker = useSearchWorker()

  const [requirements, setRequirements] = useState<SkillRequirement[]>([])
  const [excludedCategories, setExcludedCategories] = useState<Set<string>>(new Set())
  const [results, setResults] = useState<NamedBuildResult[]>([])
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null)
  const [reachedCap, setReachedCap] = useState(false)

  const bundle = bundleQuery.data

  function slotsAfterCategoryFilter(slots: readonly NamedSlotQuery[]): NamedSlotQuery[] {
    if (excludedCategories.size === 0) return [...slots]
    return slots.map((slot) => ({
      ...slot,
      candidates: slot.candidates.filter((c) => !excludedCategories.has(c.category)),
    }))
  }

  function handleSearch(): void {
    if (!worker || !bundle || requirements.length === 0) return

    setResults([])
    setErrorMessage(null)
    setReachedCap(false)
    setStatus('searching')

    let count = 0
    let capped = false
    const slots = slotsAfterCategoryFilter(bundle.slots)
    const requestId = worker.search(slots, requirements, bundle.decorations, {
      onResult: (result) => {
        // `worker.cancel` below races a message round-trip to the worker, so
        // a result or two can still arrive after the cap is hit -- ignoring
        // them here keeps "top N" an actual guarantee, not just a request.
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
    })
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
            <h2 className="h5">Gear levels</h2>
            <CategoryFilter
              groups={GEAR_CATEGORY_GROUPS}
              excludedCategories={excludedCategories}
              onChange={setExcludedCategories}
            />
          </section>

          <div className="d-flex gap-2 mb-3">
            <button
              type="button"
              className="btn btn-primary"
              disabled={requirements.length === 0 || !worker || status === 'searching'}
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

          <ResultsList results={results} skillNames={bundle.skillNames} />
        </>
      )}
    </main>
  )
}

export default App
