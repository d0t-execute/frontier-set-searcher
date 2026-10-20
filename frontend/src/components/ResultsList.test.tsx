import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ResultsList } from './ResultsList'
import type { NamedBuildResult } from './types'
import type { NamedCandidate, NamedSkill } from '../search-engine/load-bundle'

const skillNames = new Map([
  [1, 'Attack'],
  [2, 'Defense'],
])

const skills: readonly NamedSkill[] = [
  { id: 1, name: 'Attack', category: null, priorityRank: null, tiers: [] },
  { id: 2, name: 'Defense', category: null, priorityRank: null, tiers: [] },
]
const zenithSkills: readonly NamedSkill[] = []

function candidate(
  overrides: Partial<NamedCandidate> & Pick<NamedCandidate, 'id' | 'name'>,
): NamedCandidate {
  return {
    skills: [],
    category: 'standard_plain',
    grankOrLater: false,
    hunterType: 'common',
    exoticSkillId: null,
    defenseMax: null,
    resistances: { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 },
    ...overrides,
  }
}

function result(overrides: Partial<NamedBuildResult> = {}): NamedBuildResult {
  return {
    picks: new Map([['head', candidate({ id: 'head:0001', name: 'Leather Helm' })]]),
    decorations: new Map(),
    cuffs: [],
    skillTotals: new Map([[1, 15]]),
    ...overrides,
  }
}

describe('ResultsList', () => {
  it('renders one entry per result, in the given order', () => {
    render(
      <ResultsList
        results={[
          result({
            picks: new Map([['head', candidate({ id: 'a', name: 'Helm A' })]]),
          }),
          result({
            picks: new Map([['head', candidate({ id: 'b', name: 'Helm B' })]]),
          }),
        ]}
        skillNames={skillNames}
        skills={skills}
        zenithSkills={zenithSkills}
      />,
    )

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Helm A')
    expect(items[1]).toHaveTextContent('Helm B')
  })

  it('shows the pick for each slot by name', () => {
    render(
      <ResultsList
        results={[
          result({
            picks: new Map([
              ['head', candidate({ id: 'head:0001', name: 'Leather Helm' })],
              ['chest', candidate({ id: 'body:0001', name: 'Leather Vest' })],
            ]),
          }),
        ]}
        skillNames={skillNames}
        skills={skills}
        zenithSkills={zenithSkills}
      />,
    )

    expect(screen.getByText(/leather helm/i)).toBeInTheDocument()
    expect(screen.getByText(/leather vest/i)).toBeInTheDocument()
  })

  it('shows decorations placed in a slot, when present', () => {
    render(
      <ResultsList
        results={[
          result({
            decorations: new Map([
              [
                'head',
                [
                  {
                    id: 'D001',
                    name: 'Attack Jewel',
                    slotSize: 1,
                    skills: [],
                    isTower: false,
                    isSp: false,
                    category: 'deco_standard',
                  },
                ],
              ],
            ]),
          }),
        ]}
        skillNames={skillNames}
        skills={skills}
        zenithSkills={zenithSkills}
      />,
    )

    expect(screen.getByText(/attack jewel/i)).toBeInTheDocument()
  })

  it('shows how many decoration slots a piece leaves open', () => {
    render(
      <ResultsList
        results={[
          result({
            picks: new Map([
              ['head', candidate({ id: 'head:0001', name: 'Leather Helm', openSlotCount: 3 })],
            ]),
          }),
        ]}
        skillNames={skillNames}
        skills={skills}
        zenithSkills={zenithSkills}
      />,
    )

    expect(screen.getByText(/3 open slots/i)).toBeInTheDocument()
  })

  it('subtracts placed decorations’ slot size from the open-slots count shown', () => {
    render(
      <ResultsList
        results={[
          result({
            picks: new Map([
              ['head', candidate({ id: 'head:0001', name: 'Leather Helm', openSlotCount: 3 })],
            ]),
            decorations: new Map([
              [
                'head',
                [
                  {
                    id: 'D001',
                    name: 'Attack Jewel',
                    slotSize: 1,
                    skills: [],
                    isTower: false,
                    isSp: false,
                    category: 'deco_standard',
                  },
                ],
              ],
            ]),
          }),
        ]}
        skillNames={skillNames}
        skills={skills}
        zenithSkills={zenithSkills}
      />,
    )

    expect(screen.getByText(/2 open slots/i)).toBeInTheDocument()
  })

  it("shows nothing about open slots when a piece's slots are all used", () => {
    render(
      <ResultsList
        results={[
          result({
            picks: new Map([
              ['head', candidate({ id: 'head:0001', name: 'Leather Helm', openSlotCount: 1 })],
            ]),
            decorations: new Map([
              [
                'head',
                [
                  {
                    id: 'D001',
                    name: 'Attack Jewel',
                    slotSize: 1,
                    skills: [],
                    isTower: false,
                    isSp: false,
                    category: 'deco_standard',
                  },
                ],
              ],
            ]),
          }),
        ]}
        skillNames={skillNames}
        skills={skills}
        zenithSkills={zenithSkills}
      />,
    )

    expect(screen.queryByText(/open slot/i)).not.toBeInTheDocument()
  })

  it('shows equipped cuffs by name, when present', () => {
    render(
      <ResultsList
        results={[
          result({
            cuffs: [
              {
                id: 'cuff:C001',
                name: 'Sharpening PC1',
                slotSize: 1,
                skills: [],
                category: 'cuff_premium_tier1',
              },
            ],
          }),
        ]}
        skillNames={skillNames}
        skills={skills}
        zenithSkills={zenithSkills}
      />,
    )

    expect(screen.getByText(/sharpening pc1/i)).toBeInTheDocument()
  })

  it('shows nothing about cuffs when none are equipped', () => {
    render(
      <ResultsList
        results={[result()]}
        skillNames={skillNames}
        skills={skills}
        zenithSkills={zenithSkills}
      />,
    )

    expect(screen.queryByText(/cuffs/i)).not.toBeInTheDocument()
  })

  it('resolves skill totals to their names', () => {
    render(
      <ResultsList
        results={[
          result({
            skillTotals: new Map([
              [1, 20],
              [2, 8],
            ]),
          }),
        ]}
        skillNames={skillNames}
        skills={skills}
        zenithSkills={zenithSkills}
      />,
    )

    expect(screen.getByText(/attack/i)).toBeInTheDocument()
    expect(screen.getByText(/20/)).toBeInTheDocument()
    expect(screen.getByText('Defense').closest('div')).toHaveTextContent('Defense (8)')
  })

  it('shows Zenith skills under their own heading, separate from regular skills', () => {
    const zenithSkillsWithOne: readonly NamedSkill[] = [
      { id: 1000001, name: 'Skill Slots Up', category: null, priorityRank: null, tiers: [] },
    ]
    render(
      <ResultsList
        results={[
          result({
            skillTotals: new Map([
              [1, 20],
              [1000001, 3],
            ]),
          }),
        ]}
        skillNames={new Map([...skillNames, [1000001, 'Skill Slots Up']])}
        skills={skills}
        zenithSkills={zenithSkillsWithOne}
      />,
    )

    const zenithLine = screen.getByText(/zenith skills:/i).closest('div')
    expect(zenithLine).toHaveTextContent('Skill Slots Up')
    expect(zenithLine).not.toHaveTextContent('(3)')
    expect(zenithLine).not.toHaveTextContent('Attack (20)')
  })

  it('shows nothing about Zenith skills when the build has none', () => {
    render(
      <ResultsList
        results={[result()]}
        skillNames={skillNames}
        skills={skills}
        zenithSkills={zenithSkills}
      />,
    )

    expect(screen.queryByText(/zenith skills:/i)).not.toBeInTheDocument()
  })

  it('shows the active skill cap and flags skills disabled by exceeding it', () => {
    const manySkills: readonly NamedSkill[] = Array.from({ length: 11 }, (_, i) => ({
      id: i + 1,
      name: `Skill ${i + 1}`,
      category: null,
      priorityRank: i + 1,
      tiers: [],
    }))
    const skillTotals = new Map(manySkills.map((s) => [s.id, 3]))

    render(
      <ResultsList
        results={[result({ skillTotals })]}
        skillNames={new Map(manySkills.map((s) => [s.id, s.name]))}
        skills={manySkills}
        zenithSkills={zenithSkills}
      />,
    )

    expect(screen.getByText(/active skill cap: 10/i)).toBeInTheDocument()
    expect(screen.getByText(/1 skill disabled/i)).toBeInTheDocument()
    // The level/value split across two spans (so the level can be styled
    // bigger) means the full "Skill 11 (3) (disabled)" text is never any one
    // element's own text node -- `toHaveTextContent` aggregates descendants
    // the way `getByText` deliberately doesn't, so it's used here instead.
    expect(screen.getByText('Skill 11').closest('div')).toHaveTextContent('Skill 11 (3) (disabled)')
  })

  it('shows a tiered skill as its crossed tier label plus points over threshold', () => {
    const tieredSkills: readonly NamedSkill[] = [
      {
        id: 1,
        name: 'Stylish',
        category: null,
        priorityRank: null,
        tiers: [
          { label: 'Stylish +2', minPoints: 20, description: null },
          { label: 'Stylish +1', minPoints: 15, description: null },
        ],
      },
    ]
    render(
      <ResultsList
        results={[result({ skillTotals: new Map([[1, 17]]) })]}
        skillNames={new Map([[1, 'Stylish']])}
        skills={tieredSkills}
        zenithSkills={zenithSkills}
      />,
    )

    expect(screen.getByText('Stylish +1').closest('div')).toHaveTextContent('Stylish +1 (17/15)')
  })

  it("puts the skill's own name back in front of a bare-increment tier label", () => {
    // Most Zenith skills' own tiers read this way -- just "+1"/"+2", with
    // nothing in the label itself naming which skill it belongs to.
    const zenithSkillsWithOne: readonly NamedSkill[] = [
      {
        id: 1000001,
        name: 'Poison Res Up',
        category: null,
        priorityRank: null,
        tiers: [
          { label: '+2', minPoints: 2, description: null },
          { label: '+1', minPoints: 1, description: null },
        ],
      },
    ]
    render(
      <ResultsList
        results={[result({ skillTotals: new Map([[1000001, 1]]) })]}
        skillNames={new Map([[1000001, 'Poison Res Up']])}
        skills={skills}
        zenithSkills={zenithSkillsWithOne}
      />,
    )

    const entry = screen.getByText('Poison Res Up +1').closest('div')
    expect(entry).toHaveTextContent('Poison Res Up +1')
    expect(entry).not.toHaveTextContent('(1/1)')
  })

  it('shows plain progress toward the weakest tier when none has been crossed yet', () => {
    const tieredSkills: readonly NamedSkill[] = [
      {
        id: 1,
        name: 'Vampirism',
        category: null,
        priorityRank: null,
        tiers: [{ label: 'Vampirism+1', minPoints: 10, description: null }],
      },
    ]
    render(
      <ResultsList
        results={[result({ skillTotals: new Map([[1, 8]]) })]}
        skillNames={new Map([[1, 'Vampirism']])}
        skills={tieredSkills}
        zenithSkills={zenithSkills}
      />,
    )

    expect(screen.getByText('Vampirism').closest('div')).toHaveTextContent('Vampirism (8/10)')
  })

  it('shows a crossed negative (penalty) tier with its own label and negative threshold', () => {
    const tieredSkills: readonly NamedSkill[] = [
      {
        id: 1,
        name: 'Precision',
        category: null,
        priorityRank: null,
        tiers: [
          { label: 'Precision+2', minPoints: 20, description: null },
          { label: 'Deviation Down', minPoints: 10, description: null },
          { label: 'Deviation Up', minPoints: -10, description: null },
        ],
      },
    ]
    render(
      <ResultsList
        results={[result({ skillTotals: new Map([[1, -13]]) })]}
        skillNames={new Map([[1, 'Precision']])}
        skills={tieredSkills}
        zenithSkills={zenithSkills}
      />,
    )

    const entry = screen.getByText('Deviation Up').closest('div')
    expect(entry).toHaveTextContent('Deviation Up (-13/-10)')
    expect(entry).toHaveClass('text-danger')
    expect(entry).not.toHaveClass('result-skill-inactive')
  })

  it('picks the deepest negative tier reached, not just the first one crossed', () => {
    const tieredSkills: readonly NamedSkill[] = [
      {
        id: 1,
        name: 'Defense',
        category: null,
        priorityRank: null,
        tiers: [
          { label: 'Defense-20', minPoints: -10, description: null },
          { label: 'Defense-30', minPoints: -15, description: null },
          { label: 'Defense-40', minPoints: -20, description: null },
        ],
      },
    ]
    render(
      <ResultsList
        results={[result({ skillTotals: new Map([[1, -17]]) })]}
        skillNames={new Map([[1, 'Defense']])}
        skills={tieredSkills}
        zenithSkills={zenithSkills}
      />,
    )

    expect(screen.getByText('Defense-30').closest('div')).toHaveTextContent('Defense-30 (-17/-15)')
  })

  it('shows plain progress toward the weakest negative tier when none has been crossed yet', () => {
    const tieredSkills: readonly NamedSkill[] = [
      {
        id: 1,
        name: 'Precision',
        category: null,
        priorityRank: null,
        tiers: [{ label: 'Deviation Up', minPoints: -10, description: null }],
      },
    ]
    render(
      <ResultsList
        results={[result({ skillTotals: new Map([[1, -5]]) })]}
        skillNames={new Map([[1, 'Precision']])}
        skills={tieredSkills}
        zenithSkills={zenithSkills}
      />,
    )

    const entry = screen.getByText('Precision').closest('div')
    expect(entry).toHaveTextContent('Precision (-5/-10)')
    expect(entry).not.toHaveClass('text-danger')
  })

  it("doesn't warn-color a crossed negative tier that's also disabled by the skill cap", () => {
    const manySkills: readonly NamedSkill[] = Array.from({ length: 11 }, (_, i) => ({
      id: i + 1,
      name: `Skill ${i + 1}`,
      category: null,
      priorityRank: i + 1,
      tiers: i === 10 ? [{ label: 'Deviation Up', minPoints: -10, description: null }] : [],
    }))
    const skillTotals = new Map([
      ...manySkills.slice(0, 10).map((s, i): [number, number] => [s.id, i + 1]),
      [11, -10],
    ])

    render(
      <ResultsList
        results={[result({ skillTotals })]}
        skillNames={new Map(manySkills.map((s) => [s.id, s.name]))}
        skills={manySkills}
        zenithSkills={zenithSkills}
      />,
    )

    const entry = screen.getByText('Deviation Up').closest('div')
    expect(entry).toHaveTextContent('(disabled)')
    expect(entry).toHaveClass('result-skill-inactive')
    expect(entry).not.toHaveClass('text-danger')
  })

  it('sorts skills by points descending, with disabled ones after active and uncrossed ones last', () => {
    const manySkills: readonly NamedSkill[] = Array.from({ length: 11 }, (_, i) => ({
      id: i + 1,
      name: `Skill ${i + 1}`,
      category: null,
      priorityRank: i + 1,
      tiers: [],
    }))
    // Skills 1-10 are active (priority order keeps #11 the one disabled by
    // the cap); #1 has the fewest points of the active ones, #10 the most,
    // and #11 (disabled) still has more points than any of them.
    const skillTotals = new Map([
      ...manySkills.slice(0, 10).map((s, i): [number, number] => [s.id, i + 1]),
      [11, 99],
    ])

    render(
      <ResultsList
        results={[result({ skillTotals })]}
        skillNames={new Map(manySkills.map((s) => [s.id, s.name]))}
        skills={manySkills}
        zenithSkills={zenithSkills}
      />,
    )

    const names = screen.getAllByText(/^Skill \d+$/).map((el) => el.textContent)
    expect(names[0]).toBe('Skill 10')
    expect(names[names.length - 1]).toBe('Skill 11')
  })

  it('shows each placed decoration as its own line under its piece', () => {
    render(
      <ResultsList
        results={[
          result({
            decorations: new Map([
              [
                'head',
                [
                  {
                    id: 'D001',
                    name: 'Attack Jewel',
                    slotSize: 1,
                    skills: [{ skillId: 1, points: 3 }],
                    isTower: false,
                    isSp: false,
                    category: 'deco_standard',
                  },
                  {
                    id: 'D002',
                    name: 'Defense Jewel',
                    slotSize: 1,
                    skills: [],
                    isTower: false,
                    isSp: false,
                    category: 'deco_standard',
                  },
                ],
              ],
            ]),
          }),
        ]}
        skillNames={skillNames}
        skills={skills}
        zenithSkills={zenithSkills}
      />,
    )

    const attackJewel = screen.getByText('Attack Jewel')
    expect(attackJewel).toBeInTheDocument()
    expect(screen.getByText('Defense Jewel')).toBeInTheDocument()
    expect(attackJewel).toHaveAttribute('title', 'Attack: 3')
  })

  it('shows the summed total defense and elemental resistances across every pick', () => {
    render(
      <ResultsList
        results={[
          result({
            picks: new Map([
              [
                'head',
                candidate({
                  id: 'head:0001',
                  name: 'Leather Helm',
                  defenseMax: 10,
                  resistances: { fire: 4, water: -1, thunder: 0, ice: 3, dragon: 2 },
                }),
              ],
              [
                'chest',
                candidate({
                  id: 'body:0001',
                  name: 'Leather Vest',
                  defenseMax: 20,
                  resistances: { fire: -2, water: 5, thunder: 1, ice: 0, dragon: 1 },
                }),
              ],
            ]),
          }),
        ]}
        skillNames={skillNames}
        skills={skills}
        zenithSkills={zenithSkills}
      />,
    )

    expect(screen.getByText(/total defense: 30/i)).toBeInTheDocument()
    expect(
      screen.getByText(/fire: 2, water: 4, thunder: 1, ice: 3, dragon: 3/i),
    ).toBeInTheDocument()
  })

  it('treats a missing defenseMax as zero when summing total defense', () => {
    render(
      <ResultsList
        results={[
          result({
            picks: new Map([
              ['head', candidate({ id: 'head:0001', name: 'Leather Helm', defenseMax: null })],
            ]),
          }),
        ]}
        skillNames={skillNames}
        skills={skills}
        zenithSkills={zenithSkills}
      />,
    )

    expect(screen.getByText(/total defense: 0/i)).toBeInTheDocument()
  })

  it('renders nothing when there are no results', () => {
    const { container } = render(
      <ResultsList
        results={[]}
        skillNames={skillNames}
        skills={skills}
        zenithSkills={zenithSkills}
      />,
    )

    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(container.querySelector('ul')).not.toBeInTheDocument()
  })
})
