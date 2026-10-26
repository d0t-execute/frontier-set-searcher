/**
 * The worker side of the search message protocol (see worker-protocol.ts),
 * kept free of `self`/`postMessage` so it's testable without a real Worker --
 * `worker.ts` is the thin, untested glue that wires this to the real global
 * (same split as cli.ts/bin.ts for the Node CLI).
 *
 * Pumps the search generator one result at a time, yielding back to the
 * event loop between each (`yieldToEventLoop`). This isn't just politeness:
 * a Web Worker is single-threaded, so a cancel message posted from the main
 * thread can only ever be *received* while this handler isn't in the middle
 * of a synchronous run -- running the whole search in one tight loop (the
 * first version of this function did) meant a 'cancel' message sat in the
 * worker's own queue, completely inert, until the search finished on its
 * own. Yielding after every result gives the worker's message loop a chance
 * to actually process a pending cancel before the next one is produced. A
 * cancel can still never interrupt a single solve already in progress, which
 * is why `SearchWorkerClient` terminates the worker outright when given a
 * way to create a new one.
 *
 * `preferExactMatches` searches run in two passes (2026-10-26,
 * docs/search-performance-research.md section 7): a fast pass over a small
 * heuristic pool, and a slower exact pass that verifies it. They're
 * interleaved one result at a time rather than run back to back (2026-10-26,
 * per the project owner: a later spot should only ever show its real,
 * verified build, never an unconfirmed guess that might still get swapped out
 * -- so the search commits to verifying each one before it ever looks for the
 * next): a fast guess that already matches the bonus-free ceiling (see below)
 * is posted straight away, already proven; the moment one doesn't, it's
 * posted once as `provisional`, a `VerifyingMessage` fires, and every
 * remaining result -- that one included -- comes only from the slower exact
 * pass from then on, with no further guessing in between.
 */

import { search } from './engine'
import type { SearchEndReason } from './engine'
import { hasTierPenalties } from './ilp-model'
import type { BuildResult, ExcludedGearSet, SearchOptions } from './types'
import type { SearchRequestMessage, WorkerResponse } from './worker-protocol'

/** Per-slot pool size for `preferExactMatches`'s fast provisional pass (see
 * `SearchOptions.provisionalPoolSize`). Measured 2026-10-26 on the real
 * benchmark queries: a pool of 20 per slot found the proven-optimal build
 * every time, in 0.3-3.7s against 20-46s for the full search. */
export const PROVISIONAL_POOL_SIZE = 20

/** Seconds each round of the verification pass may run before settling for
 * its best build so far (overriding `engine.ts`'s `TIME_BOX_SECONDS` unless
 * the request already asked for more). Much larger than the normal box: the
 * player already has provisional results on screen and asked for precise ones
 * (2026-10-26, per the project owner), and the old 30s box was cutting real
 * end-game rounds off right before they finished -- given room, each one
 * proved optimal in 30-32s on a dev machine. 300s leaves ~2x headroom for a
 * client 5x slower than that. "Stop verifying" ends it early at any time. */
export const VERIFICATION_TIME_BOX_SECONDS = 300

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** Whether a request gets the provisional-then-verify treatment. Only
 * `preferExactMatches` with tier data needs it -- every other search's
 * pruning is already exact (`candidate-pruning.ts`), so its single pass is
 * both fast and proven. And only with `maxResults` set, since verified
 * results replace provisional ones index by index, which needs every pass
 * capped the same way. */
function wantsProvisionalPass(options: SearchOptions): boolean {
  return hasTierPenalties(options) && options.maxResults !== undefined
}

function gearSetOf(result: BuildResult): ExcludedGearSet {
  return {
    candidateIdBySlot: new Map([...result.picks].map(([slotId, c]) => [slotId, c.id])),
    cuffIds: result.cuffs.map((c) => c.id),
  }
}

export async function handleSearchRequest(
  request: SearchRequestMessage,
  post: (message: WorkerResponse) => void,
  cancelled: ReadonlySet<string>,
): Promise<void> {
  if (cancelled.has(request.requestId)) return
  const { requestId } = request
  const options = request.options ?? {}
  const onProgress = (gap: number) => post({ type: 'progress', requestId, gap })

  /** Drains one `search()` pass, handing each result and its objective value
   * to `onResult`. Driven manually (not `for await...of`, which discards a
   * generator's own return value) so the pass's `SearchEndReason` comes back
   * -- see `TimedOutMessage`'s own docstring for why that matters.
   * `'cancelled'` means the caller should stop without posting anything
   * further. */
  async function runPass(
    passOptions: SearchOptions,
    onResult: (result: BuildResult, objective: number, proven: boolean) => void,
  ): Promise<SearchEndReason | 'cancelled'> {
    let objective = Number.NaN
    let proven = false
    const generator = search(
      request.slots,
      request.requirements,
      request.decorations ?? [],
      passOptions,
      request.cuffs ?? [],
      {
        onProgress,
        onSolution: (value, isProven) => {
          objective = value
          proven = isProven
        },
      },
    )
    for (;;) {
      const next: IteratorResult<BuildResult, SearchEndReason> = await generator.next()
      if (next.done) return next.value
      onResult(next.value, objective, proven)
      await yieldToEventLoop()
      if (cancelled.has(requestId)) {
        await generator.return('exhausted')
        return 'cancelled'
      }
    }
  }

  const postResult = (result: BuildResult, flag?: 'provisional' | 'unproven') =>
    post({
      type: 'result',
      requestId,
      result,
      ...(flag === 'provisional' && { provisional: true as const }),
      ...(flag === 'unproven' && { unproven: true as const }),
    })

  try {
    if (!wantsProvisionalPass(options)) {
      let count = 0
      const finalEnd = await runPass(options, (result, _objective, proven) => {
        count++
        postResult(result, proven ? undefined : 'unproven')
      })
      if (finalEnd === 'cancelled') return
      // Only "nothing at all came back" is worth a "search longer" offer --
      // see `TimedOutMessage`'s own docstring.
      post(
        finalEnd === 'timedOut' && count === 0
          ? { type: 'timedOut', requestId }
          : { type: 'done', requestId },
      )
      return
    }

    // The best score any build could reach if bonus tiers didn't matter
    // (`SearchOptions.withoutTierPenalties`) -- a ceiling on every build's
    // real exact-mode score, and fast to find since that search prunes
    // soundly. A fast-pass guess already scoring it is unbeatable, so it goes
    // out verified on the spot, with no exact solve needed to confirm it.
    // Measured 2026-10-26: this proves the whole answer instantly on 3 of 4
    // real benchmark queries, skipping the exact pass (11-30s per result)
    // entirely.
    let ceiling: number | undefined
    const ceilingEnd = await runPass(
      { ...options, withoutTierPenalties: true, maxResults: 1 },
      // Only a proven ceiling is one: a round stopped at its time box only
      // knows the best build it found so far, not the best possible.
      (_result, objective, proven) => {
        if (proven) ceiling = objective
      },
    )
    if (ceilingEnd === 'cancelled') return

    const maxResults = options.maxResults!
    // Ceiling-matched guesses, in order: an unbroken prefix, since once one
    // guess falls short the search commits to verifying everything from
    // there on rather than keep guessing (see this module's own docstring).
    const proven: BuildResult[] = []
    let producedAny = false
    let brokeOnGuess = false

    let guessObjective = Number.NaN
    const guessGen = search(
      request.slots,
      request.requirements,
      request.decorations ?? [],
      { ...options, provisionalPoolSize: PROVISIONAL_POOL_SIZE },
      request.cuffs ?? [],
      { onProgress, onSolution: (value) => (guessObjective = value) },
    )
    for (let i = 0; i < maxResults; i++) {
      const next = await guessGen.next()
      if (next.done) break // the pool ran dry before filling the list
      if (ceiling === undefined || guessObjective < ceiling - 0.5) {
        postResult(next.value, 'provisional')
        producedAny = true
        brokeOnGuess = true
        await yieldToEventLoop()
        if (cancelled.has(requestId)) {
          await guessGen.return('exhausted')
          return
        }
        break
      }
      proven.push(next.value)
      postResult(next.value)
      producedAny = true
      await yieldToEventLoop()
      if (cancelled.has(requestId)) {
        await guessGen.return('exhausted')
        return
      }
    }
    await guessGen.return('exhausted') // disposes its model if still live

    // A short pool (fewer than `maxResults`, or one guess that missed the
    // ceiling) proves nothing about the builds past it, so only a full,
    // fully-proven list skips the exact pass entirely.
    if (!brokeOnGuess && proven.length === maxResults) {
      post({ type: 'done', requestId })
      return
    }

    post({ type: 'verifying', requestId })
    // The player already has an answer on screen for every proven or
    // provisional spot, so this trades speed for certainty with a bigger time
    // box. It also skips the proven prefix outright: each of those builds
    // scores the bonus-free ceiling, which no build can exceed, and is
    // clean, so they're tied for the very top of the ranking. A ranked list
    // may start with any builds tied at the top, and every later rank is
    // "the best build not already listed" -- exactly what this pass computes
    // once they're excluded. Re-solving them would only rediscover builds
    // already proven (and the UI, which numbers verified results after the
    // proven ones, would have listed them twice).
    const finalOptions: SearchOptions = {
      ...options,
      timeBoxSeconds: Math.max(options.timeBoxSeconds ?? 0, VERIFICATION_TIME_BOX_SECONDS),
      maxResults: maxResults - proven.length,
      excludedGearSets: [...(options.excludedGearSets ?? []), ...proven.map(gearSetOf)],
    }
    let count = 0
    const finalEnd = await runPass(finalOptions, (result, _objective, proven) => {
      count++
      postResult(result, proven ? undefined : 'unproven')
    })
    if (finalEnd === 'cancelled') return
    producedAny ||= count > 0
    // Only "nothing at all came back" is worth a "search longer" offer -- see
    // `TimedOutMessage`'s own docstring.
    post(
      finalEnd === 'timedOut' && !producedAny
        ? { type: 'timedOut', requestId }
        : { type: 'done', requestId },
    )
  } catch (error) {
    post({
      type: 'error',
      requestId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
