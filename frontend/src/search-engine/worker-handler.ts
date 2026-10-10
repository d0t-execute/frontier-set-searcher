/**
 * The worker side of the search message protocol (see worker-protocol.ts),
 * kept free of `self`/`postMessage` so it's testable without a real Worker --
 * `worker.ts` is the thin, untested glue that wires this to the real global
 * (same split as cli.ts/bin.ts for the Node CLI).
 */

import { search } from './engine'
import type { SearchRequestMessage, WorkerResponse } from './worker-protocol'

export function handleSearchRequest(
  request: SearchRequestMessage,
  post: (message: WorkerResponse) => void,
  cancelled: ReadonlySet<string>,
): void {
  if (cancelled.has(request.requestId)) return

  try {
    for (const result of search(request.slots, request.requirements, request.decorations ?? [])) {
      post({ type: 'result', requestId: request.requestId, result })
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
