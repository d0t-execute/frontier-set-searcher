/**
 * Covers `dominates` and `ParetoFrontier`. The latter replaces a plain
 * array + linear-scan insert (`insertNonDominated`, now removed) used by
 * every Pareto-frontier builder in the search engine -- see its own
 * docstring for why: real equipment/decoration data can have dozens of
 * distinct items sharing the exact same point value on a requested skill
 * (confirmed on the real dataset -- 44 different decorations worth exactly
 * 3 Vampirism points each), and combined with a capacity limit, the number
 * of combinatorially distinct ways to pick from such a group (ties the
 * project deliberately preserves, see pareto.ts's module docstring) can run
 * into the thousands. A linear-scan frontier re-scans the *entire* frontier
 * on every one of those ties, making insertion cost scale with how many
 * ties exist rather than how many genuinely different vectors exist --
 * measured taking over a minute on a scale that should finish in under a
 * second. Grouping exact ties behind an O(1) hash lookup fixes that while
 * leaving every other guarantee (ties preserved, dominated entries dropped)
 * unchanged.
 */

import { describe, expect, it } from 'vitest'
import { cappedVector, dominates, MAX_TIED_ORIGINS, ParetoFrontier } from './dominance'
import type { SkillRequirement } from './types'

describe('dominates', () => {
  it('is true when a is at least as good on every dimension and strictly better on one', () => {
    expect(dominates([5, 3], [5, 2])).toBe(true)
    expect(dominates([5, 3], [3, 3])).toBe(true)
  })

  it('is false for identical vectors -- ties never count as domination', () => {
    expect(dominates([5, 3], [5, 3])).toBe(false)
  })

  it('is false when a is worse on any dimension', () => {
    expect(dominates([5, 1], [5, 2])).toBe(false)
  })
})

describe('ParetoFrontier', () => {
  it('keeps a non-dominated candidate', () => {
    const frontier = new ParetoFrontier<string>()
    frontier.insert([5], 'a')

    expect(frontier.toArray()).toEqual(['a'])
  })

  it('drops a candidate dominated by an existing entry', () => {
    const frontier = new ParetoFrontier<string>()
    frontier.insert([5], 'strong')
    frontier.insert([2], 'weak')

    expect(frontier.toArray()).toEqual(['strong'])
  })

  it('removes an existing entry a new candidate dominates, regardless of insertion order', () => {
    const frontier = new ParetoFrontier<string>()
    frontier.insert([2], 'weak')
    frontier.insert([5], 'strong')

    expect(frontier.toArray()).toEqual(['strong'])
  })

  it('keeps both entries when neither dominates the other', () => {
    const frontier = new ParetoFrontier<string>()
    frontier.insert([5, 0], 'attack')
    frontier.insert([0, 5], 'defense')

    expect(frontier.toArray().sort()).toEqual(['attack', 'defense'])
  })

  it('groups exact ties under the same vector instead of treating them as separate entries', () => {
    const frontier = new ParetoFrontier<string>()
    frontier.insert([5], 'plain')
    frontier.insert([5], 'fancy') // ties with 'plain' -- neither dominates the other

    expect(frontier.entries()).toHaveLength(1)
    expect(frontier.entries()[0].vector).toEqual([5])
    expect(frontier.toArray().sort()).toEqual(['fancy', 'plain'])
  })

  it('drops an entire tied group when a later candidate dominates it', () => {
    const frontier = new ParetoFrontier<string>()
    frontier.insert([2], 'weak-a')
    frontier.insert([2], 'weak-b') // ties with weak-a
    frontier.insert([5], 'strong') // dominates both weak-a and weak-b

    expect(frontier.toArray()).toEqual(['strong'])
  })

  it('stays fast when many entries tie on the exact same vector', () => {
    // Mirrors the real bug: a group of distinct origins all reaching the
    // identical vector, combinatorially inflated by a capacity limit. A
    // linear-scan frontier re-scans everything already kept on every one of
    // these -- here, that would be ~50,000 re-scans of an ever-growing
    // array. Grouping makes each one an O(1) append instead -- and
    // `MAX_TIED_ORIGINS` (see its own docstring) keeps the group itself from
    // growing unboundedly once capping (see `cappedVector`) makes huge tied
    // groups commonplace at real-dataset scale.
    const frontier = new ParetoFrontier<number>()
    const start = performance.now()
    for (let i = 0; i < 50_000; i++) {
      frontier.insert([5], i)
    }
    const elapsedMs = performance.now() - start

    expect(frontier.entries()).toHaveLength(1)
    expect(frontier.toArray()).toHaveLength(MAX_TIED_ORIGINS)
    expect(elapsedMs).toBeLessThan(500)
  })

  it('keeps only the first MAX_TIED_ORIGINS alternatives once a tied group grows past it, with no tie-break score given', () => {
    const frontier = new ParetoFrontier<string>()
    frontier.insert([5], 'a')
    frontier.insert([5], 'b')
    frontier.insert([5], 'c')
    frontier.insert([5], 'd')
    frontier.insert([5], 'e')
    frontier.insert([5], 'f') // past the cap -- dropped, not appended

    expect(frontier.toArray()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('replaces the worst-scoring alternative once a full tied group sees a better one', () => {
    // Confirmed real-world need: the decoration-filling DP groups fillings by
    // requested skill alone (a documented performance trade-off -- see
    // expand.ts's `computeDecorationFillingFrontier` docstring), so once a
    // popular skill has many relevant decorations, far more than
    // MAX_TIED_ORIGINS distinct fillings can tie on the same requested-skill
    // vector. Picking the first 5 *found* (arbitrary, insertion-order
    // dependent) systematically favored fillings that happened to be built
    // from several decorations stacked together over a single decoration
    // that reached the same vector alone -- exactly backwards from "leave as
    // many slots open as possible." A tie-break score lets the better
    // alternative win the slot instead of whichever arrived first.
    const frontier = new ParetoFrontier<number>((n) => n) // higher score wins
    frontier.insert([5], 1)
    frontier.insert([5], 2)
    frontier.insert([5], 3)
    frontier.insert([5], 4)
    frontier.insert([5], 5)
    frontier.insert([5], 100) // scores higher than the worst-kept (1) -- replaces it

    expect(frontier.toArray().sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 100])
  })

  it('keeps the existing alternatives when a new one scores no better than the worst kept', () => {
    const frontier = new ParetoFrontier<number>((n) => n)
    frontier.insert([5], 5)
    frontier.insert([5], 4)
    frontier.insert([5], 3)
    frontier.insert([5], 2)
    frontier.insert([5], 1)
    frontier.insert([5], 0) // scores worse than everything kept -- dropped

    expect(frontier.toArray().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  it('stays fast with many distinct, mostly-dominated candidates', () => {
    const frontier = new ParetoFrontier<number>()
    const start = performance.now()
    for (let i = 0; i < 50_000; i++) {
      frontier.insert([i], i) // each strictly dominates every earlier one
    }
    const elapsedMs = performance.now() - start

    expect(frontier.toArray()).toEqual([49_999])
    expect(elapsedMs).toBeLessThan(500)
  })
})

describe('cappedVector', () => {
  const requirements: SkillRequirement[] = [
    { skillId: 1, minPoints: 15 },
    { skillId: 2, minPoints: 10 },
  ]

  it('passes a value through unchanged when it has not reached its requirement', () => {
    expect(cappedVector([5, 3], requirements)).toEqual([5, 3])
  })

  it('caps a value at its own requirement once it meets or exceeds it', () => {
    expect(cappedVector([15, 10], requirements)).toEqual([15, 10])
    expect(cappedVector([1146, 50], requirements)).toEqual([15, 10])
  })

  it('caps each dimension independently', () => {
    expect(cappedVector([1146, 3], requirements)).toEqual([15, 3])
  })

  it('composes correctly across repeated additions (re-capping a running total)', () => {
    // Two partial contributions of 10 each (neither alone over the 15 cap)
    // must still cap their *sum* to 15, matching capping the true raw total
    // once -- not 10 + 10 = 20 escaping the cap.
    const left = cappedVector([10], [{ skillId: 1, minPoints: 15 }])
    const right = cappedVector([10], [{ skillId: 1, minPoints: 15 }])
    const combined = cappedVector([left[0] + right[0]], [{ skillId: 1, minPoints: 15 }])

    expect(combined).toEqual([15])
  })

  it('passes dimensions beyond the requirements through unchanged, uncapped', () => {
    // Every vector this engine builds has two scoring dimensions appended
    // after one per requirement -- open decoration slots remaining and total
    // bonus skill points (see pareto.ts's and expand.ts's vector-building
    // functions). Neither has a "requirement" to cap against -- more is
    // always better, unboundedly -- so `cappedVector` must leave anything
    // past `requirements.length` alone rather than trying to index a
    // requirement that doesn't exist for it.
    expect(cappedVector([1146, 3, 7], requirements)).toEqual([15, 3, 7])
  })
})
