/**
 * Proves the actual point of the best-first streaming rewrite (see
 * `engine.ts`'s module docstring and docs/PLAN.md §6 step 5): pulling just
 * the top few results must stay fast even when the full valid-combination
 * space is enormous, because the search never materializes it. The earlier
 * eager (sort-everything-then-return) implementation found 407,811 valid
 * combinations in 58 seconds on a dataset barely bigger than this one.
 *
 * This only exercises a single, loosely-constrained requirement. That's a
 * deliberate scope limit, not an oversight: with one skill, the
 * independent-per-skill upper bound used for pruning/priority (see
 * `computeRemainingPotential`) is exact, so best-first branch-and-bound
 * converges immediately. Multiple *simultaneous* high-threshold
 * requirements are a known, confirmed-open scaling problem -- the same
 * bound becomes very loose once several skills must be satisfied together
 * (it assumes a single best-per-skill candidate could exist at every slot
 * at once), and plain branch-and-bound alone doesn't converge in reasonable
 * time/memory at realistic scale no matter how the heap is managed.
 * Confirmed via instrumentation on this exact dataset at this exact scale
 * with 3 simultaneous requirements: 200,000 pops explored with zero leaves
 * reached, while heap size grew linearly with pops (not exponentially) --
 * which rules out an implementation bug and confirms the bound itself needs
 * tightening (meet-in-the-middle, per docs/PLAN.md §6 step 4) before a
 * multi-skill performance test can be added here.
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
