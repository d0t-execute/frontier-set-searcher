import { describe, expect, it } from 'vitest'
import { search } from './engine'
import { collect } from './test-helpers'
import type { ActiveSkillCapRules, Candidate, Cuff, Decoration, SlotQuery } from './types'

function candidate(id: string, skills: Record<number, number>, openSlotCount = 0): Candidate {
  return {
    id,
    skills: Object.entries(skills).map(([skillId, points]) => ({
      skillId: Number(skillId),
      points,
    })),
    openSlotCount,
  }
}

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

// A Cuff is shaped identically to a Decoration (see types.ts) -- reused
// under its own name here for readability at cuff-specific call sites.
const cuff: (id: string, slotSize: number, skills: Record<number, number>) => Cuff = deco

describe('search', () => {
  it('returns a single-slot candidate that satisfies the requirement alone', async () => {
    const slots: SlotQuery[] = [
      { slotId: 'head', candidates: [candidate('Leather Helm', { 1: 5 })] },
    ]

    const results = await collect(search(slots, [{ skillId: 1, minPoints: 3 }]))

    expect(results).toHaveLength(1)
    expect(results[0].picks.get('head')?.id).toBe('Leather Helm')
    expect(results[0].skillTotals.get(1)).toBe(5)
  })

  it('returns nothing when no candidate meets the requirement', async () => {
    const slots: SlotQuery[] = [
      { slotId: 'head', candidates: [candidate('Leather Helm', { 1: 1 })] },
    ]

    const results = await collect(search(slots, [{ skillId: 1, minPoints: 3 }]))

    expect(results).toEqual([])
  })

  it('combines candidates across multiple slots to meet the requirement', async () => {
    const slots: SlotQuery[] = [
      { slotId: 'head', candidates: [candidate('Helm', { 1: 2 })] },
      { slotId: 'chest', candidates: [candidate('Mail', { 1: 2 })] },
    ]

    const results = await collect(search(slots, [{ skillId: 1, minPoints: 3 }]))

    expect(results).toHaveLength(1)
    expect(results[0].skillTotals.get(1)).toBe(4)
  })

  it('requires exactly one candidate per slot in the query', async () => {
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Helm A', { 1: 5 }), candidate('Helm B', { 1: 1 })],
      },
    ]

    const results = await collect(search(slots, [{ skillId: 1, minPoints: 3 }]))

    expect(results).toHaveLength(1)
    expect(results[0].picks.get('head')?.id).toBe('Helm A')
  })

  it('satisfies multiple simultaneous skill requirements', async () => {
    const slots: SlotQuery[] = [
      { slotId: 'head', candidates: [candidate('Helm', { 1: 5, 2: 1 })] },
      { slotId: 'chest', candidates: [candidate('Mail', { 2: 4 })] },
    ]

    const results = await collect(
      search(slots, [
        { skillId: 1, minPoints: 3 },
        { skillId: 2, minPoints: 5 },
      ]),
    )

    expect(results).toHaveLength(1)
    expect(results[0].skillTotals.get(1)).toBe(5)
    expect(results[0].skillTotals.get(2)).toBe(5)
  })

  it("omits a requirement's skill from totals only when truly absent, otherwise reports 0 contribution", async () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 5 })] }]

    const results = await collect(search(slots, [{ skillId: 1, minPoints: 3 }]))

    expect(results[0].skillTotals.get(99)).toBeUndefined()
  })

  it('excludes a candidate that never reaches the requirement on its own', async () => {
    // Small Helm's single-skill contribution (3) never reaches a requirement
    // of 5 -- it's excluded as infeasible. (Once two candidates *both* meet
    // the same requirement, they tie rather than one dominating -- see
    // "treats two candidates that both meet a requirement as tied" below.)
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Big Helm', { 1: 10 }), candidate('Small Helm', { 1: 3 })],
      },
    ]

    const results = await collect(search(slots, [{ skillId: 1, minPoints: 5 }]))

    expect(results.map((r) => r.picks.get('head')?.id)).toEqual(['Big Helm'])
  })

  it('treats two candidates that both meet a requirement as tied, not one dominating', async () => {
    // Confirmed project direction: once a requirement is met, more points in
    // it don't make a build better. Without this, Big Helm's 10 points would
    // always outrank Small Helm's 5, even though both equally satisfy a
    // requirement of 5.
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Big Helm', { 1: 10 }), candidate('Small Helm', { 1: 5 })],
      },
    ]

    const results = await collect(search(slots, [{ skillId: 1, minPoints: 5 }]))

    expect(results.map((r) => r.picks.get('head')?.id).sort()).toEqual(['Big Helm', 'Small Helm'])
  })

  it('returns one result when the query has no slots and there are no requirements', async () => {
    const results = await collect(search([], []))

    expect(results).toHaveLength(1)
    expect(results[0].picks.size).toBe(0)
  })

  it('finds every non-dominated valid combination, not just the first', async () => {
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Helm A', { 1: 5, 2: 0 }), candidate('Helm B', { 1: 0, 2: 5 })],
      },
    ]
    const requirements = [
      { skillId: 1, minPoints: 0 },
      { skillId: 2, minPoints: 0 },
    ]

    const results = await collect(search(slots, requirements))

    expect(results.map((r) => r.picks.get('head')?.id).sort()).toEqual(['Helm A', 'Helm B'])
  })

  it('ranks the build that avoids activating a bonus skill tier first when preferExactMatches is set', async () => {
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Plain', { 1: 5 }), candidate('Bonus', { 1: 5, 2: 100 })],
      },
    ]

    const results = await collect(
      search(slots, [{ skillId: 1, minPoints: 3 }], [], {
        preferExactMatches: true,
        skillTiers: [{ skillId: 2, tierThresholds: [10] }],
      }),
    )

    expect(results[0].picks.get('head')?.id).toBe('Plain')
  })

  it('under preferExactMatches, returns every clean build before any build with a bonus tier active, then the rest', async () => {
    // "Roomy" has the most open slots but activates skill 2, so both clean
    // helms come first despite fewer slots; "Roomy" still follows rather than
    // being dropped, ranked ahead of the even worse "Noisy" by its slots.
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [
          candidate('Roomy', { 1: 5, 2: 20 }, 3),
          candidate('Clean A', { 1: 5 }, 1),
          candidate('Noisy', { 1: 5, 2: 20 }, 0),
          candidate('Clean B', { 1: 5 }, 0),
        ],
      },
    ]

    const results = await collect(
      search(slots, [{ skillId: 1, minPoints: 3 }], [], {
        preferExactMatches: true,
        skillTiers: [{ skillId: 2, tierThresholds: [10] }],
      }),
    )

    expect(results.map((r) => r.picks.get('head')?.id)).toEqual([
      'Clean A',
      'Clean B',
      'Roomy',
      'Noisy',
    ])
  })

  it('never returns a gear set listed in excludedGearSets', async () => {
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [
          candidate('A', { 1: 5 }, 3),
          candidate('B', { 1: 5 }, 2),
          candidate('C', { 1: 5 }),
        ],
      },
    ]
    const results = await collect(
      search(slots, [{ skillId: 1, minPoints: 3 }], [], {
        excludedGearSets: [{ candidateIdBySlot: new Map([['head', 'A']]), cuffIds: [] }],
      }),
    )

    expect(results.map((r) => r.picks.get('head')?.id)).toEqual(['B', 'C'])
  })

  it("matches an excluded gear set's cuffs after setting pinned cuffs aside", async () => {
    // Results list the pinned cuff alongside free ones, but it isn't a model
    // column -- excluding "Helm + pinned" must remove only the build with no
    // free cuff, leaving "Helm + pinned + Spare".
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 5 })] }]
    const pinned = cuff('Pinned', 1, { 2: 1 })
    const spare = cuff('Spare', 1, { 1: 1 })
    const results = await collect(
      search(
        slots,
        [{ skillId: 1, minPoints: 3 }],
        [],
        {
          pinnedCuffs: [pinned],
          excludedGearSets: [
            { candidateIdBySlot: new Map([['head', 'Helm']]), cuffIds: ['Pinned'] },
          ],
        },
        [spare],
      ),
    )

    expect(results.map((r) => r.cuffs.map((c) => c.id))).toEqual([['Pinned', 'Spare']])
  })

  it('ignores an excluded gear set this model could never produce, rather than over-excluding', async () => {
    // "Gone" isn't a candidate here, so no cut is added -- a partial cut on
    // the chest alone would wrongly forbid every build using "Mail".
    const slots: SlotQuery[] = [
      { slotId: 'head', candidates: [candidate('Helm', { 1: 5 })] },
      { slotId: 'chest', candidates: [candidate('Mail', {})] },
    ]
    const results = await collect(
      search(slots, [{ skillId: 1, minPoints: 3 }], [], {
        excludedGearSets: [
          {
            candidateIdBySlot: new Map([
              ['head', 'Gone'],
              ['chest', 'Mail'],
            ]),
            cuffIds: [],
          },
        ],
      }),
    )

    expect(results).toHaveLength(1)
  })

  it('can be consumed lazily, stopping before the full result set is computed', async () => {
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Helm A', { 1: 3 }), candidate('Helm B', { 1: 4 })],
      },
    ]

    const generator = search(slots, [{ skillId: 1, minPoints: 3 }])
    const first = await generator.next()

    // Helm A and Helm B both meet the requirement, so they tie (see "treats
    // two candidates that both meet a requirement as tied") -- there's no
    // guaranteed winner to assert on, only that a result streams out lazily,
    // before the generator is fully drained.
    if (first.done) throw new Error('expected a result, not the generator to finish')
    expect(['Helm A', 'Helm B']).toContain(first.value.picks.get('head')?.id)
  })
})

describe('search with decorations', () => {
  it('uses a decoration placed in an open slot to meet the requirement', async () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Bare Helm', {}, 2)] }]
    const jewel = deco('Attack Jewel', 2, { 1: 5 })

    const results = await collect(search(slots, [{ skillId: 1, minPoints: 3 }], [jewel]))

    expect(results).toHaveLength(1)
    expect(results[0].skillTotals.get(1)).toBe(5)
    expect(results[0].decorations.get('head')).toEqual([jewel])
  })

  it('still returns the undecorated result when no decoration is needed or supplied', async () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 5 }, 2)] }]

    const resultsWithoutDecorations = await collect(search(slots, [{ skillId: 1, minPoints: 3 }]))
    expect(resultsWithoutDecorations).toHaveLength(1)
    expect(resultsWithoutDecorations[0].decorations.get('head')).toBeUndefined()

    const resultsWithIrrelevantDecoration = await collect(
      search(slots, [{ skillId: 1, minPoints: 3 }], [deco('Irrelevant Jewel', 2, { 99: 1 })]),
    )
    // A decoration that contributes to none of the requested skills can
    // never change whether a requirement is met or how results rank, so it
    // isn't expanded into a separate result variant -- only the undecorated
    // build is returned, same as if the decoration didn't exist. This is a
    // deliberate performance tradeoff (see engine.ts's module docstring):
    // without it, every candidate gets expanded against the *entire*
    // decoration catalog regardless of relevance, which is combinatorially
    // enormous at real-dataset scale.
    expect(resultsWithIrrelevantDecoration).toHaveLength(1)
    expect(resultsWithIrrelevantDecoration[0].decorations.get('head')).toBeUndefined()
  })

  it('excludes a decoration choice that never reaches the requirement on its own', async () => {
    // Small Jewel's contribution (1) never reaches a requirement of 5 --
    // same infeasibility rule as for candidates.
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Bare Helm', {}, 2)] }]
    const bigJewel = deco('Big Jewel', 2, { 1: 5 })
    const smallJewel = deco('Small Jewel', 2, { 1: 1 })

    const results = await collect(
      search(slots, [{ skillId: 1, minPoints: 5 }], [bigJewel, smallJewel]),
    )

    const decorated = results.filter((r) => (r.decorations.get('head')?.length ?? 0) > 0)
    expect(decorated.map((r) => r.decorations.get('head')?.[0].id)).toEqual(['Big Jewel'])
  })

  it('returns one result per gear set, even when tied decoration choices exist for it', async () => {
    // Attack Jewel and Defense Jewel both meet the requirements on the same
    // helm and tie in rank. Results are distinct by gear set (see
    // ilp-model.ts's module docstring), so the helm comes back once, with
    // either jewel, rather than once per jewel.
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Bare Helm', {}, 2)] }]
    const attackJewel = deco('Attack Jewel', 2, { 1: 5, 2: 1 })
    const defenseJewel = deco('Defense Jewel', 2, { 1: 1, 2: 1 })

    const requirements = [
      { skillId: 1, minPoints: 1 },
      { skillId: 2, minPoints: 1 },
    ]
    const results = await collect(search(slots, requirements, [attackJewel, defenseJewel]))

    expect(results).toHaveLength(1)
    expect(['Attack Jewel', 'Defense Jewel']).toContain(results[0].decorations.get('head')?.[0].id)
  })
})

describe('search with cuffs', () => {
  it('equips a cuff to help meet a requirement armor alone cannot reach', async () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 3 })] }]
    // slotSize 2 (the full Poogie-slot budget) so a second copy can't also fit -- keeps this
    // test's expected result unambiguous (see the cuff-budget test below for the 2-cuff case).
    const sharpening = cuff('Sharpening PC1', 2, { 2: 10 })

    const results = await collect(
      search(
        slots,
        [
          { skillId: 1, minPoints: 3 },
          { skillId: 2, minPoints: 10 },
        ],
        [],
        {},
        [sharpening],
      ),
    )

    expect(results).toHaveLength(1)
    expect(results[0].cuffs).toEqual([sharpening])
    expect(results[0].skillTotals.get(2)).toBe(10)
  })

  it('never equips a cuff nobody asked for, same as decorations', async () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 3 })] }]
    const irrelevant = cuff('Gathering PB1', 1, { 99: 5 })

    const results = await collect(
      search(slots, [{ skillId: 1, minPoints: 3 }], [], {}, [irrelevant]),
    )

    expect(results).toHaveLength(1)
    expect(results[0].cuffs).toEqual([])
  })

  it('rejects two cuffs whose combined slot cost exceeds the shared Poogie-slot budget', async () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 3 })] }]
    // Each costs the full budget (2) on its own.
    const cuffA = cuff('Skill Slots Up SZ', 2, { 2: 5 })
    const cuffB = cuff('Guard Up SZ', 2, { 3: 5 })

    const results = await collect(
      search(
        slots,
        [
          { skillId: 1, minPoints: 3 },
          { skillId: 2, minPoints: 5 },
          { skillId: 3, minPoints: 5 },
        ],
        [],
        {},
        [cuffA, cuffB],
      ),
    )

    expect(results).toHaveLength(0)
  })

  it('includes a pinned cuff in every result and credits its skills, leaving the free pool untouched', async () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 3 })] }]
    const pinned = cuff('Sharpening PC1', 1, { 2: 10 })

    const results = await collect(
      search(
        slots,
        [
          { skillId: 1, minPoints: 3 },
          { skillId: 2, minPoints: 10 },
        ],
        [],
        { pinnedCuffs: [pinned] },
      ),
    )

    expect(results).toHaveLength(1)
    expect(results[0].cuffs).toEqual([pinned])
    expect(results[0].skillTotals.get(2)).toBe(10)
  })

  it('lets a pinned cuff and a solver-chosen cuff coexist within the shared budget', async () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 3 })] }]
    const pinned = cuff('Skill Slots Up SZ', 2, { 2: 5 })
    const free = cuff('SnS - Basic', 0, { 3: 5 })

    const results = await collect(
      search(
        slots,
        [
          { skillId: 1, minPoints: 3 },
          { skillId: 2, minPoints: 5 },
          { skillId: 3, minPoints: 5 },
        ],
        [],
        { pinnedCuffs: [pinned] },
        [free],
      ),
    )

    expect(results).toHaveLength(1)
    expect(results[0].cuffs).toEqual([pinned, free])
  })

  it('rejects a free cuff that would exceed the budget a pin already spent', async () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 3 })] }]
    const pinned = cuff('Skill Slots Up SZ', 2, { 2: 5 })
    const free = cuff('Guard Up SZ', 2, { 3: 5 })

    const results = await collect(
      search(
        slots,
        [
          { skillId: 1, minPoints: 3 },
          { skillId: 2, minPoints: 5 },
          { skillId: 3, minPoints: 5 },
        ],
        [],
        { pinnedCuffs: [pinned] },
        [free],
      ),
    )

    expect(results).toHaveLength(0)
  })
})

describe('search with options.pinnedSlotDecorations', () => {
  it('forces the pinned decoration into the result even though it contributes to no requested skill', async () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 5 }, 2)] }]
    // Only skill 1 is requested -- skill 2 is what the pinned decoration
    // actually contributes, which `filterRelevantDecorations` would
    // otherwise drop as irrelevant.
    const pinnedDeco = deco('Irrelevant-to-requirement Deco', 1, { 2: 3 })

    const results = await collect(
      search(slots, [{ skillId: 1, minPoints: 5 }], [], {
        pinnedSlotDecorations: new Map([['head', [pinnedDeco]]]),
      }),
    )

    expect(results).toHaveLength(1)
    expect(results[0].decorations.get('head')?.map((d) => d.id)).toEqual([
      'Irrelevant-to-requirement Deco',
    ])
    expect(results[0].skillTotals.get(2)).toBe(3)
  })

  it('leaves the candidate choice to the solver', async () => {
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Weak Helm', { 1: 1 }, 2), candidate('Strong Helm', { 1: 5 }, 2)],
      },
    ]
    const pinnedDeco = deco('Attack Deco', 1, { 1: 3 })

    const results = await collect(
      search(slots, [{ skillId: 1, minPoints: 8 }], [], {
        pinnedSlotDecorations: new Map([['head', [pinnedDeco]]]),
      }),
    )

    expect(results).toHaveLength(1)
    expect(results[0].picks.get('head')?.id).toBe('Strong Helm')
    expect(results[0].decorations.get('head')?.map((d) => d.id)).toEqual(['Attack Deco'])
  })
})

describe("search's own generator return value (SearchEndReason)", () => {
  // See docs/feedback.md Round 3 #4: `App.tsx`'s "search longer" retry only
  // makes sense when a round gave up for lack of time, never when HiGHS
  // proved no build exists -- these two cases must stay distinguishable.
  it('reports "exhausted" for the trivial empty-slots case', async () => {
    const generator = search([], [{ skillId: 1, minPoints: 3 }])
    const final = await generator.next()
    expect(final).toEqual({ done: true, value: 'exhausted' })
  })

  it('reports "exhausted" once every real combination has been proven infeasible', async () => {
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', { 1: 1 })] }]
    const generator = search(slots, [{ skillId: 1, minPoints: 99 }])
    const final = await generator.next()
    expect(final).toEqual({ done: true, value: 'exhausted' })
  })

  // A real timed-out round can't be forced deterministically from a tiny
  // synthetic model (HiGHS solves these far too fast to ever hit the time
  // box) -- that direction is instead demonstrated against a real, known-hard
  // query in engine.real-data.performance.test.ts.
})

describe('search with the active-skill cap', () => {
  const SKILL_SLOTS_UP = 100
  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i)

  /** Every id in `ids` is a normal skill activating at 10 points, ranked in
   * id order (1 = most protected); `hiden` ids are Hiden/Tech skills. */
  function capRules(ids: readonly number[], hiden: readonly number[] = []): ActiveSkillCapRules {
    return {
      skills: ids.map((skillId) => ({
        skillId,
        priorityRank: skillId,
        tierThresholds: [10],
        hiden: hiden.includes(skillId),
      })),
      skillSlotsUpId: SKILL_SLOTS_UP,
    }
  }

  function tens(
    ids: readonly number[],
    extra: Record<number, number> = {},
  ): Record<number, number> {
    return { ...Object.fromEntries(ids.map((id) => [id, 10])), ...extra }
  }

  const required = (ids: readonly number[]) => ids.map((skillId) => ({ skillId, minPoints: 10 }))

  it('rejects a better-ranked build that lacks the Skill Slots Up its requirements need', async () => {
    // The reported case: 13 requirements need a cap of 13, i.e. 3 Skill Slots
    // Up. The open slot would otherwise rank the helm without it first.
    const skills = range(1, 13)
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [
          candidate('Slotted Helm', tens(skills), 1),
          candidate('Zenith Helm', tens(skills, { [SKILL_SLOTS_UP]: 3 })),
        ],
      },
    ]

    const uncapped = await collect(search(slots, required(skills)))
    expect(uncapped.map((r) => r.picks.get('head')?.id)).toEqual(['Slotted Helm', 'Zenith Helm'])

    const capped = await collect(
      search(slots, required(skills), [], { activeSkillCap: capRules(skills) }),
    )
    expect(capped.map((r) => r.picks.get('head')?.id)).toEqual(['Zenith Helm'])
  })

  it('finds Skill Slots Up on a cuff nobody asked for', async () => {
    const skills = range(1, 11)
    const slots: SlotQuery[] = [{ slotId: 'head', candidates: [candidate('Helm', tens(skills))] }]
    const cuffs = [cuff('Slots Cuff', 1, { [SKILL_SLOTS_UP]: 1 }), cuff('Other Cuff', 1, { 50: 1 })]

    const results = await collect(
      search(slots, required(skills), [], { activeSkillCap: capRules(skills) }, cuffs),
    )

    expect(results.length).toBeGreaterThan(0)
    for (const result of results) {
      expect(result.cuffs.map((c) => c.id)).toContain('Slots Cuff')
    }
  })

  it('counts G-Rank-or-later pieces toward the cap', async () => {
    const skills = range(1, 11)
    const gRank = (id: string, skillPoints: Record<number, number>): Candidate => ({
      ...candidate(id, skillPoints),
      grankOrLater: true,
    })
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [candidate('Low Helm', tens(skills), 1), gRank('G Helm', tens(skills))],
      },
      { slotId: 'chest', candidates: [candidate('Low Mail', {}, 1), gRank('G Mail', {})] },
      { slotId: 'arms', candidates: [candidate('Low Arms', {}, 1), gRank('G Arms', {})] },
    ]

    const results = await collect(
      search(slots, required(skills), [], { activeSkillCap: capRules(skills) }),
    )

    expect(results).toHaveLength(1)
    expect([...results[0].picks.values()].map((c) => c.id)).toEqual(['G Helm', 'G Mail', 'G Arms'])
  })

  it('rejects a build where a higher-priority bonus skill crowds out a requirement', async () => {
    // 10 requirements fit the base cap on their own, but an unrequested skill
    // ranked above all of them takes a slot, disabling requirement 10.
    const skills = range(2, 11)
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [
          candidate('Crowded Helm', tens(skills, { 1: 10 })),
          candidate('Plain Helm', tens(skills)),
        ],
      },
    ]

    const results = await collect(
      search(slots, required(skills), [], { activeSkillCap: capRules(range(1, 11)) }),
    )

    expect(results.map((r) => r.picks.get('head')?.id)).toEqual(['Plain Helm'])
  })

  it('lets a cuff-sourced Hiden requirement past the cap', async () => {
    const skills = range(1, 11)
    const slots: SlotQuery[] = [
      { slotId: 'head', candidates: [candidate('Helm', tens(range(1, 10)))] },
    ]
    const cuffs = [cuff('Tech Cuff', 0, { 11: 10 })]

    const hiden = await collect(
      search(slots, required(skills), [], { activeSkillCap: capRules(skills, [11]) }, cuffs),
    )
    expect(hiden.length).toBeGreaterThan(0)

    const notHiden = await collect(
      search(slots, required(skills), [], { activeSkillCap: capRules(skills) }, cuffs),
    )
    expect(notHiden).toEqual([])
  })

  it("lets an Exotic piece's granted requirement past the cap", async () => {
    const skills = range(1, 11)
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [
          candidate('Plain Helm', tens(skills), 1),
          { ...candidate('Exotic Helm', tens(skills)), exoticSkillId: 11 },
        ],
      },
    ]

    const results = await collect(
      search(slots, required(skills), [], { activeSkillCap: capRules(skills) }),
    )

    expect(results.map((r) => r.picks.get('head')?.id)).toEqual(['Exotic Helm'])
  })
})

describe('candidate pruning with the active-skill cap', () => {
  it('keeps the pieces that raise the cap when pruning to the top result', async () => {
    const skills = Array.from({ length: 11 }, (_, i) => i + 1)
    const tens = Object.fromEntries(skills.map((id) => [id, 10]))
    const rules: ActiveSkillCapRules = {
      skills: skills.map((skillId) => ({
        skillId,
        priorityRank: skillId,
        tierThresholds: [10],
        hiden: false,
      })),
      skillSlotsUpId: 100,
    }
    const slots: SlotQuery[] = [
      {
        slotId: 'head',
        candidates: [
          candidate('Slotted Helm', tens, 1),
          candidate('Zenith Helm', { ...tens, 100: 1 }),
        ],
      },
      {
        slotId: 'chest',
        candidates: [
          candidate('Low Mail', {}, 1),
          { ...candidate('G Mail', {}), grankOrLater: true },
        ],
      },
    ]

    const results = await collect(
      search(
        slots,
        skills.map((skillId) => ({ skillId, minPoints: 10 })),
        [],
        { activeSkillCap: rules, maxResults: 1 },
      ),
    )

    expect(results).toHaveLength(1)
    expect(results[0].picks.get('head')?.id).toBe('Zenith Helm')
    expect(results[0].picks.get('chest')?.id).toBe('Low Mail')
  })
})

describe('lexicographic solve', () => {
  // Open slots outrank bonus points, so the slotted helm comes first even
  // though the plain one carries far more bonus points; the ranking has to
  // come out the same whichever way the round finds its best primary value.
  const slots: SlotQuery[] = [
    {
      slotId: 'head',
      candidates: [
        candidate('Bonus Helm', { 1: 5, 2: 40 }),
        candidate('Slotted Helm', { 1: 5 }, 1),
        candidate('Middle Helm', { 1: 5, 2: 10 }),
      ],
    },
  ]
  const requirements = [{ skillId: 1, minPoints: 5 }]
  const expected = ['Slotted Helm', 'Bonus Helm', 'Middle Helm']

  it('ranks primary value first, then bonus points', async () => {
    const results = await collect(search(slots, requirements))
    expect(results.map((r) => r.picks.get('head')?.id)).toEqual(expected)
  })

  it('recomputes the best value when the given bound is out of reach', async () => {
    const results = await collect(
      search(slots, requirements, [], { primaryObjectiveBound: 1_000_000 }),
    )
    expect(results.map((r) => r.picks.get('head')?.id)).toEqual(expected)
  })
})
