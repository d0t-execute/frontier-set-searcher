/**
 * Proves the actual point of the streaming engine (see `engine.ts`'s module
 * docstring and docs/PLAN.md §6 step 5): pulling just the top few results
 * must stay fast even when the full valid-combination space is enormous,
 * because the search never materializes it. An earlier eager (sort-
 * everything-then-return) implementation found 407,811 valid combinations
 * in 58 seconds on a dataset barely bigger than this one; a later
 * single-pass best-first rewrite (correct, but using a loose per-skill
 * independent bound) explored 200,000 search-tree nodes with *zero*
 * complete results on a 3-simultaneous-skill query at this exact scale,
 * eventually running out of memory.
 *
 * Meet-in-the-middle (`pareto.ts` + `engine.ts`) fixed both correctness
 * (confirmed via the property-based brute-force cross-check in
 * `engine.property.test.ts`) and, after profiling found the real cost was
 * `computeFrontier` combining against each slot's *raw*, unreduced option
 * list (1000+ options after decoration expansion) rather than that slot's
 * own much-smaller Pareto frontier, speed: the 3-simultaneous-skill query
 * below went from never completing, to ~24s, to ~1.7s at this scale --
 * inside the plan's sub-5-second target. See `bench/engine.bench.ts` for
 * the full measurement history.
 */

import { describe, expect, it } from 'vitest'
import { generateDecorations, generateSlots } from './bench/generate'
import { search } from './engine'
import type { SkillRequirement } from './types'

const REALISTIC_SCALE = {
  slotCount: 7,
  candidatesPerSlot: 100,
  skillCount: 6,
  maxOpenSlots: 2,
  decorationCount: 15,
  seed: 42,
}

function firstResults(requirements: SkillRequirement[], take: number) {
  const slots = generateSlots(REALISTIC_SCALE)
  const decorations = generateDecorations(REALISTIC_SCALE)

  const start = performance.now()
  const generator = search(slots, requirements, decorations)
  const results = []
  for (let i = 0; i < take; i++) {
    const next = generator.next()
    if (next.done) break
    results.push(next.value)
  }
  return { results, elapsedMs: performance.now() - start }
}

describe('search performance', () => {
  it('returns the first several results quickly for a single loosely-constrained requirement', () => {
    const { results, elapsedMs } = firstResults([{ skillId: 1, minPoints: 8 }], 20)

    expect(results.length).toBeGreaterThan(0)
    // Generous budget for CI machine variance -- the point isn't a precise
    // number, it's "milliseconds, not tens of seconds."
    expect(elapsedMs).toBeLessThan(2000)

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].surplus).toBeGreaterThanOrEqual(results[i].surplus)
    }
  })

  it('returns the first several results within the sub-5-second target for simultaneous multi-skill requirements', () => {
    const { results, elapsedMs } = firstResults(
      [
        { skillId: 1, minPoints: 15 },
        { skillId: 2, minPoints: 15 },
        { skillId: 3, minPoints: 10 },
      ],
      20,
    )

    expect(results.length).toBeGreaterThan(0)
    // Measured ~1.7s on a dev machine; generous budget for CI variance
    // while still enforcing the plan's actual target.
    expect(elapsedMs).toBeLessThan(5000)

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].surplus).toBeGreaterThanOrEqual(results[i].surplus)
    }
  })
})
