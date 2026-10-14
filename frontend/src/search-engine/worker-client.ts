/**
 * Main-thread wrapper around the search Web Worker (see docs/PLAN.md §4 "a
 * small typed message-passing interface -- request a query, receive a stream
 * of ranked results"). Depends only on the structural shape of `Worker` it
 * actually uses, so it's testable against a plain stand-in with no real
 * Worker/DOM needed (see worker-client.test.ts).
 */

import type {
  BuildResult,
  Cuff,
  Decoration,
  SearchOptions,
  SkillRequirement,
  SlotQuery,
} from './types'
import type { WorkerRequest, WorkerResponse } from './worker-protocol'

/** The slice of the DOM `Worker` interface this client relies on. */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null
}

export interface SearchCallbacks {
  readonly onResult: (result: BuildResult) => void
  readonly onDone: () => void
  readonly onError: (message: string) => void
}

export class SearchWorkerClient {
  private readonly worker: WorkerLike
  private readonly pending = new Map<string, SearchCallbacks>()
  private nextRequestId = 0

  constructor(worker: WorkerLike) {
    this.worker = worker
    this.worker.onmessage = (event) => this.handleMessage(event.data)
  }

  /** Starts a streaming search, returning a request id usable with `cancel`. */
  search(
    slots: readonly SlotQuery[],
    requirements: readonly SkillRequirement[],
    decorations: readonly Decoration[],
    callbacks: SearchCallbacks,
    options: SearchOptions = {},
    cuffs: readonly Cuff[] = [],
  ): string {
    const requestId = `req-${++this.nextRequestId}`
    this.pending.set(requestId, callbacks)
    this.worker.postMessage({
      type: 'search',
      requestId,
      slots,
      requirements,
      decorations,
      options,
      cuffs,
    })
    return requestId
  }

  /** Stops a search early and discards its callbacks -- any messages that
   * arrive for it afterward are ignored. */
  cancel(requestId: string): void {
    this.pending.delete(requestId)
    this.worker.postMessage({ type: 'cancel', requestId })
  }

  private handleMessage(message: WorkerResponse): void {
    const callbacks = this.pending.get(message.requestId)
    if (!callbacks) return

    switch (message.type) {
      case 'result':
        callbacks.onResult(message.result)
        break
      case 'done':
        this.pending.delete(message.requestId)
        callbacks.onDone()
        break
      case 'error':
        this.pending.delete(message.requestId)
        callbacks.onError(message.message)
        break
    }
  }
}
