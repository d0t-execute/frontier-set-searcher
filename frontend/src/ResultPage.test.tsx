import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResultPage } from './ResultPage'
import { useDataBundle } from './data/useDataBundle'
import { encodeSharedState } from './search-engine/shared-state'
import type { SharedSearchState } from './search-engine/shared-state'

vi.mock('./data/useDataBundle')

const mockUseDataBundle = vi.mocked(useDataBundle)

const BUNDLE = {
  slots: [
    {
      slotId: 'head',
      candidates: [
        {
          id: 'head:0001',
          name: 'Leather Helm',
          skills: [],
          category: 'standard_plain',
          grankOrLater: false,
        },
      ],
    },
  ],
  decorations: [],
  cuffs: [],
  skills: [{ id: 1, name: 'Attack', category: null, priorityRank: null, tiers: [] }],
  zenithSkills: [],
  skillNames: new Map([[1, 'Attack']]),
  weaponZenithSkillIds: [],
}

const STATE: SharedSearchState = {
  requirements: [{ skillId: 1, minPoints: 1 }],
  zenithRequirements: [],
  excludedCategories: [],
  excludedCuffCategories: [],
  excludedDecorationCategories: [],
  excludedWeaponZenithSkillIds: null,
  weaponSlotCount: 0,
  hunterTypeFilter: 'blademaster',
  excludedArmorIds: [],
  excludedDecorationIds: [],
  excludedCuffIds: [],
  excludedSkillIds: [],
  nonNegativeResistances: [],
  preferExactMatches: true,
  result: {
    picks: [
      {
        slotId: 'head',
        id: 'head:0001',
        name: 'Leather Helm',
        openSlotCount: null,
        grankOrLater: false,
        exoticSkillId: null,
        defenseMax: 10,
        resistances: { fire: 4, water: -1, thunder: 0, ice: 3, dragon: 2 },
      },
    ],
    decorations: [],
    cuffs: [],
    skillTotals: [[1, 5]],
  },
}

beforeEach(() => {
  mockUseDataBundle.mockReturnValue({
    data: BUNDLE,
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useDataBundle>)
})

describe('ResultPage', () => {
  it('shows a loading state while the link decodes', async () => {
    const encoded = await encodeSharedState(STATE)
    render(<ResultPage encoded={encoded} onUseAsBase={() => {}} onBackToSearch={() => {}} />)

    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it("renders the link's own embedded result with no solver involved", async () => {
    const encoded = await encodeSharedState(STATE)
    render(<ResultPage encoded={encoded} onUseAsBase={() => {}} onBackToSearch={() => {}} />)

    expect(await screen.findByText(/leather helm/i)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /use as a base for a new search/i }),
    ).toBeInTheDocument()
  })

  it("hands every part of the result back via onUseAsBase when 'Use as a base' is clicked", async () => {
    const onUseAsBase = vi.fn()
    const user = userEvent.setup()
    const encoded = await encodeSharedState({
      ...STATE,
      result: {
        ...STATE.result,
        cuffs: [{ id: 'cuff:C001', name: 'Sharpening PC1', skills: [] }],
      },
    })
    render(<ResultPage encoded={encoded} onUseAsBase={onUseAsBase} onBackToSearch={() => {}} />)

    await screen.findByText(/leather helm/i)
    await user.click(screen.getByRole('button', { name: /use as a base for a new search/i }))

    expect(onUseAsBase).toHaveBeenCalledTimes(1)
    const initialState = onUseAsBase.mock.calls[0][0]
    expect(initialState.pinnedArmor.get('head')).toEqual({
      candidateId: 'head:0001',
      decorationIds: [],
    })
    expect(initialState.pinnedCuffIds).toEqual(['cuff:C001'])
    expect(initialState.requirements).toEqual(STATE.requirements)
  })

  it('calls onBackToSearch when the back link is clicked', async () => {
    const onBackToSearch = vi.fn()
    const user = userEvent.setup()
    const encoded = await encodeSharedState(STATE)
    render(<ResultPage encoded={encoded} onUseAsBase={() => {}} onBackToSearch={onBackToSearch} />)

    await user.click(screen.getByRole('button', { name: /back to search/i }))

    expect(onBackToSearch).toHaveBeenCalledTimes(1)
  })

  it('shows an error for a link that fails to decode', async () => {
    render(
      <ResultPage encoded="not-a-valid-encoded-payload" onUseAsBase={() => {}} onBackToSearch={() => {}} />,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(/corrupted/i)
  })
})
