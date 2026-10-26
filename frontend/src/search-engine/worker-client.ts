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
  terminate?(): void
}

export interface SearchCallbacks {
  /** `provisional` is set for results from a `preferExactMatches` search's
   * fast first pass (see worker-protocol.ts's `ResultMessage`); a later
   * verified result replaces them index by index. */
  readonly onResult: (result: BuildResult, provisional: boolean) => void
  /** The provisional pass is over and verification has started (see
   * worker-protocol.ts's `VerifyingMessage`). Optional. */
  readonly onVerifying?: () => void
  readonly onDone: () => void
  readonly onError: (message: string) => void
  /** HiGHS's `mip_gap` for the round currently being solved, 0-1 (see
   * worker-protocol.ts's `ProgressMessage`). Optional -- most tests have no
   * reason to care about this. */
  readonly onProgress?: (gap: number) => void
  /** A `TimedOutMessage` arrived instead of `DoneMessage` -- the search gave
   * up because its time box ran out, not because it proved no build exists
   * (see that message's own docstring). Optional, and falls back to `onDone`
   * when omitted, so an existing caller that doesn't care about the
   * distinction keeps working exactly as before (2026-10-25, docs/feedback.md
   * Round 3 #4's "search longer" retry). */
  readonly onTimedOut?: () => void
}

interface PendingRequest {
  readonly callbacks: SearchCallbacks
  readonly message: WorkerRequest
}

export class SearchWorkerClient {
  private worker: WorkerLike
  private readonly createWorker?: () => WorkerLike
  private readonly pending = new Map<string, PendingRequest>()
  private nextRequestId = 0

  /** `createWorker`, when given, lets `cancel` stop a search mid-solve by
   * replacing the worker outright -- a posted cancel message can't be read
   * until the solve already running finishes, which for a long search (a
   * `preferExactMatches` verification pass, say) left the next search queued
   * behind it for up to a minute. */
  constructor(worker: WorkerLike, createWorker?: () => WorkerLike) {
    this.worker = worker
    this.createWorker = createWorker
    this.listen()
  }

  private listen(): void {
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
    const message: WorkerRequest = {
      type: 'search',
      requestId,
      slots,
      requirements,
      decorations,
      options,
      cuffs,
    }
    this.pending.set(requestId, { callbacks, message })
    this.worker.postMessage(message)
    return requestId
  }

  /** Stops a search early and discards its callbacks -- any messages that
   * arrive for it afterward are ignored. With a `createWorker` factory, a
   * search still running is stopped immediately by replacing the worker;
   * any other pending searches are re-sent to the new one. */
  cancel(requestId: string): void {
    const wasPending = this.pending.delete(requestId)
    if (wasPending && this.createWorker && this.worker.terminate) {
      this.worker.terminate()
      this.worker = this.createWorker()
      this.listen()
      for (const { message } of this.pending.values()) this.worker.postMessage(message)
      return
    }
    this.worker.postMessage({ type: 'cancel', requestId })
  }

  /** Shuts the current worker down for good (e.g. on unmount). */
  dispose(): void {
    this.pending.clear()
    this.worker.terminate?.()
  }

  private handleMessage(message: WorkerResponse): void {
    const callbacks = this.pending.get(message.requestId)?.callbacks
    if (!callbacks) return

    switch (message.type) {
      case 'result':
        callbacks.onResult(message.result, message.provisional === true)
        break
      case 'verifying':
        callbacks.onVerifying?.()
        break
      case 'progress':
        callbacks.onProgress?.(message.gap)
        break
      case 'done':
        this.pending.delete(message.requestId)
        callbacks.onDone()
        break
      case 'timedOut':
        this.pending.delete(message.requestId)
        ;(callbacks.onTimedOut ?? callbacks.onDone)()
        break
      case 'error':
        this.pending.delete(message.requestId)
        callbacks.onError(message.message)
        break
    }
  }
}
