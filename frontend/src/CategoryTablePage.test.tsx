import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CategoryTablePage } from './CategoryTablePage'
import { useDataBundle } from './data/useDataBundle'

vi.mock('./data/useDataBundle')

const mockUseDataBundle = vi.mocked(useDataBundle)

const BUNDLE = {
  slots: [
    {
      slotId: 'head',
      candidates: [
        {
          id: 'head:0001',
          name: 'Zenny Helm',
          skills: [{ skillId: 1, points: 5 }],
          category: 'standard_plain',
          grankOrLater: false,
          hunterType: 'common',
          exoticSkillId: null,
          defenseMax: 40,
          resistances: { fire: 1, water: 0, thunder: 0, ice: 0, dragon: 0 },
          openSlotCount: 1,
        },
        {
          id: 'head:0002',
          name: 'Amber Helm',
          skills: [],
          category: 'standard_plain',
          grankOrLater: false,
          hunterType: 'blademaster',
          exoticSkillId: 1,
          defenseMax: 20,
          resistances: { fire: 0, water: 2, thunder: 0, ice: 0, dragon: 0 },
          openSlotCount: 0,
        },
        {
          id: 'head:0003',
          name: 'Other Category Helm',
          skills: [],
          category: 'guild_plain',
          grankOrLater: false,
          hunterType: 'common',
          exoticSkillId: null,
          defenseMax: null,
          resistances: { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 },
        },
      ],
    },
  ],
  decorations: [
    {
      id: 'D001',
      name: 'Attack Gem',
      slotSize: 1,
      skills: [{ skillId: 1, points: 2 }],
      isTower: false,
      isSp: false,
      category: 'standard_plain',
    },
  ],
  cuffs: [
    {
      id: 'cuff:C001',
      name: 'Sharpening PC1',
      slotSize: 1,
      skills: [],
      category: 'standard_plain',
    },
  ],
  skills: [],
  zenithSkills: [],
  skillNames: new Map([[1, 'Attack']]),
  weaponZenithSkillIds: [],
}

beforeEach(() => {
  mockUseDataBundle.mockReturnValue({
    data: BUNDLE,
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useDataBundle>)
})

describe('CategoryTablePage', () => {
  it('shows the category label as the page heading', () => {
    render(<CategoryTablePage kind="gear" categoryKey="standard_plain" onBackToSearch={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Standard' })).toBeInTheDocument()
  })

  it('shows only items from the requested category', () => {
    render(<CategoryTablePage kind="gear" categoryKey="standard_plain" onBackToSearch={vi.fn()} />)
    expect(screen.getByText('Zenny Helm')).toBeInTheDocument()
    expect(screen.getByText('Amber Helm')).toBeInTheDocument()
    expect(screen.queryByText('Other Category Helm')).not.toBeInTheDocument()
  })

  it('renders every exported armor attribute as a column', () => {
    render(<CategoryTablePage kind="gear" categoryKey="standard_plain" onBackToSearch={vi.fn()} />)
    for (const header of [
      'Name',
      'Hunter Type',
      'G Rank or later',
      'Max Defense',
      'Fire Res',
      'Water Res',
      'Thunder Res',
      'Ice Res',
      'Dragon Res',
      'Slots',
      'Exotic Skill',
      'Skills',
      'ID',
    ]) {
      expect(
        screen.getByRole('columnheader', { name: new RegExp(`^${header}`) }),
      ).toBeInTheDocument()
    }
    expect(screen.getByRole('cell', { name: 'Attack' })).toBeInTheDocument()
  })

  it('renders a decoration table scoped to its own category', () => {
    render(
      <CategoryTablePage
        kind="decorations"
        categoryKey="standard_plain"
        onBackToSearch={vi.fn()}
      />,
    )
    expect(screen.getByText('Attack Gem')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Tower Gem' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'SP Decoration' })).toBeInTheDocument()
  })

  it('renders a cuff table scoped to its own category', () => {
    render(<CategoryTablePage kind="cuffs" categoryKey="standard_plain" onBackToSearch={vi.fn()} />)
    expect(screen.getByText('Sharpening PC1')).toBeInTheDocument()
  })

  it('sorts rows by a clicked column, toggling direction on a second click', async () => {
    const user = userEvent.setup()
    render(<CategoryTablePage kind="gear" categoryKey="standard_plain" onBackToSearch={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /^Name/ }))
    let rows = screen.getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('Amber Helm')
    expect(rows[1]).toHaveTextContent('Zenny Helm')

    await user.click(screen.getByRole('button', { name: /^Name/ }))
    rows = screen.getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('Zenny Helm')
    expect(rows[1]).toHaveTextContent('Amber Helm')
  })

  it('calls onBackToSearch when the back link is clicked', async () => {
    const onBackToSearch = vi.fn()
    const user = userEvent.setup()
    render(
      <CategoryTablePage
        kind="gear"
        categoryKey="standard_plain"
        onBackToSearch={onBackToSearch}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Back to search/ }))

    expect(onBackToSearch).toHaveBeenCalled()
  })

  it('shows a loading message while the bundle loads', () => {
    mockUseDataBundle.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as unknown as ReturnType<typeof useDataBundle>)
    render(<CategoryTablePage kind="gear" categoryKey="standard_plain" onBackToSearch={vi.fn()} />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows an error message when the bundle fails to load', () => {
    mockUseDataBundle.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as unknown as ReturnType<typeof useDataBundle>)
    render(<CategoryTablePage kind="gear" categoryKey="standard_plain" onBackToSearch={vi.fn()} />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
