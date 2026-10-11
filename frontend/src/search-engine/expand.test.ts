/**
 * Covers `expandSlot`/`DecorationFillingCache`'s own decoration-filling
 * frontier, which until now was only exercised indirectly through
 * `pareto.test.ts` (always with zero decorations) and the full-engine
 * property tests in `engine.property.test.ts`. Added alongside fixes for two
 * compounding real-dataset bugs that together hung, then out-of-memory
 * crashed, a real multi-skill search:
 *
 * 1. `computeDecorationFillingFrontier` used to fully drain `fillSlots`
 *    (every raw multiset of relevant decorations fitting a capacity) before
 *    reducing to a Pareto frontier. Real MHF decoration data skews heavily
 *    toward slotSize-1 decorations, and a query touching a common skill
 *    (e.g. "Attack", which many weapon-event decorations carry as a
 *    secondary stat) can make 150+ decorations "relevant" -- at the very
 *    common capacity-3 slot count, that raw enumeration ran to roughly
 *    700,000 multisets *before* any pruning. See `fillSlots`'s own
 *    docstring -- it's kept as the deliberately naive, obviously-correct
 *    reference the tests below check the real (now incremental)
 *    implementation against.
 * 2. Even after (1), `expandSlot` itself built the full (candidate,
 *    decoration filling) cross product before pruning -- fine at a few
 *    thousand options, but real equipment slots run to ~13,000 candidates
 *    each, which multiplied out to 1.6 million raw options on a single real
 *    slot. Fixed by pruning via dominance as options are generated, fusing
 *    what `pareto.ts`'s `reduceSlotOptions` used to do entirely after the
 *    fact (see `expandSlot`'s docstring).
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { cappedVector, dominates, MAX_TIED_ORIGINS } from './dominance'
import { fillSlots } from './decorations'
import { DecorationFillingCache, expandSlot, mergeSkills } from './expand'
import type { Candidate, Decoration, SkillRequirement, SlotQuery } from './types'

function deco(id: string, slotSize: number, skills: Record<number, number>): Decoration {
  return {
    id,
    slotSize,
    skills: Object.entries(skills).map(([skillId, points]) => ({
      skillId: Number(skillId),
      points,
    })),
  }
}

/** A single candidate with no skills of its own and `openSlotCount` open
 * slots, so `expandSlot`'s only contribution to each option's skills is
 * whatever decorations it placed -- isolates the decoration-filling frontier
 * from everything else `expandSlot` does. */
function emptySlot(openSlotCount: number): SlotQuery {
  return { slotId: 'slot', candidates: [{ id: 'bare', skills: [], openSlotCount }] }
}

/** Total decoration-slot capacity a set of placed decorations consumes --
 * independently reimplemented here (not imported from `expand.ts`) so this
 * oracle doesn't just trivially mirror the implementation under test. */
function usedSlotSize(decorationsUsed: readonly Decoration[]): number {
  return decorationsUsed.reduce((sum, d) => sum + d.slotSize, 0)
}

/** Recomputes an option's full (requested skill, open slots, bonus points)
 * vector from its (raw, kept for display) `skills` plus how much
 * decoration-slot capacity it left open -- an independent projection for
 * verifying a surviving option's own properties, not a claim that
 * `expandSlot`'s own dominance matches this exactly (it deliberately
 * doesn't, for performance -- see `skillAndSlotsVector`'s docstring). */
function fullVector(
  skills: readonly { skillId: number; points: number }[],
  openSlots: number,
  requirements: readonly SkillRequirement[],
): number[] {
  const requestedIds = new Set(requirements.map((r) => r.skillId))
  const raw = requirements.map((r) => skills.find((s) => s.skillId === r.skillId)?.points ?? 0)
  const bonusPoints = skills
    .filter((s) => !requestedIds.has(s.skillId))
    .reduce((sum, s) => sum + s.points, 0)
  return cappedVector([...raw, openSlots, bonusPoints], requirements)
}

/** `fullVector` for every option sharing a single known capacity (every test
 * below uses `emptySlot`, a single candidate with one fixed capacity, to
 * isolate the decoration-filling frontier from everything else `expandSlot`
 * does -- see `emptySlot`'s own docstring). */
function vectorsOf(
  options: readonly {
    readonly skills: readonly { skillId: number; points: number }[]
    readonly decorationsUsed: readonly Decoration[]
  }[],
  capacity: number,
  requirements: readonly SkillRequirement[],
): number[][] {
  return options.map((option) =>
    fullVector(option.skills, capacity - usedSlotSize(option.decorationsUsed), requirements),
  )
}

/** A filling's requested-skill-plus-open-slots vector -- no bonus points --
 * what `computeDecorationFillingFrontier`'s own internal DP now compares
 * fillings on (see its docstring: bonus points is tracked only as a
 * tie-break within an exact match on *this* vector, not as a further
 * dominance dimension, to keep the DP's own distinct-group count bounded). */
function skillAndSlotsVector(
  skills: readonly { skillId: number; points: number }[],
  openSlots: number,
  requirements: readonly SkillRequirement[],
): number[] {
  const raw = requirements.map((r) => skills.find((s) => s.skillId === r.skillId)?.points ?? 0)
  return cappedVector([...raw, openSlots], requirements)
}

/** The deliberately naive reference for the property test below: every raw
 * filling from `fillSlots`, reduced by brute force to its non-dominated
 * *requested-skill-plus-open-slots* vectors -- deliberately not the full
 * `fullVector` (which also folds in bonus points). Once more than
 * `MAX_TIED_ORIGINS` distinct raw fillings reach the identical
 * requested-skill-and-open-slots vector -- plausible with several
 * differently-sized decorations sharing a capacity -- which *specific*
 * representative(s) survive is decided by bonus points
 * (`computeDecorationFillingFrontier`'s `tieBreakScore`), not reproducible by
 * an independent brute force without replicating that tie-break exactly. The
 * requested-skill-and-open-slots *set* of reachable vectors is still exactly
 * reproducible, though (appending a dimension that's part of the DP's own
 * grouping key, unlike bonus points, can only add representatives to an
 * already-reached vector, never remove the vector itself) -- which is what
 * this property test actually checks; the smaller, example-based tests above
 * directly exercise the open-slots/bonus-points preference itself, at a
 * scale too small to ever hit that cap. */
function bruteForceFrontierVectors(
  capacity: number,
  decorations: readonly Decoration[],
  requirements: readonly SkillRequirement[],
): number[][] {
  const vectors = fillSlots(capacity, decorations).map((filling) =>
    skillAndSlotsVector(
      filling.skills,
      capacity - usedSlotSize(filling.decorationsUsed),
      requirements,
    ),
  )
  return vectors.filter((v, i) => !vectors.some((other, j) => j !== i && dominates(other, v)))
}

function sortVectors(vectors: number[][]): number[][] {
  return [...vectors].sort((a, b) => a.join(',').localeCompare(b.join(',')))
}

/** Distinct vectors only, ties collapsed -- see the "matches the brute-force
 * reference" test below for why exact tie *counts* aren't compared. */
function uniqueVectors(vectors: number[][]): number[][] {
  return sortVectors([...new Map(vectors.map((v) => [v.join(','), v])).values()])
}

describe('expandSlot decoration filling', () => {
  it('offers a single-decoration filling for each decoration that fits', () => {
    const attack = deco('Attack Jewel', 1, { 1: 3 })
    const defense = deco('Defense Jewel', 1, { 2: 5 })
    // minPoints set well above every raw value used below -- this test is
    // about plain dominance between fillings, not the requirement-capping
    // behavior (covered separately), so staying under the cap keeps vectors
    // equal to their raw points, unaffected by it.
    const requirements: SkillRequirement[] = [
      { skillId: 1, minPoints: 100 },
      { skillId: 2, minPoints: 100 },
    ]

    const expanded = expandSlot(emptySlot(1), [attack, defense], requirements)

    // Neither decorated filling dominates the other (each makes progress on
    // a different skill, using up the same single slot) -- both survive. An
    // undecorated option also survives alongside them now: it trades all
    // skill progress for a slot left fully open, a genuine trade-off of its
    // own (see `skillAndSlotsVector`'s docstring), not something either
    // decorated option strictly beats.
    const decorated = expanded.options.filter((o) => o.decorationsUsed.length > 0)
    expect(decorated.map((o) => o.decorationsUsed[0]?.id).sort()).toEqual([
      'Attack Jewel',
      'Defense Jewel',
    ])
  })

  it('drops a filling dominated by another on every requested skill', () => {
    const weak = deco('Weak Jewel', 1, { 1: 2 })
    const strong = deco('Strong Jewel', 1, { 1: 5 })
    // Above both raw values, so capping is a no-op here -- see the comment
    // on the previous test.
    const requirements: SkillRequirement[] = [{ skillId: 1, minPoints: 100 }]

    const expanded = expandSlot(emptySlot(1), [weak, strong], requirements)

    // Weak and strong use the identical single slot, so they're equal on
    // open slots -- strong still wins on skill points alone.
    const decorated = expanded.options.filter((o) => o.decorationsUsed.length > 0)
    expect(decorated.map((o) => o.decorationsUsed[0]?.id)).toEqual(['Strong Jewel'])
  })

  it('treats a filling that overshoots the requirement as tied with one that just meets it', () => {
    // Confirmed project direction: once a requirement is met, more points in
    // it don't make a build better. Without capping each dimension at its
    // own requirement, "Big Jewel" would dominate (and bury) "Just Enough
    // Jewel" purely for having more raw points, even though neither is
    // actually better once the goal is already reached.
    const justEnough = deco('Just Enough Jewel', 1, { 1: 10 })
    const big = deco('Big Jewel', 1, { 1: 1000 })
    const requirements: SkillRequirement[] = [{ skillId: 1, minPoints: 10 }]

    const expanded = expandSlot(emptySlot(1), [justEnough, big], requirements)

    const decorated = expanded.options.filter((o) => o.decorationsUsed.length > 0)
    expect(decorated.map((o) => o.decorationsUsed[0]?.id).sort()).toEqual([
      'Big Jewel',
      'Just Enough Jewel',
    ])
  })

  it('prefers a filling that meets the requirement using fewer decoration slots, leaving more open', () => {
    // Confirmed project direction: among fillings that already tie on every
    // requested skill, one that leaves more decoration-slot capacity unused
    // is strictly better -- that capacity is what the player gets to spend
    // on whatever decorations suit their own playstyle. A second (or third)
    // copy of the same jewel reaches the identical capped skill vector while
    // wasting a slot that could otherwise stay open, so it must not survive
    // once a single-jewel filling already reaches the same vector.
    const jewel = deco('Attack Jewel', 1, { 1: 10 })
    const requirements: SkillRequirement[] = [{ skillId: 1, minPoints: 10 }]

    const expanded = expandSlot(emptySlot(3), [jewel], requirements)

    // 1, 2, and 3 jewels all reach the identical capped skill vector, so only
    // the single-jewel (most slots left open among the decorated options)
    // filling survives. The never-decorated option (skill unmet, all 3 slots
    // open) is a genuinely different, non-dominated point -- neither it nor
    // the 1-jewel filling beats the other (one has more skill progress, the
    // other more open slots) -- so it survives too.
    const usedCounts = expanded.options.map((o) => o.decorationsUsed.length).sort()
    expect(usedCounts).toEqual([0, 1])
  })

  it('prefers a filling with more bonus skill points when requested skills and slot usage are otherwise identical', () => {
    const plain = deco('Plain Jewel', 1, { 1: 10 })
    const bonus = deco('Bonus Jewel', 1, { 1: 10, 99: 5 })
    const requirements: SkillRequirement[] = [{ skillId: 1, minPoints: 10 }]

    const expanded = expandSlot(emptySlot(1), [plain, bonus], requirements)

    const decorated = expanded.options.filter((o) => o.decorationsUsed.length > 0)
    expect(decorated.map((o) => o.decorationsUsed[0]?.id)).toEqual(['Bonus Jewel'])
  })

  it('prefers the slot-efficient filling over one with more bonus points, once decoration choices differ in both', () => {
    // The decoration-filling DP itself (`computeDecorationFillingFrontier`)
    // correctly keeps both as a genuine trade-off -- it tracks bonus points
    // in full dominance now, not just as a tie-break (see its docstring).
    // The loss happens one level up: `expandSlot`'s own dominance
    // (`skillAndSlotsVector`) deliberately stops at requested skill and open
    // slots, for performance at its ~13,000-candidate scale (see that
    // function's docstring) -- so here, where both fillings apply to the
    // *same* bare candidate, open-slots-only dominance sees "1 slot used, 1
    // open" (efficient) as strictly better than "2 slots used, 0 open"
    // (versatile), regardless of versatile's bonus points, and versatile
    // never gets a chance to reach `pareto.ts`'s own full-dominance pass the
    // way a losing *candidate* (see "doesn't prune a candidate..." below)
    // does. A documented, accepted trade-off, narrower in scope than it used
    // to be: it only costs a decoration-choice alternative on one candidate,
    // not a whole candidate.
    const efficient = deco('Efficient Jewel', 1, { 1: 10 })
    const versatile = deco('Versatile Jewel', 2, { 1: 10, 99: 20 })
    const requirements: SkillRequirement[] = [{ skillId: 1, minPoints: 10 }]

    const expanded = expandSlot(emptySlot(2), [efficient, versatile], requirements)

    const decorated = expanded.options.filter((o) => o.decorationsUsed.length > 0)
    expect(decorated.map((o) => o.decorationsUsed[0]?.id)).toEqual(['Efficient Jewel'])
  })

  it('shares one frontier across every candidate and slot with the same capacity via the cache', () => {
    const attack = deco('Attack Jewel', 1, { 1: 3 })
    const requirements: SkillRequirement[] = [{ skillId: 1, minPoints: 0 }]
    const cache = new DecorationFillingCache()

    const first = cache.get(1, [attack], requirements)
    const second = cache.get(1, [attack], requirements)

    expect(second).toBe(first) // same array instance, not recomputed
  })

  const skillIdArb = fc.integer({ min: 1, max: 4 })
  const decorationsArb = fc.uniqueArray(
    fc.record({
      id: fc.uuid(),
      slotSize: fc.integer({ min: 1, max: 3 }),
      skills: fc.uniqueArray(
        fc.record({ skillId: skillIdArb, points: fc.integer({ min: 1, max: 10 }) }),
        { selector: (s) => s.skillId, maxLength: 2 },
      ),
    }),
    { selector: (d) => d.id, maxLength: 5 },
  )
  // At least one requirement, matching real usage (the UI never lets a
  // search run with zero skills picked): with zero requested dimensions,
  // dominance is vacuously never true for *any* pair of vectors (both are
  // always `[]`), so nothing ever gets pruned and even irrelevant
  // decorations produce "distinct" tied entries -- a degenerate case the
  // skip-irrelevant-decorations optimization below deliberately doesn't
  // preserve, since it can never arise from a real search. `minPoints` starts
  // at 1, not 0, for the same reason: every real skill tier threshold is
  // positive (confirmed by the project's own skill-tier data), and a
  // `minPoints: 0` requirement caps *every* raw value to 0 regardless of
  // decorations used, making an unrealistically large number of genuinely
  // different fillings tie on the exact same requested-skill vector at once
  // -- exactly the degenerate scenario `MAX_TIED_ORIGINS` (dominance.ts's
  // own docstring) documents as an accepted, bounded trade-off, not
  // something a real query ever triggers.
  const requirementsArb = fc.uniqueArray(
    fc.record({ skillId: skillIdArb, minPoints: fc.integer({ min: 1, max: 15 }) }),
    { selector: (r) => r.skillId, minLength: 1, maxLength: 4 },
  )
  const capacityArb = fc.integer({ min: 0, max: 4 })

  it('reaches exactly the same set of distinct vectors as the brute-force (fillSlots + prune) reference', () => {
    // Compares distinct vectors, not exact tie counts. Capping breaks a
    // property the incremental DP otherwise relies on for completeness:
    // without capping, "A is dominated by B" guarantees A+C is *strictly*
    // dominated by B+C for any further addition C (raw addition preserves
    // strict inequalities), so discarding a dominated source as a future
    // building block never loses a genuinely distinct outcome. Capping is
    // non-linear (`min(x, cap)`), so it can map two different raw values to
    // the same capped one -- meaning a source dominated *before* some later
    // addition can tie (not lose) with the winning source *after* it, via a
    // path this DP never explores once that source was pruned. This can
    // only ever under-count how many distinct raw ways reach a tied vector,
    // never hide a better achievable outcome or admit a worse one -- every
    // distinct vector the brute-force reference finds is still found here.
    fc.assert(
      fc.property(
        capacityArb,
        decorationsArb,
        requirementsArb,
        (capacity, decorations, requirements) => {
          // Mirrors the real contract: `search()` always runs decorations
          // through `filterRelevantDecorations` before `expandSlot` ever sees
          // them (see expand.ts's own docstring on why). A decoration
          // irrelevant to every requested dimension is a degenerate case
          // `expandSlot` isn't meant to handle on its own -- with it left in,
          // "ties are preserved" would require treating placing a
          // contributes-nothing decoration as a distinct result from not
          // placing it, which is exactly the blow-up `filterRelevantDecorations`
          // exists to avoid one layer up.
          const requestedSkillIds = new Set(requirements.map((r) => r.skillId))
          const relevant = decorations.filter((d) =>
            d.skills.some((s) => requestedSkillIds.has(s.skillId)),
          )

          const expanded = expandSlot(emptySlot(capacity), relevant, requirements)

          // Requested-skill-plus-open-slots comparison -- see
          // `bruteForceFrontierVectors`'s docstring for why bonus points isn't
          // folded in here too.
          const actual = uniqueVectors(
            expanded.options.map((o) =>
              skillAndSlotsVector(
                o.skills,
                capacity - usedSlotSize(o.decorationsUsed),
                requirements,
              ),
            ),
          )
          const expected = uniqueVectors(
            bruteForceFrontierVectors(capacity, relevant, requirements),
          )

          expect(actual).toEqual(expected)
        },
      ),
      { numRuns: 200 },
    )
  })

  it('stays fast when many slot-size-1 decorations are relevant at a common capacity', () => {
    // Mirrors the real dataset: a query touching a common skill can make
    // 150+ mostly slot-size-1 decorations "relevant", and capacity 3 is the
    // single most common open-slot count across real equipment. The old
    // brute-force-then-prune implementation enumerated ~700,000 raw
    // multisets here before pruning a single one.
    const decorations: Decoration[] = Array.from({ length: 150 }, (_, i) =>
      deco(`deco-${i}`, 1, { [i % 4]: 1 + (i % 10) }),
    )
    // A realistic, non-zero requirement per skill (matching real query
    // magnitudes) -- minPoints: 0 would cap every dimension to 0, collapsing
    // all 150 decorations into one single tied group and defeating the
    // point of this test (it's no longer "many distinct vectors pruned
    // efficiently," just "one group with many origins," a different case
    // already covered by the "many candidates tie" tests below).
    const requirements: SkillRequirement[] = [0, 1, 2, 3].map((skillId) => ({
      skillId,
      minPoints: 5,
    }))

    const start = performance.now()
    const expanded = expandSlot(emptySlot(3), decorations, requirements)
    const elapsedMs = performance.now() - start

    expect(expanded.options.length).toBeGreaterThan(0)
    expect(elapsedMs).toBeLessThan(1000)
  })
})

describe('expandSlot candidate pruning', () => {
  it('drops a candidate-and-filling combination dominated by another, across different candidates', () => {
    // Above both raw values, so capping is a no-op (this test is about
    // plain dominance, not requirement-capping).
    const requirements: SkillRequirement[] = [{ skillId: 1, minPoints: 100 }]
    const slot: SlotQuery = {
      slotId: 'slot',
      candidates: [
        { id: 'strong', skills: [{ skillId: 1, points: 5 }] },
        { id: 'weak', skills: [{ skillId: 1, points: 2 }] },
      ],
    }

    const expanded = expandSlot(slot, [], requirements)

    const vectors = vectorsOf(expanded.options, 0, requirements)
    expect(vectors).toEqual([[5, 0, 0]])
  })

  it('prefers a candidate with more open decoration slots when requested skills are otherwise identical', () => {
    // Confirmed project direction: a candidate that leaves more decoration
    // capacity free for the player's own playstyle choices, with nothing
    // else different, is strictly better -- not merely a display concern.
    const requirements: SkillRequirement[] = [{ skillId: 1, minPoints: 5 }]
    const slot: SlotQuery = {
      slotId: 'slot',
      candidates: [
        { id: 'plain', skills: [{ skillId: 1, points: 5 }], openSlotCount: 1 },
        { id: 'slotted', skills: [{ skillId: 1, points: 5 }], openSlotCount: 3 },
      ],
    }

    const expanded = expandSlot(slot, [], requirements)

    expect(expanded.options.map((o) => o.candidate.id)).toEqual(['slotted'])
  })

  it('preserves ties: two different candidates reaching the same full scoring vector both survive', () => {
    // Identical on every dimension -- requested skill, open slots, and bonus
    // points -- e.g. cosmetically distinct color variants of the same piece.
    // This test uses matching bonus skills on both candidates rather than
    // giving one a bonus the other lacks, so it holds regardless of whether
    // bonus points is read as full dominance or only a tie-break at whatever
    // layer happens to compare them.
    const requirements: SkillRequirement[] = [{ skillId: 1, minPoints: 100 }]
    const slot: SlotQuery = {
      slotId: 'slot',
      candidates: [
        {
          id: 'red-variant',
          skills: [
            { skillId: 1, points: 5 },
            { skillId: 99, points: 10 },
          ],
        },
        {
          id: 'blue-variant',
          skills: [
            { skillId: 1, points: 5 },
            { skillId: 99, points: 10 },
          ],
        },
      ],
    }

    const expanded = expandSlot(slot, [], requirements)

    expect(expanded.options.map((o) => o.candidate.id).sort()).toEqual([
      'blue-variant',
      'red-variant',
    ])
  })

  it("doesn't prune a candidate with fewer bonus skill points at this layer, deferring to pareto.ts's full dominance", () => {
    // `expandSlot`'s own dominance deliberately stops at requested skill and
    // open slots (see `skillAndSlotsVector`'s docstring: bonus points only
    // breaks ties once a group is already over `MAX_TIED_ORIGINS`, which two
    // candidates never reach) -- so "plain" and "fancy" both survive *this*
    // layer, tied on (skill, open slots) alone. `pareto.ts`'s own vector
    // still applies full dominance including bonus points on the resulting
    // (much smaller) candidate set, which is where "fancy" actually wins --
    // see pareto.test.ts's "prefers a build with more bonus skill points..."
    // for that.
    const requirements: SkillRequirement[] = [{ skillId: 1, minPoints: 100 }]
    const slot: SlotQuery = {
      slotId: 'slot',
      candidates: [
        { id: 'plain', skills: [{ skillId: 1, points: 5 }] },
        {
          id: 'fancy',
          skills: [
            { skillId: 1, points: 5 },
            { skillId: 99, points: 10 },
          ],
        },
      ],
    }

    const expanded = expandSlot(slot, [], requirements)

    expect(expanded.options.map((o) => o.candidate.id).sort()).toEqual(['fancy', 'plain'])
  })

  it('avoids materializing the full candidates x decoration-fillings cross product', () => {
    // Mirrors the real dataset's shape (~13,000 candidates per slot, a
    // sizeable decoration frontier once several skills are requested at
    // once): the old implementation built every (candidate, filling) pair
    // before pruning, which ran to 1.6 million raw options on a single real
    // slot and exhausted memory. Each candidate here has a strictly
    // increasing, *unique* point value on one of 3 axes -- so within an
    // axis, every candidate strictly dominates every earlier one on that
    // same axis (once combined with the same decoration filling), and the
    // frontier never accumulates more than "the best so far per axis per
    // filling" instead of growing with the candidate count. (Giving many
    // candidates the exact *same* vector instead would be a different,
    // deliberate stress case -- see the module docstring on ties -- that
    // pathologically inflates the frontier with never-pruned duplicates
    // instead of exercising this fix; that's not what's being tested here.)
    // Above every reachable combined value (candidates alone run up to
    // 7999), so capping is a no-op -- this test is about candidate-level
    // pruning via plain dominance, not requirement-capping.
    const requirements: SkillRequirement[] = [1, 2, 3].map((skillId) => ({
      skillId,
      minPoints: 100_000,
    }))
    // Distinct point values per axis (not repeated across several
    // decorations) -- several decorations tying at the exact same point
    // value is itself the "many ties" case covered by the next test, and
    // compounds combinatorially one layer earlier, inside the decoration
    // frontier itself. Keeping values unique here isolates what this test is
    // actually about: candidate-level pruning, not decoration-level ties.
    const decorations: Decoration[] = Array.from({ length: 60 }, (_, i) =>
      deco(`deco-${i}`, 1, { [1 + (i % 3)]: 1 + i }),
    )
    const candidates: Candidate[] = Array.from({ length: 8000 }, (_, i) => ({
      id: `c-${i}`,
      skills: [{ skillId: 1 + (i % 3), points: i }],
      openSlotCount: 3,
    }))
    const slot: SlotQuery = { slotId: 'slot', candidates }

    const start = performance.now()
    const expanded = expandSlot(slot, decorations, requirements)
    const elapsedMs = performance.now() - start

    expect(elapsedMs).toBeLessThan(2000)
    expect(expanded.options.length).toBeLessThan(candidates.length)
  })

  it('stays fast even when many candidates tie on the exact same requested vector', () => {
    // The flip side of the test above: real equipment plausibly includes
    // many pieces that are cosmetically distinct but identical on every
    // *requested* skill (e.g. color variants). Ties are preserved up to
    // `MAX_TIED_ORIGINS` (see dominance.ts's docstring) rather than being
    // deduplicated to a single representative -- but, confirmed against the
    // real dataset, a loose requirement can make *most* of a ~13,000-item
    // slot tie on the exact same vector, so the group itself must stay
    // bounded rather than growing proportional to how many candidates tie.
    const requirements: SkillRequirement[] = [{ skillId: 1, minPoints: 0 }]
    const candidates: Candidate[] = Array.from({ length: 4000 }, (_, i) => ({
      id: `c-${i}`,
      skills: [{ skillId: 1, points: 5 }], // every candidate ties at vector [5]
    }))
    const slot: SlotQuery = { slotId: 'slot', candidates }

    const start = performance.now()
    const expanded = expandSlot(slot, [], requirements)
    const elapsedMs = performance.now() - start

    expect(expanded.options).toHaveLength(MAX_TIED_ORIGINS) // bounded, not all 4000 ties
    expect(elapsedMs).toBeLessThan(3000)
  })
})

describe('mergeSkills', () => {
  it('sums points for a skill present on both sides', () => {
    expect(mergeSkills([{ skillId: 1, points: 3 }], [{ skillId: 1, points: 4 }])).toEqual([
      { skillId: 1, points: 7 },
    ])
  })

  it('keeps skills unique to either side', () => {
    const merged = mergeSkills([{ skillId: 1, points: 3 }], [{ skillId: 2, points: 4 }])
    expect(merged.sort((a, b) => a.skillId - b.skillId)).toEqual([
      { skillId: 1, points: 3 },
      { skillId: 2, points: 4 },
    ])
  })

  it('returns an equivalent (copied) array when either side is empty', () => {
    expect(mergeSkills([], [{ skillId: 1, points: 3 }])).toEqual([{ skillId: 1, points: 3 }])
    expect(mergeSkills([{ skillId: 1, points: 3 }], [])).toEqual([{ skillId: 1, points: 3 }])
    expect(mergeSkills([], [])).toEqual([])
  })

  it('never mutates its inputs', () => {
    const a = [{ skillId: 1, points: 3 }]
    const b = [{ skillId: 1, points: 4 }]
    mergeSkills(a, b)
    expect(a).toEqual([{ skillId: 1, points: 3 }])
    expect(b).toEqual([{ skillId: 1, points: 4 }])
  })
})
