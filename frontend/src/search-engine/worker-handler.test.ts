import { describe, expect, it, vi } from 'vitest'
import {
  handleSearchRequest,
  PROVISIONAL_POOL_SIZE,
  PROVISIONAL_TIME_BOX_SECONDS,
  VERIFICATION_TIME_BOX_SECONDS,
} from './worker-handler'
import * as engine from './engine'
import type { WorkerResponse } from './worker-protocol'
import type { BuildResult, Candidate, SlotQuery } from './types'

// A real `search()` solves these tiny synthetic models far too fast to ever
// hit its time box, so the `'timedOut'` tests below spy on `search` instead
// of trying to force a real HiGHS solve to time out deterministically (the
// real thing is instead demonstrated against a known-hard real query in
// engine.real-data.performance.test.ts). Every other test in this file keeps
// using the real `search()` -- only `mockImplementationOnce` calls opt a
// single test into a fake generator.
vi.mock('./engine', async (importOriginal) => {
  const actual = await importOriginal<typeof engine>()
  return { ...actual, search: vi.fn(actual.search) }
})

async function* fakeGenerator(
  results: readonly BuildResult[],
  reason: engine.SearchEndReason,
): AsyncGenerator<BuildResult, engine.SearchEndReason> {
  for (const result of results) yield result
  return reason
}

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

  // docs/feedback.md Round 3 #4's "search longer" retry -- see
  // `TimedOutMessage`'s own docstring for why this only applies when zero
  // results came back.
  it('posts a timedOut message when the generator ends "timedOut" with no results yet', async () => {
    vi.mocked(engine.search).mockImplementationOnce(() => fakeGenerator([], 'timedOut'))
    const post = vi.fn<(message: WorkerResponse) => void>()

    await handleSearchRequest(
      { type: 'search', requestId: 'req-1', slots: [], requirements: [] },
      post,
      new Set(),
    )

    expect(post).toHaveBeenCalledWith({ type: 'timedOut', requestId: 'req-1' })
  })

  it('posts an ordinary done message when the generator ends "timedOut" after at least one result', async () => {
    const result: BuildResult = {
      picks: new Map(),
      decorations: new Map(),
      cuffs: [],
      skillTotals: new Map(),
    }
    vi.mocked(engine.search).mockImplementationOnce(() => fakeGenerator([result], 'timedOut'))
    const post = vi.fn<(message: WorkerResponse) => void>()

    await handleSearchRequest(
      { type: 'search', requestId: 'req-1', slots: [], requirements: [] },
      post,
      new Set(),
    )

    expect(post.mock.calls.map(([m]) => m.type)).toEqual(['result', 'done'])
  })

  it('posts an ordinary done message when the generator ends "exhausted"', async () => {
    vi.mocked(engine.search).mockImplementationOnce(() => fakeGenerator([], 'exhausted'))
    const post = vi.fn<(message: WorkerResponse) => void>()

    await handleSearchRequest(
      { type: 'search', requestId: 'req-1', slots: [], requirements: [] },
      post,
      new Set(),
    )

    expect(post).toHaveBeenCalledWith({ type: 'done', requestId: 'req-1' })
  })

  describe('preferExactMatches provisional-then-verify search', () => {
    const exactOptions = {
      preferExactMatches: true,
      skillTiers: [{ skillId: 9, tierThresholds: [10] }],
      maxResults: 2,
    }
    const resultA: BuildResult = {
      picks: new Map([['head', candidate('A', {})]]),
      decorations: new Map(),
      cuffs: [],
      skillTotals: new Map(),
    }
    const resultB: BuildResult = { ...resultA, picks: new Map([['head', candidate('B', {})]]) }

    /** Like `fakeGenerator`, but reports each result's objective value (and
     * whether its round was proven, `true` unless given) through `search()`'s
     * own hooks argument, as the real engine does. */
    function scored(
      results: readonly (readonly [BuildResult, number, boolean?])[],
      reason: engine.SearchEndReason,
    ) {
      return (...args: Parameters<typeof engine.search>) =>
        (async function* () {
          for (const [result, objective, proven = true] of results) {
            args[5]?.onSolution?.(objective, proven)
            yield result
          }
          return reason
        })()
    }

    async function run(): Promise<WorkerResponse[]> {
      const post = vi.fn<(message: WorkerResponse) => void>()
      await handleSearchRequest(
        { type: 'search', requestId: 'req-1', slots: [], requirements: [], options: exactOptions },
        post,
        new Set(),
      )
      return post.mock.calls.map(([m]) => m)
    }

    it('posts results already at the bonus-free ceiling as proven, skipping the full pass', async () => {
      vi.mocked(engine.search)
        .mockImplementationOnce(scored([[resultA, 100]], 'exhausted'))
        .mockImplementationOnce(
          scored(
            [
              [resultA, 100],
              [resultB, 100],
            ],
            'exhausted',
          ),
        )

      expect(await run()).toEqual([
        { type: 'result', requestId: 'req-1', result: resultA },
        { type: 'result', requestId: 'req-1', result: resultB },
        { type: 'done', requestId: 'req-1' },
      ])
      const calls = vi.mocked(engine.search).mock.calls.slice(-2)
      expect(calls[0][3]).toMatchObject({ withoutTierPenalties: true, maxResults: 1 })
      expect(calls[1][3]).toMatchObject({ provisionalPoolSize: PROVISIONAL_POOL_SIZE })
    })

    it('hands the proven ceiling on as a bound, and keeps the fast pass short', async () => {
      vi.mocked(engine.search)
        .mockImplementationOnce(scored([[resultA, 100]], 'exhausted'))
        .mockImplementationOnce(scored([[resultB, 90]], 'exhausted'))
        .mockImplementationOnce(scored([[resultA, 100]], 'exhausted'))

      await run()

      const [ceilingCall, guessCall, verifyCall] = vi.mocked(engine.search).mock.calls.slice(-3)
      expect(ceilingCall[3]).not.toHaveProperty('primaryObjectiveBound')
      expect(guessCall[3]).toMatchObject({
        primaryObjectiveBound: 100,
        timeBoxSeconds: PROVISIONAL_TIME_BOX_SECONDS,
        maxTimeBoxAttempts: 1,
      })
      expect(verifyCall[3]).toMatchObject({ primaryObjectiveBound: 100 })
    })

    it('marks results below the ceiling provisional, then verifies with the full pass', async () => {
      vi.mocked(engine.search)
        .mockImplementationOnce(scored([[resultA, 100]], 'exhausted'))
        .mockImplementationOnce(
          scored(
            [
              [resultA, 100],
              [resultB, 90],
            ],
            'exhausted',
          ),
        )
        .mockImplementationOnce(
          scored(
            [
              [resultA, 100],
              [resultB, 95],
            ],
            'exhausted',
          ),
        )

      expect(await run()).toEqual([
        { type: 'result', requestId: 'req-1', result: resultA },
        { type: 'result', requestId: 'req-1', result: resultB, provisional: true },
        { type: 'verifying', requestId: 'req-1' },
        { type: 'result', requestId: 'req-1', result: resultA },
        { type: 'result', requestId: 'req-1', result: resultB },
        { type: 'done', requestId: 'req-1' },
      ])
      const lastCall = vi.mocked(engine.search).mock.calls.at(-1)!
      expect(lastCall[3]).not.toHaveProperty('provisionalPoolSize')
      expect(lastCall[3]).not.toHaveProperty('withoutTierPenalties')
      // Only the unproven tail is verified: A (proven) is excluded up front
      // and the pass asks for one fewer result.
      expect(lastCall[3]).toMatchObject({
        maxResults: 1,
        excludedGearSets: [{ candidateIdBySlot: new Map([['head', 'A']]), cuffIds: [] }],
      })
    })

    it('still verifies when the pool comes back short of maxResults, even if all at the ceiling', async () => {
      vi.mocked(engine.search)
        .mockImplementationOnce(scored([[resultA, 100]], 'exhausted'))
        .mockImplementationOnce(scored([[resultA, 100]], 'exhausted'))
        .mockImplementationOnce(
          scored(
            [
              [resultA, 100],
              [resultB, 80],
            ],
            'exhausted',
          ),
        )

      const types = (await run()).map((m) => m.type)
      expect(types).toEqual(['result', 'verifying', 'result', 'result', 'done'])
    })

    it('never certifies against a ceiling that was itself stopped by its time box', async () => {
      vi.mocked(engine.search)
        .mockImplementationOnce(scored([[resultA, 100, false]], 'exhausted'))
        .mockImplementationOnce(
          scored(
            [
              [resultA, 100],
              [resultB, 100],
            ],
            'exhausted',
          ),
        )
        .mockImplementationOnce(
          scored(
            [
              [resultA, 100],
              [resultB, 100],
            ],
            'exhausted',
          ),
        )

      // An unproven ceiling can never certify anything, so the very first
      // guess already falls short of it -- the search commits to verifying
      // everything from there on, rather than also guessing B before
      // checking (2026-10-26, per the project owner).
      const messages = await run()
      expect(messages.slice(0, 2)).toEqual([
        { type: 'result', requestId: 'req-1', result: resultA, provisional: true },
        { type: 'verifying', requestId: 'req-1' },
      ])
    })

    it('stops guessing as soon as one guess misses the ceiling, even with more slots left to fill', async () => {
      const resultC: BuildResult = { ...resultA, picks: new Map([['head', candidate('C', {})]]) }
      vi.mocked(engine.search)
        .mockImplementationOnce(scored([[resultA, 100]], 'exhausted'))
        .mockImplementationOnce(
          scored(
            [
              [resultA, 100],
              [resultB, 50],
              [resultC, 50],
            ],
            'exhausted',
          ),
        )
        .mockImplementationOnce(scored([[resultB, 60]], 'exhausted'))

      const post = vi.fn<(message: WorkerResponse) => void>()
      await handleSearchRequest(
        {
          type: 'search',
          requestId: 'req-1',
          slots: [],
          requirements: [],
          options: { ...exactOptions, maxResults: 3 },
        },
        post,
        new Set(),
      )

      // B misses the ceiling at the second slot -- C is never even guessed,
      // let alone shown, since every slot from there on comes only from the
      // exact pass (see this module's own docstring).
      expect(post.mock.calls.map(([m]) => m)).toEqual([
        { type: 'result', requestId: 'req-1', result: resultA },
        { type: 'result', requestId: 'req-1', result: resultB, provisional: true },
        { type: 'verifying', requestId: 'req-1' },
        { type: 'result', requestId: 'req-1', result: resultB },
        { type: 'done', requestId: 'req-1' },
      ])
      expect(vi.mocked(engine.search)).toHaveBeenCalledTimes(3)
    })

    it('gives the verifying pass its own larger time box, and flags results it could not prove', async () => {
      vi.mocked(engine.search)
        .mockImplementationOnce(scored([[resultA, 100]], 'exhausted'))
        .mockImplementationOnce(scored([[resultA, 90]], 'exhausted'))
        .mockImplementationOnce(
          scored(
            [
              [resultA, 95],
              [resultB, 90, false],
            ],
            'exhausted',
          ),
        )

      const messages = await run()
      expect(messages.slice(-3)).toEqual([
        { type: 'result', requestId: 'req-1', result: resultA },
        { type: 'result', requestId: 'req-1', result: resultB, unproven: true },
        { type: 'done', requestId: 'req-1' },
      ])
      expect(vi.mocked(engine.search).mock.calls.at(-1)![3]).toMatchObject({
        timeBoxSeconds: VERIFICATION_TIME_BOX_SECONDS,
      })
    })

    it('reports done, not timedOut, when only the verifying pass times out', async () => {
      vi.mocked(engine.search)
        .mockImplementationOnce(scored([], 'exhausted'))
        .mockImplementationOnce(scored([[resultA, 50]], 'exhausted'))
        .mockImplementationOnce(scored([], 'timedOut'))

      expect((await run()).at(-1)).toEqual({ type: 'done', requestId: 'req-1' })
    })

    it('runs a single, unmarked pass without preferExactMatches', async () => {
      vi.mocked(engine.search).mockImplementationOnce(scored([[resultA, 100]], 'exhausted'))
      const post = vi.fn<(message: WorkerResponse) => void>()

      await handleSearchRequest(
        {
          type: 'search',
          requestId: 'req-1',
          slots: [],
          requirements: [],
          options: { maxResults: 2 },
        },
        post,
        new Set(),
      )

      expect(post.mock.calls.map(([m]) => m)).toEqual([
        { type: 'result', requestId: 'req-1', result: resultA },
        { type: 'done', requestId: 'req-1' },
      ])
    })
  })
})
