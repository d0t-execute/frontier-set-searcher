import { describe, expect, it, vi } from 'vitest'
import { SearchWorkerClient } from './worker-client'
import type { WorkerRequest, WorkerResponse } from './worker-protocol'
import type { BuildResult, SlotQuery } from './types'

/** A minimal stand-in for the DOM `Worker` interface -- just enough of its
 * shape for `SearchWorkerClient` to talk to, with no real Worker/DOM needed. */
class FakeWorker {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null
  readonly posted: WorkerRequest[] = []

  postMessage(message: WorkerRequest): void {
    this.posted.push(message)
  }

  /** Test helper: simulate the worker sending a message back. */
  emit(message: WorkerResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<WorkerResponse>)
  }
}

const slots: SlotQuery[] = []
const buildResult: BuildResult = {
  picks: new Map(),
  decorations: new Map(),
  cuffs: [],
  skillTotals: new Map(),
}

describe('SearchWorkerClient', () => {
  it('posts a search message carrying the query', () => {
    const worker = new FakeWorker()
    const client = new SearchWorkerClient(worker)

    client.search(slots, [{ skillId: 1, minPoints: 1 }], [], {
      onResult: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    })

    expect(worker.posted).toHaveLength(1)
    expect(worker.posted[0]).toMatchObject({
      type: 'search',
      slots,
      requirements: [{ skillId: 1, minPoints: 1 }],
      decorations: [],
      options: {},
    })
  })

  it('forwards preferExactMatches through to the posted search message', () => {
    const worker = new FakeWorker()
    const client = new SearchWorkerClient(worker)

    client.search(
      slots,
      [{ skillId: 1, minPoints: 1 }],
      [],
      { onResult: vi.fn(), onDone: vi.fn(), onError: vi.fn() },
      { preferExactMatches: true },
    )

    expect(worker.posted[0]).toMatchObject({ options: { preferExactMatches: true } })
  })

  it('defaults cuffs to an empty array when none are given', () => {
    const worker = new FakeWorker()
    const client = new SearchWorkerClient(worker)

    client.search(slots, [], [], { onResult: vi.fn(), onDone: vi.fn(), onError: vi.fn() })

    expect(worker.posted[0]).toMatchObject({ cuffs: [] })
  })

  it('forwards cuffs through to the posted search message', () => {
    const worker = new FakeWorker()
    const client = new SearchWorkerClient(worker)
    const cuffs = [{ id: 'cuff:C001', slotSize: 1, skills: [] }]

    client.search(
      slots,
      [],
      [],
      { onResult: vi.fn(), onDone: vi.fn(), onError: vi.fn() },
      {},
      cuffs,
    )

    expect(worker.posted[0]).toMatchObject({ cuffs })
  })

  it('routes result and done messages to the matching request callbacks', () => {
    const worker = new FakeWorker()
    const client = new SearchWorkerClient(worker)
    const onResult = vi.fn()
    const onDone = vi.fn()

    const requestId = client.search(slots, [], [], { onResult, onDone, onError: vi.fn() })

    worker.emit({ type: 'result', requestId, result: buildResult })
    worker.emit({ type: 'done', requestId })

    expect(onResult).toHaveBeenCalledWith(buildResult, false)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('routes a progress message to onProgress (docs/feedback.md Round 3 #3)', () => {
    const worker = new FakeWorker()
    const client = new SearchWorkerClient(worker)
    const onProgress = vi.fn()

    const requestId = client.search(slots, [], [], {
      onResult: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      onProgress,
    })

    worker.emit({ type: 'progress', requestId, gap: 0.42 })

    expect(onProgress).toHaveBeenCalledWith(0.42)
  })

  it('tolerates a progress message when no onProgress callback was given', () => {
    const worker = new FakeWorker()
    const client = new SearchWorkerClient(worker)

    const requestId = client.search(slots, [], [], {
      onResult: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    })

    expect(() => worker.emit({ type: 'progress', requestId, gap: 0.1 })).not.toThrow()
  })

  it('routes an error message to onError and stops tracking the request', () => {
    const worker = new FakeWorker()
    const client = new SearchWorkerClient(worker)
    const onError = vi.fn()

    const requestId = client.search(slots, [], [], { onResult: vi.fn(), onDone: vi.fn(), onError })

    worker.emit({ type: 'error', requestId, message: 'boom' })

    expect(onError).toHaveBeenCalledWith('boom')
  })

  it('keeps concurrent requests independent, routing each to its own callbacks', () => {
    const worker = new FakeWorker()
    const client = new SearchWorkerClient(worker)
    const first = { onResult: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
    const second = { onResult: vi.fn(), onDone: vi.fn(), onError: vi.fn() }

    const firstId = client.search(slots, [], [], first)
    const secondId = client.search(slots, [], [], second)
    expect(firstId).not.toBe(secondId)

    worker.emit({ type: 'result', requestId: secondId, result: buildResult })

    expect(second.onResult).toHaveBeenCalledWith(buildResult, false)
    expect(first.onResult).not.toHaveBeenCalled()
  })

  it('posts a cancel message and stops routing further messages for that request', () => {
    const worker = new FakeWorker()
    const client = new SearchWorkerClient(worker)
    const onResult = vi.fn()

    const requestId = client.search(slots, [], [], { onResult, onDone: vi.fn(), onError: vi.fn() })
    client.cancel(requestId)

    expect(worker.posted).toContainEqual({ type: 'cancel', requestId })

    worker.emit({ type: 'result', requestId, result: buildResult })
    expect(onResult).not.toHaveBeenCalled()
  })

  it('ignores a message for a request it has no record of', () => {
    const worker = new FakeWorker()
    new SearchWorkerClient(worker)

    expect(() => worker.emit({ type: 'done', requestId: 'unknown' })).not.toThrow()
  })

  // docs/feedback.md Round 3 #4's "search longer" retry -- see
  // `TimedOutMessage`'s own docstring.
  it('routes a timedOut message to onTimedOut and stops tracking the request', () => {
    const worker = new FakeWorker()
    const client = new SearchWorkerClient(worker)
    const onDone = vi.fn()
    const onTimedOut = vi.fn()

    const requestId = client.search(slots, [], [], {
      onResult: vi.fn(),
      onDone,
      onError: vi.fn(),
      onTimedOut,
    })
    worker.emit({ type: 'timedOut', requestId })

    expect(onTimedOut).toHaveBeenCalledTimes(1)
    expect(onDone).not.toHaveBeenCalled()

    // Stops tracking the request, same as `done` -- a later message for it is
    // silently ignored rather than calling the callback again.
    worker.emit({ type: 'timedOut', requestId })
    expect(onTimedOut).toHaveBeenCalledTimes(1)
  })

  it('falls back to onDone for a timedOut message when onTimedOut was not given', () => {
    const worker = new FakeWorker()
    const client = new SearchWorkerClient(worker)
    const onDone = vi.fn()

    const requestId = client.search(slots, [], [], { onResult: vi.fn(), onDone, onError: vi.fn() })
    worker.emit({ type: 'timedOut', requestId })

    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('marks provisional results and routes verifying to onVerifying', () => {
    const worker = new FakeWorker()
    const client = new SearchWorkerClient(worker)
    const onResult = vi.fn()
    const onVerifying = vi.fn()

    const requestId = client.search(slots, [], [], {
      onResult,
      onVerifying,
      onDone: vi.fn(),
      onError: vi.fn(),
    })
    worker.emit({ type: 'result', requestId, result: buildResult, provisional: true })
    worker.emit({ type: 'verifying', requestId })
    worker.emit({ type: 'result', requestId, result: buildResult })

    expect(onResult.mock.calls.map(([, provisional]) => provisional)).toEqual([true, false])
    expect(onVerifying).toHaveBeenCalledTimes(1)
  })

  it('replaces the worker to stop a running search, re-sending other pending searches', () => {
    const first = new TerminableFakeWorker()
    const second = new TerminableFakeWorker()
    const client = new SearchWorkerClient(first, () => second)
    const keptOnResult = vi.fn()

    const cancelledId = client.search(slots, [], [], {
      onResult: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    })
    const keptId = client.search(slots, [], [], {
      onResult: keptOnResult,
      onDone: vi.fn(),
      onError: vi.fn(),
    })
    client.cancel(cancelledId)

    expect(first.terminated).toBe(true)
    expect(second.posted).toEqual([expect.objectContaining({ type: 'search', requestId: keptId })])
    second.emit({ type: 'result', requestId: keptId, result: buildResult })
    expect(keptOnResult).toHaveBeenCalledTimes(1)
  })

  it('only posts a cancel message for a search that already finished', () => {
    const first = new TerminableFakeWorker()
    const client = new SearchWorkerClient(first, () => new TerminableFakeWorker())

    const requestId = client.search(slots, [], [], {
      onResult: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    })
    first.emit({ type: 'done', requestId })
    client.cancel(requestId)

    expect(first.terminated).toBe(false)
    expect(first.posted).toContainEqual({ type: 'cancel', requestId })
  })
})

class TerminableFakeWorker extends FakeWorker {
  terminated = false

  terminate(): void {
    this.terminated = true
  }
}
