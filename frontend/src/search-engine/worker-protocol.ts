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

export interface ErrorMessage {
  readonly type: 'error'
  readonly requestId: string
  readonly message: string
}

/** Sent from the worker back to the main thread. */
export type WorkerResponse = ResultMessage | ProgressMessage | DoneMessage | ErrorMessage
