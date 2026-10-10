/**
 * Phase 3 performance benchmark (see docs/PLAN.md §6 performance target:
 * "sub-5-second first-results for a typical query against the full
 * dataset... on a single consumer machine"). Run with `npm run bench` in
 * /frontend. A single timed run per scale, not a statistical `vitest bench`
 * (the worst case here can be very slow, and a one-shot measurement is
 * easier to reason about than letting a benchmark harness decide how many
 * times to repeat a potentially multi-second call). Not part of the regular
 * test suite's pass/fail gate.
 */

import { search } from '../engine'
import type { SkillRequirement } from '../types'
import { generateSlots } from './generate'

function run(label: string, fn: () => unknown): void {
  const start = performance.now()
  const result = fn() as unknown[]
  const elapsedMs = performance.now() - start
  console.log(`${label}: ${result.length} results in ${elapsedMs.toFixed(0)}ms`)
}

const requirements: SkillRequirement[] = [
  { skillId: 1, minPoints: 15 },
  { skillId: 2, minPoints: 15 },
  { skillId: 3, minPoints: 10 },
]

// Scaling curve: find where the plain branch-and-bound DFS stops being fast
// enough, before deciding whether meet-in-the-middle (§6 step 4) is needed.
for (const candidatesPerSlot of [20, 50, 100, 150, 200]) {
  const options = {
    slotCount: 7,
    candidatesPerSlot,
    skillCount: 6,
    maxOpenSlots: 0, // isolate equipment-only scaling first
    decorationCount: 0,
    seed: 42,
  }
  const slots = generateSlots(options)
  run(`7 slots x ${candidatesPerSlot} candidates, no decorations`, () =>
    search(slots, requirements),
  )
}
