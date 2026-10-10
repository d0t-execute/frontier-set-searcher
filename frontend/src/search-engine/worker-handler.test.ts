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
  it('posts a result message per yielded build, then a done message', () => {
    // Neither candidate dominates the other (one's better at skill 1, the
    // other at skill 2), so both survive as separate results.
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Helm A', { 1: 5, 2: 1 }), candidate('Helm B', { 1: 1, 2: 5 })],
      },
    ]
    const post = vi.fn<(message: WorkerResponse) => void>()

    handleSearchRequest(
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

    const types = post.mock.calls.map(([message]) => message.type)
    expect(types).toEqual(['result', 'result', 'done'])
    expect(post.mock.calls.every(([message]) => message.requestId === 'req-1')).toBe(true)
  })

  it('posts an error message when the search throws, instead of a done message', () => {
    const post = vi.fn<(message: WorkerResponse) => void>()
    const slots = null as unknown as SlotQuery[] // forces search() to throw

    handleSearchRequest(
      { type: 'search', requestId: 'req-1', slots, requirements: [] },
      post,
      new Set(),
    )

    expect(post).toHaveBeenCalledTimes(1)
    const [message] = post.mock.calls[0]
    expect(message.type).toBe('error')
    expect(message.requestId).toBe('req-1')
  })

  it('stops yielding results once the request is cancelled mid-stream', () => {
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

    handleSearchRequest(
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
    expect(post.mock.calls.map(([m]) => m.type)).toEqual(['result'])
  })

  it('never starts work for a request already cancelled before it began', () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm A', { 1: 5 })] }]
    const post = vi.fn<(message: WorkerResponse) => void>()

    handleSearchRequest(
      { type: 'search', requestId: 'req-1', slots, requirements: [{ skillId: 1, minPoints: 1 }] },
      post,
      new Set(['req-1']),
    )

    expect(post).not.toHaveBeenCalled()
  })
})
