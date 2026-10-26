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
 * heuristic pool whose results are posted as `provisional`, then a
 * `VerifyingMessage`, then the full search, whose results replace the
 * provisional ones index by index.
 */

import { search } from './engine'
import type { SearchEndReason } from './engine'
import { hasTierPenalties } from './ilp-model'
import type { BuildResult, SearchOptions } from './types'
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
    let producedAny = false

    if (wantsProvisionalPass(options)) {
      // The best score any build could reach if bonus tiers didn't matter
      // (`SearchOptions.withoutTierPenalties`) -- a ceiling on every build's
      // real exact-mode score, and fast to find since that search prunes
      // soundly. A provisional result already scoring it is unbeatable, so it
      // goes out verified on the spot. Measured 2026-10-26: this proves the
      // whole answer instantly on 3 of 4 real benchmark queries, skipping the
      // full pass (11-30s per result) entirely.
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

      // Once one result falls short of the ceiling, everything after it is
      // provisional too: verified results replace provisional ones by
      // position, so the proven ones have to form an unbroken prefix.
      let unproven = 0
      let count = 0
      const poolEnd = await runPass(
        { ...options, provisionalPoolSize: PROVISIONAL_POOL_SIZE },
        (result, objective) => {
          count++
          const proven = unproven === 0 && ceiling !== undefined && objective >= ceiling - 0.5
          if (!proven) unproven++
          postResult(result, proven ? undefined : 'provisional')
        },
      )
      if (poolEnd === 'cancelled') return
      producedAny = count > 0
      // A short pool (fewer than `maxResults`) proves nothing about the
      // builds outside it, so only a full, fully-proven list skips the
      // verifying pass.
      if (unproven === 0 && count === options.maxResults) {
        post({ type: 'done', requestId })
        return
      }
      post({ type: 'verifying', requestId })
    }

    // After a provisional pass the player already has an answer on screen, so
    // the verifying pass trades speed for certainty with a bigger time box.
    const finalOptions = wantsProvisionalPass(options)
      ? {
          ...options,
          timeBoxSeconds: Math.max(options.timeBoxSeconds ?? 0, VERIFICATION_TIME_BOX_SECONDS),
        }
      : options
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
