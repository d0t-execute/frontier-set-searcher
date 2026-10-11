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
import { dominates, ParetoFrontier } from './dominance'

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
    // array. Grouping makes each one an O(1) append instead.
    const frontier = new ParetoFrontier<number>()
    const start = performance.now()
    for (let i = 0; i < 50_000; i++) {
      frontier.insert([5], i)
    }
    const elapsedMs = performance.now() - start

    expect(frontier.entries()).toHaveLength(1)
    expect(frontier.toArray()).toHaveLength(50_000)
    expect(elapsedMs).toBeLessThan(500)
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
