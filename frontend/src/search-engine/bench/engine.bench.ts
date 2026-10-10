/**
 * Phase 3 performance benchmark (see docs/PLAN.md §6 performance target:
 * "sub-5-second first-results for a typical query against the full
 * dataset... on a single consumer machine"). Run with `npm run bench` in
 * /frontend. Not part of the regular test suite's pass/fail gate.
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

// Easy case: one loosely-constrained skill -- the independent-per-skill
// bound is exact when there's only one skill, so this should converge fast.
run('1 requirement, low threshold', [{ skillId: 1, minPoints: 8 }], 20)

// Harder case: 3 simultaneous skills at thresholds that require combining
// several slots' worth of points for each -- this is the open problem (see
// docs/weapon... no, docs/PLAN.md §6 step 4, meet-in-the-middle): the
// per-skill-independent bound used for pruning/priority is sound but very
// loose when multiple skills must be satisfied *together*, since it
// assumes a single best-per-skill candidate could exist at every slot
// simultaneously. Confirmed via instrumentation: 200,000 pops explored with
// zero leaves reached, while heap size grew linearly with pops (not
// exponentially) -- ruling out an implementation bug and confirming the
// bound itself needs to be tightened, not the heap-growth strategy.
run(
  '3 requirements, higher thresholds (known slow without meet-in-the-middle)',
  [
    { skillId: 1, minPoints: 15 },
    { skillId: 2, minPoints: 15 },
    { skillId: 3, minPoints: 10 },
  ],
  5,
)
