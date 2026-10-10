/**
 * The worker side of the search message protocol (see worker-protocol.ts),
 * kept free of `self`/`postMessage` so it's testable without a real Worker --
 * `worker.ts` is the thin, untested glue that wires this to the real global
 * (same split as cli.ts/bin.ts for the Node CLI).
 *
 * Pumps the search generator one result at a time, yielding back to the
 * event loop between each (`yieldToEventLoop`). This isn't just politeness:
 * a Web Worker is single-threaded, so a cancel message posted from the main
 * thread can only ever be *received* while this handler isn't in the middle
 * of a synchronous run -- running the whole search in one tight loop (the
 * first version of this function did) meant a 'cancel' message sat in the
 * worker's own queue, completely inert, until the search finished on its
 * own. Yielding after every result gives the worker's message loop a chance
 * to actually process a pending cancel before the next one is produced.
 */

import { search } from './engine'
import type { SearchRequestMessage, WorkerResponse } from './worker-protocol'

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

export async function handleSearchRequest(
  request: SearchRequestMessage,
  post: (message: WorkerResponse) => void,
  cancelled: ReadonlySet<string>,
): Promise<void> {
  if (cancelled.has(request.requestId)) return

  try {
    const generator = search(request.slots, request.requirements, request.decorations ?? [])
    for (const result of generator) {
      post({ type: 'result', requestId: request.requestId, result })
      await yieldToEventLoop()
      if (cancelled.has(request.requestId)) return
    }
    post({ type: 'done', requestId: request.requestId })
  } catch (error) {
    post({
      type: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
