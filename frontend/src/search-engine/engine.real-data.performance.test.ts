/**
 * Regression tests against the real, committed data bundle (not a synthetic
 * stand-in -- see `engine.performance.test.ts` for synthetic-scale checks).
 *
 * The 17-skill case reproduces a real, user-reported hang: searching for
 * that many simultaneous skill requirements against the real ~62k-equipment
 * dataset ran for 2+ minutes with zero results under the old Pareto-
 * dominance engine (confirmed root cause: a single decoration-filling
 * sub-problem's non-dominated frontier grew from 294 entries at one open-
 * slot capacity to 32,093 at the next -- the "curse of dimensionality" for
 * skyline queries once many independent dimensions are requested at once,
 * see `engine.ts`'s module docstring). The MIP-based engine that replaced it
 * doesn't build any such frontier, so it doesn't share that failure mode --
 * but a MIP solve's cost is also not free, and this test's budget is
 * calibrated to what it actually costs (tens of seconds, not milliseconds),
 * not to an old engine's failure to even finish.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { search } from './engine'
import type { SearchEndReason } from './engine'
import type {
  Decoration,
  SearchOptions,
  SkillRequirement,
  SkillTierThresholds,
  SlotQuery,
} from './types'

/** A second real, user-supplied 17-skill query, reused by several tests below
 * -- distinct from the "end-game" one in a way that matters: several of these
 * are niche, weapon-specific skills (SnS Tech, Sword God, Drawing Arts,
 * Stylish/Stylish Assault) where even the single best available piece per
 * slot barely contributes, leaving the solver very little room to also
 * satisfy the other 16 requirements at once. Confirmed directly: this query
 * didn't reach a proven-optimal answer within 20+ minutes on some rounds,
 * without the per-round time box (`engine.ts`'s `TIME_BOX_SECONDS`). */
const TIGHT_SWORD_BUILD_REQUIREMENTS: SkillRequirement[] = [
  { skillId: 100, minPoints: 30 }, // SnS Tech - Sword Saint
  { skillId: 175, minPoints: 10 }, // Determination - Solid Determination
  { skillId: 125, minPoints: 50 }, // Strong Attack - Strong Attack+6
  { skillId: 191, minPoints: 10 }, // Furious
  { skillId: 166, minPoints: 10 }, // Thunder Clad
  { skillId: 185, minPoints: 10 }, // Rush
  { skillId: 164, minPoints: 20 }, // Sword God - Sword God+2
  { skillId: 188, minPoints: 10 }, // Point Breakthrough
  { skillId: 172, minPoints: 15 }, // Drawing Arts - Drawing Arts+2
  { skillId: 154, minPoints: 20 }, // Vampirism - Vampirism+2
  { skillId: 177, minPoints: 10 }, // Ice Age
  { skillId: 171, minPoints: 10 }, // Vigorous
  { skillId: 173, minPoints: 15 }, // Stylish Assault
  { skillId: 163, minPoints: 15 }, // Stylish
  { skillId: 114, minPoints: 10 }, // Elemental Attack - Elemental Attack Up
  { skillId: 174, minPoints: 10 }, // Crit Conversion - Critical Conversion
  { skillId: 186, minPoints: 10 }, // Ceaseless
]

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'data')

function loadJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, relativePath), 'utf-8')) as T
}

interface Manifest {
  readonly slotTypes: readonly string[]
}

interface SkillTierRecord {
  readonly minPoints: number
}

interface NamedSkill {
  readonly id: number
  readonly tiers: readonly SkillTierRecord[]
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

function loadRealSkillTiers(): SkillTierThresholds[] {
  return loadJson<NamedSkill[]>('skills.json').map((skill) => ({
    skillId: skill.id,
    tierThresholds: skill.tiers.map((tier) => tier.minPoints),
  }))
}

async function firstResults(
  requirements: SkillRequirement[],
  take: number,
  options: SearchOptions = {},
) {
  const { slots, decorations } = loadRealBundle()
  const start = performance.now()
  const generator = search(slots, requirements, decorations, options)
  const results = []
  // `reason` only ends up meaningful when the loop stops because the
  // generator itself finished (not because `take` was reached first) -- see
  // the "search longer" test below, the one place this file actually checks
  // it (docs/feedback.md Round 3 #4).
  let reason: SearchEndReason | undefined
  for (let i = 0; i < take; i++) {
    const next = await generator.next()
    if (next.done) {
      reason = next.value
      break
    }
    results.push(next.value)
  }
  return { results, elapsedMs: performance.now() - start, reason }
}

function expectAllMeetRequirements(
  results: readonly { skillTotals: ReadonlyMap<number, number> }[],
  requirements: readonly SkillRequirement[],
): void {
  for (const result of results) {
    for (const req of requirements) {
      expect(result.skillTotals.get(req.skillId) ?? 0).toBeGreaterThanOrEqual(req.minPoints)
    }
  }
}

describe('search against the real data bundle', () => {
  it('finds results for a 4-skill query', async () => {
    const requirements: SkillRequirement[] = [
      { skillId: 98, minPoints: 20 }, // Dragon Attack
      { skillId: 4, minPoints: 15 }, // Attack
      { skillId: 10, minPoints: 20 }, // Combining
      { skillId: 154, minPoints: 11 }, // Vampirism
    ]

    // Measured ~12s per round on a dev machine -- looser requirements
    // don't necessarily mean a faster MIP solve: many more candidates tie
    // for optimal, which can cost the solver more branch-and-bound effort
    // to *prove* optimal than a tighter, more selective query does. Only 2
    // results are pulled to keep this test's own CI cost reasonable.
    //
    // Budget widened 2026-10-20: GitHub Actions' runner measurably exceeded
    // the old 40s budget (~48s observed) solving the exact same query --
    // see `engine.ts`'s `TIME_BOX_SECONDS` docstring for why CI is simply
    // slower here, not a regression in this codebase.
    const { results, elapsedMs } = await firstResults(requirements, 2)

    expect(results.length).toBeGreaterThan(0)
    expect(elapsedMs).toBeLessThan(60_000)
    expectAllMeetRequirements(results, requirements)
  }, 90_000)

  it('finds results for a real end-game-scale 17-skill query that used to hang indefinitely', async () => {
    const requirements: SkillRequirement[] = [
      { skillId: 4, minPoints: 10 }, // Attack
      { skillId: 98, minPoints: 10 }, // Dragon Attack
      { skillId: 10, minPoints: 10 }, // Combining
      { skillId: 154, minPoints: 10 }, // Vampirism
      { skillId: 25, minPoints: 10 }, // Defense
      { skillId: 27, minPoints: 10 }, // Health
      { skillId: 23, minPoints: 10 }, // Evasion
      { skillId: 24, minPoints: 10 }, // Guard
      { skillId: 44, minPoints: 10 }, // Fire Res
      { skillId: 56, minPoints: 10 }, // Water Res
      { skillId: 57, minPoints: 10 }, // Thunder Res
      { skillId: 35, minPoints: 10 }, // Ice Res
      { skillId: 38, minPoints: 10 }, // Dragon Res
      { skillId: 17, minPoints: 10 }, // Stamina
      { skillId: 62, minPoints: 10 }, // Sharpness
      { skillId: 53, minPoints: 10 }, // Status Attack
      { skillId: 99, minPoints: 10 }, // Focus
    ]

    // Measured ~26s for the first result and ~14-26s for each subsequent one
    // on a dev machine -- "seconds, not minutes," let alone the old engine's
    // "never finishes." Only 2 results are pulled here (not 20, like the
    // synthetic performance tests) specifically to keep this regression
    // test's own CI cost reasonable while still proving the no-good-cut
    // re-solve loop (not just a single solve) works at real scale.
    //
    // Budget widened 2026-10-20 -- see the 4-skill test above and
    // `engine.ts`'s `TIME_BOX_SECONDS` docstring: CI measurably exceeded the
    // old 90s budget (~99s observed).
    const { results, elapsedMs } = await firstResults(requirements, 2)

    expect(results.length).toBeGreaterThan(0)
    expect(elapsedMs).toBeLessThan(130_000)
    expectAllMeetRequirements(results, requirements)
  }, 180_000)

  it('finds a result for a real, exceptionally tight 17-skill sword-build query within the per-round time box', async () => {
    // Only 1 result is pulled -- this query's whole point is proving the
    // time box bounds a single round, not exercising the no-good-cut loop
    // (already covered by the other real-data tests above).
    //
    // This query specifically needs a much bigger per-attempt budget than
    // `engine.ts`'s production `TIME_BOX_SECONDS`/`MAX_TIME_BOX_ATTEMPTS`
    // defaults to reliably come back with a result at all on CI's slower
    // runner (confirmed directly, 2026-10-20: it still returned zero results
    // even after raising those module defaults to 45s/2 attempts) -- but
    // raising the *defaults* isn't the right fix, since every other caller
    // pays for it too (it cost `engine.property.test.ts` a timeout and
    // nearly tripled this suite's CI runtime, with no benefit to any other
    // query). `options.timeBoxSeconds`/`maxTimeBoxAttempts` let only this one
    // test ask for a bigger budget (worst case 60+120+240=420s).
    const { results, elapsedMs } = await firstResults(TIGHT_SWORD_BUILD_REQUIREMENTS, 1, {
      timeBoxSeconds: 60,
      maxTimeBoxAttempts: 3,
    })

    expect(results.length).toBeGreaterThan(0)
    expect(elapsedMs).toBeLessThan(450_000)
    expectAllMeetRequirements(results, TIGHT_SWORD_BUILD_REQUIREMENTS)
  }, 480_000)

  it("now finds a result for this same query within production's default time box", async () => {
    // This query used to come back empty at production's defaults (90.8s,
    // zero results, `reason: 'timedOut'` -- docs/feedback.md Round 3 #4's
    // 2026-10-25 investigation), which is what motivated the "search longer"
    // retry. Pooling decorations across slots (2026-10-26,
    // docs/search-performance-research.md approach 3) removed the slot
    // symmetry that kept HiGHS from closing it: the first, proven-optimal
    // result now arrives in ~25-30s on a dev machine. The timedOut path itself
    // stays covered by worker-handler.test.ts.
    const { results } = await firstResults(TIGHT_SWORD_BUILD_REQUIREMENTS, 1)

    expect(results).toHaveLength(1)
    expectAllMeetRequirements(results, TIGHT_SWORD_BUILD_REQUIREMENTS)
  }, 180_000)

  it('finds a result for the exceptionally tight sword-build query with preferExactMatches, without activating any bonus skill tier', async () => {
    // Same real, exceptionally tight query as above, but with
    // preferExactMatches on and the real per-skill tier data loaded --
    // reproduces a real regression: this used to return zero results at all
    // (the per-skill big-M indicator machinery was sized so loosely against
    // the real dataset's ~1000 relevant decorations per slot that it made an
    // already-borderline-feasible query unsolvable within its time box; see
    // `ilp-model.ts`'s `computeAchievableRanges`). Budget is looser than the
    // equivalent test above since the extra machinery measurably slows this
    // particular query down (observed ~90s vs ~31s without it) -- still
    // comfortably inside "seconds to low minutes," the project's actual bar.
    //
    // Widened 2026-10-20 in step with the other real-data tests' budgets --
    // see `engine.ts`'s `TIME_BOX_SECONDS` docstring for why CI needs more
    // room than a dev machine does.
    const skillTiers = loadRealSkillTiers()
    const tierThresholdsById = new Map(skillTiers.map((s) => [s.skillId, s.tierThresholds]))
    const requestedSkillIds = new Set(TIGHT_SWORD_BUILD_REQUIREMENTS.map((r) => r.skillId))

    const { results, elapsedMs } = await firstResults(TIGHT_SWORD_BUILD_REQUIREMENTS, 1, {
      preferExactMatches: true,
      skillTiers,
    })

    expect(results.length).toBeGreaterThan(0)
    expect(elapsedMs).toBeLessThan(165_000)
    expectAllMeetRequirements(results, TIGHT_SWORD_BUILD_REQUIREMENTS)
    for (const [skillId, points] of results[0].skillTotals) {
      if (requestedSkillIds.has(skillId)) continue
      for (const threshold of tierThresholdsById.get(skillId) ?? []) {
        if (threshold > 0) expect(points).toBeLessThan(threshold)
        else expect(points).toBeGreaterThan(threshold)
      }
    }
  }, 220_000)
})
