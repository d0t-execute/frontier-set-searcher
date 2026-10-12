/**
 * Proves the actual point of the streaming engine (see `engine.ts`'s module
 * docstring): pulling just the top few results must stay fast even against a
 * dataset much larger than any single test query strictly needs, and under
 * several simultaneous skill requirements at once -- the two conditions that
 * made the old Pareto-dominance engine this replaced blow up (see
 * `engine.ts`'s module docstring and `engine.real-data.performance.test.ts`
 * for the real-world case that motivated the rewrite). A MIP solve's cost
 * doesn't scale with "how big is the non-dominated frontier" the way the old
 * engine's did, so these budgets are calibrated to the new engine's actual
 * measured cost (a handful of solver round-trips, each roughly flat in
 * cost), not to the old engine's frontier-explosion failure mode.
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

async function firstResults(
  requirements: SkillRequirement[],
  take: number,
  scale = REALISTIC_SCALE,
) {
  const slots = generateSlots(scale)
  const decorations = generateDecorations(scale)

  const start = performance.now()
  const generator = search(slots, requirements, decorations)
  const results = []
  for (let i = 0; i < take; i++) {
    const next = await generator.next()
    if (next.done) break
    results.push(next.value)
  }
  return { results, elapsedMs: performance.now() - start }
}

// Scaled up toward the real dataset's shape (tens of thousands of candidates
// per slot, hundreds of relevant decorations) rather than REALISTIC_SCALE's
// much smaller stand-in. Kept small enough to run quickly in CI while still
// being large enough that a real regression (e.g. rebuilding the whole model
// from scratch every round instead of reusing it) would make this test
// noticeably slower.
const DECORATION_HEAVY_SCALE = {
  slotCount: 5,
  candidatesPerSlot: 1500,
  skillCount: 6,
  maxOpenSlots: 3,
  decorationCount: 200,
  seed: 7,
}

describe('search performance', () => {
  it('returns the first several results quickly for a single loosely-constrained requirement', async () => {
    const { results, elapsedMs } = await firstResults([{ skillId: 1, minPoints: 8 }], 20)

    expect(results.length).toBeGreaterThan(0)
    // Measured ~0.4s on a dev machine; generous budget for CI variance.
    expect(elapsedMs).toBeLessThan(3000)
  })

  it('returns the first several results within budget for simultaneous multi-skill requirements', async () => {
    const { results, elapsedMs } = await firstResults(
      [
        { skillId: 1, minPoints: 15 },
        { skillId: 2, minPoints: 15 },
        { skillId: 3, minPoints: 10 },
      ],
      20,
    )

    expect(results.length).toBeGreaterThan(0)
    // Measured ~3.3s on a dev machine (20 solver round-trips, one per
    // result) -- generous budget for CI variance.
    expect(elapsedMs).toBeLessThan(8000)
  })

  it('stays within budget at a much larger, decoration-heavy scale with several simultaneous requirements', async () => {
    const { results, elapsedMs } = await firstResults(
      [
        { skillId: 1, minPoints: 10 },
        { skillId: 2, minPoints: 10 },
        { skillId: 3, minPoints: 10 },
      ],
      5,
      DECORATION_HEAVY_SCALE,
    )

    expect(results.length).toBeGreaterThan(0)
    // This exact scenario (several thousand candidates per slot, hundreds of
    // decorations, 3 simultaneous requirements) is what first exposed the old
    // engine's frontier-explosion failure mode. Measured ~3s on a dev
    // machine; generous budget for CI variance while still meaningfully
    // enforcing "seconds, not minutes."
    expect(elapsedMs).toBeLessThan(10_000)
  })
})
