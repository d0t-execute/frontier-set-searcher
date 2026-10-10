/**
 * The actual Web Worker entry point (see docs/PLAN.md §4 "run in a Web
 * Worker"). Deliberately thin and untested directly -- all real logic lives
 * in worker-handler.ts, which doesn't touch `self`/`postMessage` and is
 * covered by worker-handler.test.ts (same split as cli.ts/bin.ts).
 */

import { handleSearchRequest } from './worker-handler'
import type { WorkerRequest } from './worker-protocol'

const cancelled = new Set<string>()

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data
  if (request.type === 'cancel') {
    cancelled.add(request.requestId)
    return
  }
  handleSearchRequest(request, (message) => self.postMessage(message), cancelled)
  cancelled.delete(request.requestId)
}
