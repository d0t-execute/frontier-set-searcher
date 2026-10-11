/**
 * Regression test for a real, user-reported hang: searching for Dragon
 * Attack>=20, Attack>=15, Combining>=20, Vampirism>=11 against the real
 * exported data bundle ran for 5+ minutes with no result, then reliably
 * out-of-memory crashed in isolated profiling. Three compounding causes,
 * all in `expand.ts`:
 *
 * 1. Decoration-slot filling brute-force enumerated every raw multiset of
 *    relevant decorations before pruning -- ~700,000 multisets for this
 *    query's ~160 relevant decorations at the common capacity-3 slot count.
 * 2. `expandSlot` built the full (candidate, decoration filling) cross
 *    product before pruning -- 1.6 million raw options on a single real
 *    slot (~13,000 candidates each).
 * 3. Even with (1) and (2) fixed by pruning incrementally, the project's
 *    "ties are preserved" rule (see pareto.ts's module docstring) meant
 *    that the real decoration catalog's many exact-point-value duplicates
 *    (e.g. 44 different decorations worth exactly 3 Vampirism points each)
 *    combinatorially inflated the frontier anyway, just one layer down.
 *
 * (1) and (2) are covered in isolation by `expand.test.ts`; (3) by
 * `dominance.test.ts`'s `ParetoFrontier` tests. This test exercises the
 * real, full-scale regression end to end, against the actual committed data
 * bundle (not a synthetic stand-in -- the real decoration catalog's skew
 * toward many identically-valued decorations is exactly what the synthetic
 * generator in `bench/generate.ts` doesn't reproduce, which is why
 * `engine.performance.test.ts`'s DECORATION_HEAVY_SCALE case never caught
 * this).
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { search } from './engine'
import type { Decoration, SkillRequirement, SlotQuery } from './types'

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'data')

function loadJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, relativePath), 'utf-8')) as T
}

interface Manifest {
  readonly slotTypes: readonly string[]
}

function loadRealBundle(): { slots: SlotQuery[]; decorations: Decoration[] } {
  const manifest = loadJson<Manifest>('manifest.json')
  return {
    slots: manifest.slotTypes.map((slotType) => ({
      slotId: slotType,
      candidates: loadJson(`equipment/${slotType}.json`),
    })),
    decorations: loadJson<Decoration[]>('decorations.json'),
  }
}

describe('search against the real data bundle', () => {
  it('finds results for a 4-skill query within the sub-5-second target', () => {
    const { slots, decorations } = loadRealBundle()
    const requirements: SkillRequirement[] = [
      { skillId: 98, minPoints: 20 }, // Dragon Attack
      { skillId: 4, minPoints: 15 }, // Attack
      { skillId: 10, minPoints: 20 }, // Combining
      { skillId: 154, minPoints: 11 }, // Vampirism
    ]

    const start = performance.now()
    const results = []
    for (const result of search(slots, requirements, decorations)) {
      results.push(result)
      if (results.length >= 20) break
    }
    const elapsedMs = performance.now() - start

    expect(results.length).toBeGreaterThan(0)
    expect(elapsedMs).toBeLessThan(5000)

    for (const result of results) {
      for (const req of requirements) {
        expect(result.skillTotals.get(req.skillId) ?? 0).toBeGreaterThanOrEqual(req.minPoints)
      }
    }
  })
})
