import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoot } from './AppRoot'
import { useDataBundle } from './data/useDataBundle'
import { useSearchWorker } from './search/useSearchWorker'
import { buildResultUrl } from './search-engine/shared-state'
import type { SharedSearchState } from './search-engine/shared-state'

vi.mock('./data/useDataBundle')
vi.mock('./search/useSearchWorker')

const mockUseDataBundle = vi.mocked(useDataBundle)
const mockUseSearchWorker = vi.mocked(useSearchWorker)

const BUNDLE = {
  slots: [{ slotId: 'head', candidates: [] }],
  decorations: [],
  cuffs: [],
  skills: [],
  zenithSkills: [],
  skillNames: new Map(),
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
    picks: [],
    decorations: [],
    cuffs: [],
    skillTotals: [],
  },
}

beforeEach(() => {
  mockUseDataBundle.mockReturnValue({
    data: BUNDLE,
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useDataBundle>)
  mockUseSearchWorker.mockReturnValue({
    search: vi.fn(() => 'req-1'),
    cancel: vi.fn(),
  } as unknown as ReturnType<typeof useSearchWorker>)
  window.location.hash = ''
})

afterEach(() => {
  window.location.hash = ''
})

describe('AppRoot', () => {
  it('renders the main search page when the location has no shared-result hash', () => {
    render(<AppRoot />)
    expect(screen.getByRole('heading', { name: 'Frontier Set Searcher' })).toBeInTheDocument()
  })

  it('renders the shared-result page when the location hash points at one', async () => {
    window.location.hash = new URL(await buildResultUrl(STATE)).hash
    render(<AppRoot />)
    expect(screen.getByRole('heading', { name: 'Shared build' })).toBeInTheDocument()
  })
})
