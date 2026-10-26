/**
 * Instantiates the real search Web Worker for the lifetime of the component
 * (see docs/PLAN.md §4 "run in a Web Worker"). Deliberately thin and
 * untested directly -- `SearchWorkerClient` holds all the real logic and is
 * covered by worker-client.test.ts against a plain stand-in (same split as
 * worker.ts itself, which this hook pairs with).
 */

import { useEffect, useState } from 'react'
import { SearchWorkerClient } from '../search-engine/worker-client'

export function useSearchWorker(): SearchWorkerClient | null {
  const [client, setClient] = useState<SearchWorkerClient | null>(null)

  useEffect(() => {
    const createWorker = () =>
      new Worker(new URL('../search-engine/worker.ts', import.meta.url), { type: 'module' })
    const searchClient = new SearchWorkerClient(createWorker(), createWorker)
    // Exactly the "synchronize with an external system" case the lint rule's
    // own guidance carves out: the Worker is the external system, and this
    // is the only place its handle becomes available to expose via state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setClient(searchClient)
    return () => searchClient.dispose()
  }, [])

  return client
}
