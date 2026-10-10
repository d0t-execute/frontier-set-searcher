/**
 * Phase 3 performance benchmark (see docs/PLAN.md §6 performance target:
 * "sub-5-second first-results for a typical query against the full
 * dataset... on a single consumer machine"). Run with `npm run bench` in
 * /frontend. Not part of the regular test suite's pass/fail gate --
 * meet-in-the-middle's Pareto-frontier computation is eager (it must fully
 * resolve both halves before the streaming merge can start), so "first
 * results" latency is dominated by frontier computation time, not by how
 * many results are requested.
 *
 * Measured results at this scale (7 slots x 100 candidates, 6 skills, 15
 * decorations, seed 42):
 * - 1 loosely-constrained requirement: ~10ms for the first 20 results.
 * - 3 simultaneous requirements at higher thresholds: ~1.7s for the first 20
 *   results -- within the sub-5-second target. This is the scenario that
 *   previously never terminated at all (branch-and-bound alone: 200,000
 *   search-tree nodes explored, zero results, eventual out-of-memory), then
 *   completed but slowly once meet-in-the-middle fixed correctness (~24s).
 *   Profiling found the actual cost: each slot can have 1000+ options after
 *   decoration expansion, and `computeFrontier` was combining the running
 *   cross-slot frontier against that *raw* list every time -- at the 4th
 *   slot of a 4-slot half, the frontier reached 12,058 entries and that one
 *   step alone took 21.5s (confirmed via instrumented per-slot timing, not
 *   guessed). Pre-reducing each slot's own options to its own Pareto
 *   frontier before combining -- most of those 1000+ options are already
 *   dominated by another option in the *same* slot, independent of
 *   anything else -- cut that same step to 1.6s without changing the final
 *   frontier at all (domination is transitive, so nothing that would have
 *   survived was ever at risk of being pruned early).
 */

import { search } from '../engine'
import type { SkillRequirement } from '../types'
import { generateDecorations, generateSlots } from './generate'

function run(label: string, requirements: SkillRequirement[], take: number): void {
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

  const start = performance.now()
  const generator = search(slots, requirements, decorations)
  const results = []
  for (let i = 0; i < take; i++) {
    const next = generator.next()
    if (next.done) break
    results.push(next.value)
  }
  const elapsedMs = performance.now() - start
  console.log(`${label}: first ${results.length} results in ${elapsedMs.toFixed(0)}ms`)
}

run('1 requirement, low threshold', [{ skillId: 1, minPoints: 8 }], 20)

run(
  '3 requirements, higher thresholds',
  [
    { skillId: 1, minPoints: 15 },
    { skillId: 2, minPoints: 15 },
    { skillId: 3, minPoints: 10 },
  ],
  20,
)
