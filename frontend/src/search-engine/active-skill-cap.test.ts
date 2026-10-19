import { describe, expect, it } from 'vitest'
import {
  computeActiveSkillCap,
  countGrankOrLaterPieces,
  determineActiveSkills,
  previewActiveSkillCap,
} from './active-skill-cap'
import type { NamedCandidate, NamedCuff, NamedSkill, NamedSlotQuery } from './load-bundle'

function candidate(
  category: string,
  grankOrLater = false,
  exoticSkillId: number | null = null,
): NamedCandidate {
  return {
    id: `c:${category}`,
    name: category,
    category,
    grankOrLater,
    hunterType: 'common',
    exoticSkillId,
    defenseMax: null,
    resistances: { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 },
    skills: [],
  }
}

function cuff(id: string, skillId: number, points: number): NamedCuff {
  return {
    id,
    name: id,
    slotSize: 1,
    category: 'cuff_standard_plain',
    skills: [{ skillId, points }],
  }
}

function skill(id: number, overrides: Partial<Omit<NamedSkill, 'id'>> = {}): NamedSkill {
  return { id, name: `Skill ${id}`, category: null, priorityRank: null, tiers: [], ...overrides }
}

const SKILL_SLOTS_UP_ID = 1000001
const ZENITH_SKILLS: readonly NamedSkill[] = [skill(SKILL_SLOTS_UP_ID, { name: 'Skill Slots Up' })]

describe('countGrankOrLaterPieces', () => {
  it('counts only candidates flagged grankOrLater', () => {
    const picks = new Map([
      ['head', candidate('grank_g', true)],
      ['chest', candidate('zenith_zy', true)],
      ['arms', candidate('standard_plain', false)],
    ])

    expect(countGrankOrLaterPieces(picks)).toBe(2)
  })

  it("doesn't trust category alone -- a mixed-tier category's pieces are judged individually", () => {
    // paid_gachapon mixes below-G-rank and G-Rank-or-later pieces together --
    // see NamedCandidate.grankOrLater's own docstring. The flag, not the
    // category string, is what this function reads.
    const picks = new Map([
      ['head', candidate('paid_gachapon', true)],
      ['chest', candidate('paid_gachapon', false)],
    ])

    expect(countGrankOrLaterPieces(picks)).toBe(1)
  })

  it('excludes Origin pieces even though they are flagged grankOrLater', () => {
    // docs/feedback.md Round 2 #5: Origin is G-Rank, but doesn't carry the
    // inherent bonus-skill-cap capability other G-Rank-or-later gear does.
    const picks = new Map([
      ['head', candidate('grank_origin', true)],
      ['chest', candidate('grank_origin', true)],
      ['arms', candidate('grank_origin', true)],
      ['waist', candidate('grank_g', true)],
      ['legs', candidate('grank_g', true)],
    ])

    expect(countGrankOrLaterPieces(picks)).toBe(2)
  })
})

describe('computeActiveSkillCap', () => {
  it('is 10 with no G-Rank pieces and no Skill Slots Up', () => {
    const picks = new Map([['head', candidate('standard_plain')]])

    expect(computeActiveSkillCap(picks, new Map(), ZENITH_SKILLS)).toBe(10)
  })

  it('adds +1 for 3-4 G-Rank-or-later pieces', () => {
    const picks = new Map([
      ['head', candidate('grank_g', true)],
      ['chest', candidate('grank_g', true)],
      ['arms', candidate('grank_g', true)],
    ])

    expect(computeActiveSkillCap(picks, new Map(), ZENITH_SKILLS)).toBe(11)
  })

  it('adds +2 for 5+ G-Rank-or-later pieces', () => {
    const picks = new Map(
      Array.from({ length: 5 }, (_, i) => [`slot${i}`, candidate('grank_g', true)] as const),
    )

    expect(computeActiveSkillCap(picks, new Map(), ZENITH_SKILLS)).toBe(12)
  })

  it('adds the Skill Slots Up level, capped at +7', () => {
    const picks = new Map([['head', candidate('standard_plain')]])

    expect(computeActiveSkillCap(picks, new Map([[SKILL_SLOTS_UP_ID, 4]]), ZENITH_SKILLS)).toBe(14)
    expect(computeActiveSkillCap(picks, new Map([[SKILL_SLOTS_UP_ID, 19]]), ZENITH_SKILLS)).toBe(17)
  })

  it('combines the G-Rank bonus and the Skill Slots Up bonus', () => {
    const picks = new Map(
      Array.from({ length: 5 }, (_, i) => [`slot${i}`, candidate('grank_g', true)] as const),
    )

    expect(computeActiveSkillCap(picks, new Map([[SKILL_SLOTS_UP_ID, 7]]), ZENITH_SKILLS)).toBe(19)
  })
})

describe('determineActiveSkills', () => {
  const picks = new Map([['head', candidate('standard_plain')]])

  it('treats an untiered skill as active once its points are positive', () => {
    const skills = [skill(1)]
    const result = determineActiveSkills(picks, new Map([[1, 3]]), skills, ZENITH_SKILLS)

    expect(result.rankedActive).toEqual([1])
    expect(result.disabled).toEqual([])
  })

  it('only treats a tiered skill as active once a tier threshold is reached', () => {
    const skills = [skill(1, { tiers: [{ label: 'T1', minPoints: 10, description: null }] })]

    const below = determineActiveSkills(picks, new Map([[1, 5]]), skills, ZENITH_SKILLS)
    expect(below.rankedActive).toEqual([])

    const atThreshold = determineActiveSkills(picks, new Map([[1, 10]]), skills, ZENITH_SKILLS)
    expect(atThreshold.rankedActive).toEqual([1])
  })

  it('activates a negative (penalty) tier once points drop to its threshold', () => {
    const skills = [skill(1, { tiers: [{ label: 'T-10', minPoints: -10, description: null }] })]

    const result = determineActiveSkills(picks, new Map([[1, -10]]), skills, ZENITH_SKILLS)
    expect(result.rankedActive).toEqual([1])
  })

  it('ignores Zenith skill ids entirely, even if present in skillTotals', () => {
    const skills = [skill(1)]
    const skillTotals = new Map([
      [1, 3],
      [SKILL_SLOTS_UP_ID, 2],
    ])

    const result = determineActiveSkills(picks, skillTotals, skills, ZENITH_SKILLS)

    expect(result.rankedActive).toEqual([1])
  })

  it('orders active skills by priority rank, most-protected first', () => {
    const skills = [skill(1, { priorityRank: 50 }), skill(2, { priorityRank: 1 })]
    const skillTotals = new Map([
      [1, 3],
      [2, 3],
    ])

    const result = determineActiveSkills(picks, skillTotals, skills, ZENITH_SKILLS)

    expect(result.rankedActive).toEqual([2, 1])
  })

  it('sorts an unranked skill after every ranked skill', () => {
    const skills = [skill(1, { priorityRank: null }), skill(2, { priorityRank: 193 })]
    const skillTotals = new Map([
      [1, 3],
      [2, 3],
    ])

    const result = determineActiveSkills(picks, skillTotals, skills, ZENITH_SKILLS)

    expect(result.rankedActive).toEqual([2, 1])
  })

  it('force-disables active skills beyond the cap, lowest priority first', () => {
    const skills = Array.from({ length: 11 }, (_, i) => skill(i + 1, { priorityRank: i + 1 }))
    const skillTotals = new Map(skills.map((s) => [s.id, 3]))

    const result = determineActiveSkills(picks, skillTotals, skills, ZENITH_SKILLS)

    expect(result.cap).toBe(10)
    expect(result.rankedActive).toHaveLength(11)
    expect(result.disabled).toEqual([11])
  })

  it('exempts a Hiden/Tech skill from the cap when a cuff contributes to it, letting it stay active past the cap', () => {
    const hidenId = 999
    const normalSkills = Array.from({ length: 10 }, (_, i) => skill(i + 1, { priorityRank: i + 1 }))
    const skills = [...normalSkills, skill(hidenId, { category: 'Hiden/Tech Skills' })]
    const skillTotals = new Map([...normalSkills.map((s) => [s.id, 3] as const), [hidenId, 5]])
    const cuffs = [cuff('cuff:1', hidenId, 5)]

    const result = determineActiveSkills(picks, skillTotals, skills, ZENITH_SKILLS, cuffs)

    expect(result.cap).toBe(10)
    expect(result.rankedActive).toHaveLength(11)
    expect(result.disabled).toEqual([])
  })

  it('still caps a Hiden/Tech skill normally when nothing cuff-sourced contributes to it', () => {
    const hidenId = 999
    const normalSkills = Array.from({ length: 10 }, (_, i) => skill(i + 1, { priorityRank: i + 1 }))
    const skills = [
      ...normalSkills,
      skill(hidenId, { category: 'Hiden/Tech Skills', priorityRank: 11 }),
    ]
    const skillTotals = new Map([...normalSkills.map((s) => [s.id, 3] as const), [hidenId, 5]])

    const result = determineActiveSkills(picks, skillTotals, skills, ZENITH_SKILLS, [])

    expect(result.disabled).toEqual([hidenId])
  })

  it("doesn't exempt a cuff-sourced skill outside the Hiden/Tech category", () => {
    const attackId = 999
    const normalSkills = Array.from({ length: 10 }, (_, i) => skill(i + 1, { priorityRank: i + 1 }))
    const skills = [
      ...normalSkills,
      skill(attackId, { category: 'Attack Skills', priorityRank: 11 }),
    ]
    const skillTotals = new Map([...normalSkills.map((s) => [s.id, 3] as const), [attackId, 5]])
    const cuffs = [cuff('cuff:1', attackId, 5)]

    const result = determineActiveSkills(picks, skillTotals, skills, ZENITH_SKILLS, cuffs)

    expect(result.disabled).toEqual([attackId])
  })

  it('exempts an Exotic-armor-granted skill from the cap regardless of category', () => {
    const iceAttackId = 999
    const normalSkills = Array.from({ length: 10 }, (_, i) => skill(i + 1, { priorityRank: i + 1 }))
    const skills = [
      ...normalSkills,
      skill(iceAttackId, { category: 'Attack Skills', priorityRank: 11 }),
    ]
    const skillTotals = new Map([...normalSkills.map((s) => [s.id, 3] as const), [iceAttackId, 20]])
    const exoticPicks = new Map([['head', candidate('grank_g', false, iceAttackId)]])

    const result = determineActiveSkills(exoticPicks, skillTotals, skills, ZENITH_SKILLS)

    expect(result.cap).toBe(10)
    expect(result.rankedActive).toHaveLength(11)
    expect(result.disabled).toEqual([])
  })

  it("doesn't exempt a skill just because it's active, when no pick's Exotic grant targets it", () => {
    const attackId = 999
    const normalSkills = Array.from({ length: 10 }, (_, i) => skill(i + 1, { priorityRank: i + 1 }))
    const skills = [
      ...normalSkills,
      skill(attackId, { category: 'Attack Skills', priorityRank: 11 }),
    ]
    const skillTotals = new Map([...normalSkills.map((s) => [s.id, 3] as const), [attackId, 5]])

    const result = determineActiveSkills(picks, skillTotals, skills, ZENITH_SKILLS)

    expect(result.disabled).toEqual([attackId])
  })
})

describe('previewActiveSkillCap (docs/feedback.md Round 2 #4)', () => {
  function candidateWithSkills(
    id: string,
    category: string,
    grankOrLater: boolean,
    skills: readonly { skillId: number; points: number }[],
  ): NamedCandidate {
    return {
      id,
      name: id,
      category,
      grankOrLater,
      hunterType: 'common',
      exoticSkillId: null,
      defenseMax: null,
      resistances: { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 },
      skills,
    }
  }

  function slot(slotId: string, candidates: readonly NamedCandidate[]): NamedSlotQuery {
    return { slotId, candidates }
  }

  function cuff(id: string, skills: readonly { skillId: number; points: number }[]): NamedCuff {
    return { id, name: id, slotSize: 1, category: 'cuff_standard_plain', skills }
  }

  const GREATAXE_ID = 2001
  const ZENITH_SKILLS_WITH_GREATAXE: readonly NamedSkill[] = [
    ...ZENITH_SKILLS,
    skill(GREATAXE_ID, { name: 'Greataxe Up' }),
  ]

  // Every call below that doesn't care about cuff pins passes these two
  // empty, matching how `App.tsx` calls through with `BuiltQuery`'s own
  // (usually empty) `pinnedCuffs`/`pinnedCuffSkillIds`.
  const NO_PINNED_CUFFS: NamedCuff[] = []
  const NO_PINNED_CUFF_SKILLS: number[] = []

  it('is 10 with no Zenith requirements selected and no G-Rank gear available', () => {
    const slots = [slot('head', [candidateWithSkills('head:1', 'standard_plain', false, [])])]

    expect(
      previewActiveSkillCap(slots, [], NO_PINNED_CUFFS, NO_PINNED_CUFF_SKILLS, [], ZENITH_SKILLS),
    ).toBe(10)
  })

  it('adds +1 once 3 real armor slots each have a G-Rank-or-later candidate available', () => {
    const grankSlot = (id: string) =>
      slot(id, [candidateWithSkills(`${id}:g`, 'grank_g', true, [])])
    const slots = [grankSlot('head'), grankSlot('chest'), grankSlot('arms')]

    expect(
      previewActiveSkillCap(slots, [], NO_PINNED_CUFFS, NO_PINNED_CUFF_SKILLS, [], ZENITH_SKILLS),
    ).toBe(11)
  })

  it('adds +2 once 5 real armor slots each have a G-Rank-or-later candidate available', () => {
    const grankSlot = (id: string) =>
      slot(id, [candidateWithSkills(`${id}:g`, 'grank_g', true, [])])
    const slots = [
      grankSlot('head'),
      grankSlot('chest'),
      grankSlot('arms'),
      grankSlot('waist'),
      grankSlot('legs'),
    ]

    expect(
      previewActiveSkillCap(slots, [], NO_PINNED_CUFFS, NO_PINNED_CUFF_SKILLS, [], ZENITH_SKILLS),
    ).toBe(12)
  })

  it('never counts the virtual weapon slot toward the G-Rank piece count', () => {
    const grankSlot = (id: string) =>
      slot(id, [candidateWithSkills(`${id}:g`, 'grank_g', true, [])])
    const slots = [
      grankSlot('head'),
      grankSlot('chest'),
      grankSlot('weapon'), // would make 3 if counted, but must not be
    ]

    expect(
      previewActiveSkillCap(slots, [], NO_PINNED_CUFFS, NO_PINNED_CUFF_SKILLS, [], ZENITH_SKILLS),
    ).toBe(10)
  })

  it('excludes Origin pieces from the G-Rank piece count, same carve-out as a real build', () => {
    const originSlot = (id: string) =>
      slot(id, [candidateWithSkills(`${id}:o`, 'grank_origin', true, [])])
    const slots = [originSlot('head'), originSlot('chest'), originSlot('arms')]

    expect(
      previewActiveSkillCap(slots, [], NO_PINNED_CUFFS, NO_PINNED_CUFF_SKILLS, [], ZENITH_SKILLS),
    ).toBe(10)
  })

  // The next few tests reproduce the project owner's own worked examples
  // (2026-10-19) almost verbatim: 5 G-Rank-or-later armor slots, each able to
  // grant either its own dedicated Zenith skill or Skill Slots Up (two
  // different pieces competing for the same slot -- this game never grants
  // more than one Zenith skill per piece), a weapon slot that can likewise go
  // either way, and a cuff pool that can grant Skill Slots Up -- 7 positions
  // total (5 + 1 + 1), matching the project owner's own "there are only ever
  // 7 Zenith skill points... 1 for each armor piece, 1 from the cuff, and 1
  // from the weapon."
  const OTHER_SKILL_IDS = [101, 102, 103, 104, 105]
  function flexibleGrankSlot(id: string, skillId: number): NamedSlotQuery {
    return slot(id, [
      candidateWithSkills(`${id}:skill`, 'zenith_g', true, [{ skillId, points: 1 }]),
      candidateWithSkills(`${id}:ssu`, 'zenith_g', false, [
        { skillId: SKILL_SLOTS_UP_ID, points: 1 },
      ]),
      candidateWithSkills(`${id}:plain`, 'standard_plain', false, []),
    ])
  }
  const FLEXIBLE_WEAPON_SLOT = slot('weapon', [
    candidateWithSkills('weapon:none', 'weapon', false, []),
    candidateWithSkills('weapon:ssu', 'weapon', false, [{ skillId: SKILL_SLOTS_UP_ID, points: 1 }]),
  ])
  const FLEXIBLE_SLOTS = [
    flexibleGrankSlot('head', OTHER_SKILL_IDS[0]),
    flexibleGrankSlot('chest', OTHER_SKILL_IDS[1]),
    flexibleGrankSlot('arms', OTHER_SKILL_IDS[2]),
    flexibleGrankSlot('waist', OTHER_SKILL_IDS[3]),
    flexibleGrankSlot('legs', OTHER_SKILL_IDS[4]),
    FLEXIBLE_WEAPON_SLOT,
  ]
  const SSU_ONLY_CUFF_POOL = [cuff('cuff:ssu', [{ skillId: SKILL_SLOTS_UP_ID, points: 1 }])]

  it('reaches the full +7 ceiling when no Zenith skills are selected yet and gear is plentiful', () => {
    // 5 armor slots + the weapon slot + the one Zenith-capable cuff slot = 7
    // positions that could each become Skill Slots Up, nothing claiming any
    // of them yet -- 10 base + 2 G-Rank + 7 Skill Slots Up = 19, the project
    // owner's own "all gear available" ceiling.
    const cap = previewActiveSkillCap(
      FLEXIBLE_SLOTS,
      SSU_ONLY_CUFF_POOL,
      NO_PINNED_CUFFS,
      NO_PINNED_CUFF_SKILLS,
      [],
      ZENITH_SKILLS,
    )

    expect(cap).toBe(19)
  })

  it('drops to 14 once 5 other Zenith skills are selected, each claiming its own dedicated slot', () => {
    // Each selected skill can only come from its own armor slot here, so all
    // 5 armor slots are spent satisfying them -- only the weapon and cuff
    // positions are left over for Skill Slots Up: 10 base + 2 G-Rank + 2
    // Skill Slots Up, the project owner's other worked example.
    const requirements = OTHER_SKILL_IDS.map((skillId) => ({ skillId, minPoints: 1 }))

    const cap = previewActiveSkillCap(
      FLEXIBLE_SLOTS,
      SSU_ONLY_CUFF_POOL,
      NO_PINNED_CUFFS,
      NO_PINNED_CUFF_SKILLS,
      requirements,
      ZENITH_SKILLS,
    )

    expect(cap).toBe(14)
  })

  it('drops the ceiling by only 1 once both cuff slots are pinned away, since cuffs only ever share one Zenith slot', () => {
    // Cuffs collectively only ever carry 1 Zenith skill point in this build
    // (confirmed by the project owner, 2026-10-19, correcting an earlier
    // assumption that each of the 2 cuff slots independently counted) -- so
    // pinning both away, even though it occupies 2 physical slots, can only
    // ever cost the 1 point cuffs could have contributed: 19 -> 18.
    const nonSsuCuff = cuff('cuff:plain', [])

    const cap = previewActiveSkillCap(
      FLEXIBLE_SLOTS,
      SSU_ONLY_CUFF_POOL,
      [nonSsuCuff, nonSsuCuff],
      NO_PINNED_CUFF_SKILLS,
      [],
      ZENITH_SKILLS,
    )

    expect(cap).toBe(18)
  })

  it("doesn't lower the ceiling at all when only one of the two cuff slots is pinned away", () => {
    // The shared single Zenith-cuff opportunity can still land on the
    // remaining, unpinned cuff slot, so the ceiling stays at 19.
    const nonSsuCuff = cuff('cuff:plain', [])

    const cap = previewActiveSkillCap(
      FLEXIBLE_SLOTS,
      SSU_ONLY_CUFF_POOL,
      [nonSsuCuff],
      NO_PINNED_CUFF_SKILLS,
      [],
      ZENITH_SKILLS,
    )

    expect(cap).toBe(19)
  })

  it('counts the weapon slot as a Skill Slots Up source when its own Zenith skill checklist allows it', () => {
    const slots = [
      slot('head', [candidateWithSkills('head:1', 'standard_plain', false, [])]),
      slot('weapon', [
        candidateWithSkills('weapon:none', 'weapon', false, []),
        candidateWithSkills('weapon:ssu', 'weapon', false, [
          { skillId: SKILL_SLOTS_UP_ID, points: 1 },
        ]),
      ]),
    ]

    const cap = previewActiveSkillCap(
      slots,
      [],
      NO_PINNED_CUFFS,
      NO_PINNED_CUFF_SKILLS,
      [],
      ZENITH_SKILLS,
    )

    expect(cap).toBe(11)
  })

  it("doesn't count the weapon slot toward Skill Slots Up once its checklist excludes it", () => {
    // Same shape as the previous test, but Skill Slots Up was unchecked from
    // the weapon's own Zenith-skill checklist (`excludedWeaponZenithSkillIds`
    // -- see build-query.ts's `buildWeaponSlot`), so `weapon:ssu` never makes
    // it into `slots` in the first place.
    const slots = [
      slot('head', [candidateWithSkills('head:1', 'standard_plain', false, [])]),
      slot('weapon', [candidateWithSkills('weapon:none', 'weapon', false, [])]),
    ]

    const cap = previewActiveSkillCap(
      slots,
      [],
      NO_PINNED_CUFFS,
      NO_PINNED_CUFF_SKILLS,
      [],
      ZENITH_SKILLS,
    )

    expect(cap).toBe(10)
  })

  it('a cuff pinned by skill to Skill Slots Up still contributes, using the best available variant', () => {
    const slots = [slot('head', [candidateWithSkills('head:1', 'standard_plain', false, [])])]
    const cuffs = [
      cuff('cuff:weak', [{ skillId: SKILL_SLOTS_UP_ID, points: 1 }]),
      cuff('cuff:strong', [{ skillId: SKILL_SLOTS_UP_ID, points: 3 }]),
    ]
    // The other cuff slot is pinned away to a plain, non-Skill-Slots-Up cuff
    // so only the skill-pinned slot's own contribution is under test here.
    const otherSlotPin = [cuff('cuff:plain', [])]

    const cap = previewActiveSkillCap(
      slots,
      cuffs,
      otherSlotPin,
      [SKILL_SLOTS_UP_ID],
      [],
      ZENITH_SKILLS,
    )

    expect(cap).toBe(13)
  })

  it('a cuff pinned by skill to another selected Zenith skill frees up the armor slot that would have granted it', () => {
    // The cuff pin already guarantees GREATAXE_ID regardless of which exact
    // cuff ends up equipped, so the one armor slot that could also grant it
    // is left free for Skill Slots Up instead.
    const slots = [
      slot('head', [
        candidateWithSkills('head:skill', 'zenith_g', false, [{ skillId: GREATAXE_ID, points: 1 }]),
        candidateWithSkills('head:ssu', 'zenith_g', false, [
          { skillId: SKILL_SLOTS_UP_ID, points: 1 },
        ]),
      ]),
    ]
    const cuffs = [cuff('cuff:greataxe', [{ skillId: GREATAXE_ID, points: 1 }])]

    const cap = previewActiveSkillCap(
      slots,
      cuffs,
      NO_PINNED_CUFFS,
      [GREATAXE_ID],
      [{ skillId: GREATAXE_ID, minPoints: 1 }],
      ZENITH_SKILLS_WITH_GREATAXE,
    )

    expect(cap).toBe(11)
  })

  it('claims one dedicated position per required point, since a single piece only ever grants 1 point of a Zenith skill', () => {
    // Two different slots can each grant one point of STYLISH_ASSAULT_ID, or
    // one point of Skill Slots Up instead -- asking for "Stylish Assault Up
    // +2" needs both of them, leaving nothing for Skill Slots Up (confirmed
    // by the project owner, 2026-10-19: "if I have Stylish Assault up +2 as
    // the goal of the search, it should deduct 2 points rather than 1").
    const STYLISH_ASSAULT_ID = 3001
    const dualSlot = (id: string) =>
      slot(id, [
        candidateWithSkills(`${id}:skill`, 'zenith_g', false, [
          { skillId: STYLISH_ASSAULT_ID, points: 1 },
        ]),
        candidateWithSkills(`${id}:ssu`, 'zenith_g', false, [
          { skillId: SKILL_SLOTS_UP_ID, points: 1 },
        ]),
      ])
    const slots = [dualSlot('head'), dualSlot('chest')]

    const askingFor1Point = previewActiveSkillCap(
      slots,
      [],
      NO_PINNED_CUFFS,
      NO_PINNED_CUFF_SKILLS,
      [{ skillId: STYLISH_ASSAULT_ID, minPoints: 1 }],
      ZENITH_SKILLS,
    )
    const askingFor2Points = previewActiveSkillCap(
      slots,
      [],
      NO_PINNED_CUFFS,
      NO_PINNED_CUFF_SKILLS,
      [{ skillId: STYLISH_ASSAULT_ID, minPoints: 2 }],
      ZENITH_SKILLS,
    )

    // Asking for 1 point leaves the other slot free for Skill Slots Up (+1);
    // asking for 2 points claims both slots, leaving none.
    expect(askingFor1Point).toBe(11)
    expect(askingFor2Points).toBe(10)
  })

  it("the player's own explicit Skill Slots Up selection doesn't change the ceiling by itself", () => {
    // Asking for a specific Skill Slots Up amount isn't a "requirement" that
    // claims a slot the way another Zenith skill does -- it's exactly what
    // this preview is already computing the ceiling for.
    const withoutSelection = previewActiveSkillCap(
      FLEXIBLE_SLOTS,
      SSU_ONLY_CUFF_POOL,
      NO_PINNED_CUFFS,
      NO_PINNED_CUFF_SKILLS,
      [],
      ZENITH_SKILLS,
    )
    const withSelection = previewActiveSkillCap(
      FLEXIBLE_SLOTS,
      SSU_ONLY_CUFF_POOL,
      NO_PINNED_CUFFS,
      NO_PINNED_CUFF_SKILLS,
      [{ skillId: SKILL_SLOTS_UP_ID, minPoints: 3 }],
      ZENITH_SKILLS,
    )

    expect(withSelection).toBe(withoutSelection)
  })
})
