/**
 * Synthetic dataset generator for the Phase 3 benchmark (see docs/PLAN.md §6
 * "Benchmark against the full real dataset... tune pruning until the
 * performance target is met"). The real exported dataset doesn't exist yet
 * (that's Phase 4), so this approximates it at a representative scale per
 * §6's own sizing assumptions: a handful of relevant skills, and "a few
 * hundred candidates per slot" after hard-constraint filtering.
 */

import type { Candidate, Decoration, SkillContribution, SlotQuery } from '../types'

export interface GeneratorOptions {
  readonly slotCount: number
  readonly candidatesPerSlot: number
  readonly skillCount: number
  readonly maxOpenSlots: number
  readonly decorationCount: number
  readonly seed: number
}

/** A small deterministic LCG -- no need for a real PRNG library for a
 * benchmark fixture that just needs to be reproducible across runs. */
function makeRng(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return state / 0x7fffffff
  }
}

function randomSkills(
  rng: () => number,
  skillCount: number,
  maxSkillsPerItem: number,
  maxPoints: number,
): SkillContribution[] {
  const count = 1 + Math.floor(rng() * maxSkillsPerItem)
  const skills = new Map<number, number>()
  for (let i = 0; i < count; i++) {
    const skillId = 1 + Math.floor(rng() * skillCount)
    const points = 1 + Math.floor(rng() * maxPoints)
    skills.set(skillId, (skills.get(skillId) ?? 0) + points)
  }
  return [...skills.entries()].map(([skillId, points]) => ({ skillId, points }))
}

export function generateSlots(options: GeneratorOptions): SlotQuery[] {
  const rng = makeRng(options.seed)
  const slots: SlotQuery[] = []
  for (let s = 0; s < options.slotCount; s++) {
    const candidates: Candidate[] = []
    for (let c = 0; c < options.candidatesPerSlot; c++) {
      const openSlotCount = Math.floor(rng() * (options.maxOpenSlots + 1))
      const openSlots = Array.from({ length: openSlotCount }, () => 1 + Math.floor(rng() * 3))
      candidates.push({
        id: `slot${s}-item${c}`,
        skills: randomSkills(rng, options.skillCount, 3, 6),
        openSlots,
      })
    }
    slots.push({ slotId: `slot-${s}`, candidates })
  }
  return slots
}

export function generateDecorations(options: GeneratorOptions): Decoration[] {
  const rng = makeRng(options.seed + 1)
  const decorations: Decoration[] = []
  for (let d = 0; d < options.decorationCount; d++) {
    decorations.push({
      id: `deco-${d}`,
      slotSize: 1 + Math.floor(rng() * 3),
      skills: randomSkills(rng, options.skillCount, 1, 5),
    })
  }
  return decorations
}
