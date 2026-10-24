import { describe, expect, it, vi } from 'vitest'
import { handleSearchRequest } from './worker-handler'
import type { WorkerResponse } from './worker-protocol'
import type { Candidate, SlotQuery } from './types'

function candidate(id: string, skills: Record<number, number>): Candidate {
  return {
    id,
    skills: Object.entries(skills).map(([skillId, points]) => ({
      skillId: Number(skillId),
      points,
    })),
  }
}

describe('handleSearchRequest', () => {
  it('posts a result message per yielded build, then a done message', async () => {
    // Neither candidate dominates the other (one's better at skill 1, the
    // other at skill 2), so both survive as separate results.
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Helm A', { 1: 5, 2: 1 }), candidate('Helm B', { 1: 1, 2: 5 })],
      },
    ]
    const post = vi.fn<(message: WorkerResponse) => void>()

    await handleSearchRequest(
      {
        type: 'search',
        requestId: 'req-1',
        slots,
        requirements: [
          { skillId: 1, minPoints: 0 },
          { skillId: 2, minPoints: 0 },
        ],
      },
      post,
      new Set(),
    )

    // `progress` messages (docs/feedback.md Round 3 #3) can interleave any
    // number of times depending on solve timing -- irrelevant to this test.
    const types = post.mock.calls
      .map(([message]) => message.type)
      .filter((type) => type !== 'progress')
    expect(types).toEqual(['result', 'result', 'done'])
    expect(post.mock.calls.every(([message]) => message.requestId === 'req-1')).toBe(true)
  })

  it('posts an error message when the search throws, instead of a done message', async () => {
    const post = vi.fn<(message: WorkerResponse) => void>()
    const slots = null as unknown as SlotQuery[] // forces search() to throw

    await handleSearchRequest(
      { type: 'search', requestId: 'req-1', slots, requirements: [] },
      post,
      new Set(),
    )

    expect(post).toHaveBeenCalledTimes(1)
    const [message] = post.mock.calls[0]
    expect(message.type).toBe('error')
    expect(message.requestId).toBe('req-1')
  })

  it('stops yielding results once the request is cancelled mid-stream', async () => {
    // A mutually non-dominated chain across two skills, so all three survive
    // pruning and stream out as separate results.
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [
          candidate('Helm A', { 1: 5, 2: 1 }),
          candidate('Helm B', { 1: 3, 2: 3 }),
          candidate('Helm C', { 1: 1, 2: 5 }),
        ],
      },
    ]
    const cancelled = new Set<string>()
    let resultCount = 0
    const post = vi.fn<(message: WorkerResponse) => void>((message) => {
      if (message.type === 'result') {
        resultCount++
        if (resultCount === 1) cancelled.add('req-1')
      }
    })

    await handleSearchRequest(
      {
        type: 'search',
        requestId: 'req-1',
        slots,
        requirements: [
          { skillId: 1, minPoints: 0 },
          { skillId: 2, minPoints: 0 },
        ],
      },
      post,
      cancelled,
    )

    // Cancelled after the first result -- no further result or done message.
    // (`progress` messages are filtered out here for the same reason as the
    // test above.)
    expect(post.mock.calls.map(([m]) => m.type).filter((type) => type !== 'progress')).toEqual([
      'result',
    ])
  })

  it('never starts work for a request already cancelled before it began', async () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm A', { 1: 5 })] }]
    const post = vi.fn<(message: WorkerResponse) => void>()

    await handleSearchRequest(
      { type: 'search', requestId: 'req-1', slots, requirements: [{ skillId: 1, minPoints: 1 }] },
      post,
      new Set(['req-1']),
    )

    expect(post).not.toHaveBeenCalled()
  })
})
