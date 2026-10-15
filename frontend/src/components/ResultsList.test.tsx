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
    expect(screen.getByText(/defense: 8/i)).toBeInTheDocument()
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
    expect(zenithLine).toHaveTextContent('Skill Slots Up: 3')
    expect(zenithLine).not.toHaveTextContent('Attack: 20')
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
    expect(screen.getByText(/skill 11: 3 \(disabled\)/i)).toBeInTheDocument()
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
      <ResultsList results={[]} skillNames={skillNames} skills={skills} zenithSkills={zenithSkills} />,
    )

    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(container.querySelector('ul')).not.toBeInTheDocument()
  })
})
