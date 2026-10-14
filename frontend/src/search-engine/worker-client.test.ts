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

    expect(onResult).toHaveBeenCalledWith(buildResult)
    expect(onDone).toHaveBeenCalledTimes(1)
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

    expect(second.onResult).toHaveBeenCalledWith(buildResult)
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
})
