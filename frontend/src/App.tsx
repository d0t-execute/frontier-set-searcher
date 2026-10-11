import { useState } from 'react'
import { ResultsList } from './components/ResultsList'
import { SkillPicker } from './components/SkillPicker'
import type { NamedBuildResult } from './components/types'
import { useDataBundle } from './data/useDataBundle'
import { useSearchWorker } from './search/useSearchWorker'
import type { SkillRequirement } from './search-engine/types'

type SearchStatus = 'idle' | 'searching' | 'done' | 'error'

// The engine streams results in an anytime/best-first order and can, for a
// loosely-constrained query against the real ~62k-equipment dataset, have
// tens of thousands of non-dominated combinations to offer -- confirmed by
// manual testing, where an uncapped search rendered 25,000+ result cards and
// nearly froze the page. Capping at a generous "first page" and stopping the
// search there (the same cancellation the user's own Cancel button uses)
// keeps the common case fast without losing anything: surplus-ranked
// results are already best-first, so the top `MAX_RESULTS` are the most
// interesting ones regardless.
const MAX_RESULTS = 20

function App() {
  const bundleQuery = useDataBundle()
  const worker = useSearchWorker()

  const [requirements, setRequirements] = useState<SkillRequirement[]>([])
  const [results, setResults] = useState<NamedBuildResult[]>([])
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null)
  const [reachedCap, setReachedCap] = useState(false)

  const bundle = bundleQuery.data

  function handleSearch(): void {
    if (!worker || !bundle || requirements.length === 0) return

    setResults([])
    setErrorMessage(null)
    setReachedCap(false)
    setStatus('searching')

    let count = 0
    let capped = false
    const requestId = worker.search(bundle.slots, requirements, bundle.decorations, {
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
