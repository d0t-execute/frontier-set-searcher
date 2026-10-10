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
 * This test only exercises a single, loosely-constrained requirement.
 * That's a deliberate scope limit, not an oversight: with one skill, the
 * search converges in milliseconds regardless of approach. Multiple
 * *simultaneous* high-threshold requirements -- now handled correctly by
 * meet-in-the-middle (`pareto.ts` + `engine.ts`), confirmed via the
 * property-based brute-force cross-check in `engine.property.test.ts` --
 * are measurably slower: ~24s for the first 20 results at this same scale
 * (see `bench/engine.bench.ts`), short of the plan's sub-5-second target.
 * That's a known follow-up tuning target (the frontier computation itself
 * is the suspected bottleneck, not the streaming merge), not a correctness
 * gap, so it's tracked via the manual benchmark rather than a slow
 * always-run test here.
 */

import { describe, expect, it } from 'vitest'
import { generateDecorations, generateSlots } from './bench/generate'
import { search } from './engine'
import type { SkillRequirement } from './types'

describe('search performance', () => {
  it('returns the first several results quickly even when the full space is huge', () => {
    const options = {
      slotCount: 7,
      candidatesPerSlot: 100,
      skillCount: 6,
      maxOpenSlots: 2,
      decorationCount: 15,
      seed: 42,
    }
    const slots = generateSlots(options)
    const decorations = generateDecorations(options)
    const requirements: SkillRequirement[] = [{ skillId: 1, minPoints: 8 }]

    const start = performance.now()
    const generator = search(slots, requirements, decorations)
    const firstResults = []
    for (let i = 0; i < 20; i++) {
      const next = generator.next()
      if (next.done) break
      firstResults.push(next.value)
    }
    const elapsedMs = performance.now() - start

    expect(firstResults.length).toBeGreaterThan(0)
    // Generous budget for CI machine variance -- the point isn't a precise
    // number, it's "milliseconds, not tens of seconds."
    expect(elapsedMs).toBeLessThan(2000)

    for (let i = 1; i < firstResults.length; i++) {
      expect(firstResults[i - 1].surplus).toBeGreaterThanOrEqual(firstResults[i].surplus)
    }
  })
})
