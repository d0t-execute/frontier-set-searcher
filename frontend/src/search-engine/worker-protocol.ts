/**
 * Typed message protocol between the main thread and the search Web Worker
 * (see docs/PLAN.md Phase 4 "a small typed message-passing interface --
 * request a query, receive a stream of ranked results"). Kept dependency-free
 * from `self`/`postMessage`/DOM so it (and anything built on it) stays
 * testable without a real Worker or browser environment.
 */

import type {
  BuildResult,
  Cuff,
  Decoration,
  SearchOptions,
  SkillRequirement,
  SlotQuery,
} from './types'

export interface SearchRequestMessage {
  readonly type: 'search'
  readonly requestId: string
  readonly slots: readonly SlotQuery[]
  readonly requirements: readonly SkillRequirement[]
  readonly decorations?: readonly Decoration[]
  readonly options?: SearchOptions
  readonly cuffs?: readonly Cuff[]
}

export interface CancelMessage {
  readonly type: 'cancel'
  readonly requestId: string
}

/** Sent from the main thread to the worker. */
export type WorkerRequest = SearchRequestMessage | CancelMessage

export interface ResultMessage {
  readonly type: 'result'
  readonly requestId: string
  readonly result: BuildResult
  /** Found in `preferExactMatches`'s fast first pass over a heuristic pool
   * (`SearchOptions.provisionalPoolSize`), not yet proven to be the best
   * possible. Unset for a verified result: the first verified result replaces
   * provisional result 0, the second replaces 1, and so on (see
   * `worker-handler.ts`). */
  readonly provisional?: true
}

/** Sent between the two passes of a `preferExactMatches` search: every
 * provisional result has been sent, and the full search that verifies or
 * replaces them is starting. */
export interface VerifyingMessage {
  readonly type: 'verifying'
  readonly requestId: string
}

/** HiGHS's own `mip_gap` for the round currently being solved (see
 * docs/feedback.md Round 3 #3) -- the fraction by which the best solution
 * found so far could still improve before it's proven optimal. Purely
 * informational: never affects which results are produced, only what the UI
 * shows while waiting for the next one. */
export interface ProgressMessage {
  readonly type: 'progress'
  readonly requestId: string
  readonly gap: number
}

export interface DoneMessage {
  readonly type: 'done'
  readonly requestId: string
}

/** Sent instead of `DoneMessage` when a round's result generator stopped
 * because its time box ran out without ever producing a single result in
 * this request -- not because the query was proven impossible (see
 * `engine.ts`'s `SearchEndReason`/docs/feedback.md Round 3 #4). Lets
 * `SearchWorkerClient`'s caller offer a "search longer" retry only when one
 * could plausibly help. Deliberately scoped to "zero results so far": once a
 * request has already produced at least one result, `worker-handler.ts`
 * reports a later timed-out round as an ordinary `DoneMessage` instead (the
 * no-good-cut loop's own exclusion rows aren't retained across a fresh
 * `search()` call, so a "search longer" retry can only safely restart from
 * scratch -- which is only equivalent to "keep looking" when nothing has
 * been found yet). */
export interface TimedOutMessage {
  readonly type: 'timedOut'
  readonly requestId: string
}

export interface ErrorMessage {
  readonly type: 'error'
  readonly requestId: string
  readonly message: string
}

/** Sent from the worker back to the main thread. */
export type WorkerResponse =
  ResultMessage | VerifyingMessage | ProgressMessage | DoneMessage | TimedOutMessage | ErrorMessage
