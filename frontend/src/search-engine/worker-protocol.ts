/**
 * Typed message protocol between the main thread and the search Web Worker
 * (see docs/PLAN.md Phase 4 "a small typed message-passing interface --
 * request a query, receive a stream of ranked results"). Kept dependency-free
 * from `self`/`postMessage`/DOM so it (and anything built on it) stays
 * testable without a real Worker or browser environment.
 */

import type { BuildResult, Decoration, SkillRequirement, SlotQuery } from './types'

export interface SearchRequestMessage {
  readonly type: 'search'
  readonly requestId: string
  readonly slots: readonly SlotQuery[]
  readonly requirements: readonly SkillRequirement[]
  readonly decorations?: readonly Decoration[]
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
export type WorkerResponse = ResultMessage | DoneMessage | ErrorMessage
