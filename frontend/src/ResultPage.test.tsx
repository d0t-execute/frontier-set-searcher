import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResultPage } from './ResultPage'
import { useDataBundle } from './data/useDataBundle'
import { useSearchWorker } from './search/useSearchWorker'
import { encodeSharedState } from './search-engine/shared-state'
import type { SharedSearchState } from './search-engine/shared-state'

vi.mock('./data/useDataBundle')
vi.mock('./search/useSearchWorker')

const mockUseDataBundle = vi.mocked(useDataBundle)
const mockUseSearchWorker = vi.mocked(useSearchWorker)

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
  pinnedArmor: [],
  pinnedCuffIds: [],
  preferExactMatches: true,
  resultIndex: 0,
}

function makeWorker() {
  return {
    search: vi.fn(() => 'req-1'),
    cancel: vi.fn(),
  }
}

beforeEach(() => {
  mockUseDataBundle.mockReturnValue({
    data: BUNDLE,
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useDataBundle>)
})

describe('ResultPage', () => {
  it('shows a loading state until the solver yields the requested result index', async () => {
    const worker = makeWorker()
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const encoded = await encodeSharedState(STATE)
    render(<ResultPage encoded={encoded} onUseAsBase={() => {}} onBackToSearch={() => {}} />)

    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('renders the reconstructed result once the solver streams it', async () => {
    const worker = makeWorker()
    worker.search.mockImplementation((...args: unknown[]) => {
      const callbacks = args[3] as { onResult: (result: unknown) => void }
      // Deferred, like the real worker's postMessage-based callbacks (never
      // synchronous) -- the component reads its own returned request id
      // before any callback can fire, same convention as App.test.tsx.
      queueMicrotask(() =>
        callbacks.onResult({
          picks: new Map([['head', { id: 'head:0001', name: 'Leather Helm', skills: [] }]]),
          decorations: new Map(),
          cuffs: [],
          skillTotals: new Map([[1, 5]]),
        }),
      )
      return 'req-1'
    })
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const encoded = await encodeSharedState(STATE)
    render(<ResultPage encoded={encoded} onUseAsBase={() => {}} onBackToSearch={() => {}} />)

    expect(await screen.findByText(/leather helm/i)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /use as a base for a new search/i }),
    ).toBeInTheDocument()
  })

  it('reports not-found once the solver finishes without reaching the requested index', async () => {
    const worker = makeWorker()
    worker.search.mockImplementation(() => 'req-1')
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const encoded = await encodeSharedState({ ...STATE, resultIndex: 3 })
    render(<ResultPage encoded={encoded} onUseAsBase={() => {}} onBackToSearch={() => {}} />)

    await waitFor(() => expect(worker.search).toHaveBeenCalled())
    const args = worker.search.mock.calls[0] as unknown[]
    const callbacks = args[3] as { onDone: () => void }
    callbacks.onDone()

    expect(await screen.findByRole('alert')).toHaveTextContent(/no longer be found/i)
  })

  it("hands every part of the result back via onUseAsBase when 'Use as a base' is clicked", async () => {
    const worker = makeWorker()
    worker.search.mockImplementation((...args: unknown[]) => {
      const callbacks = args[3] as { onResult: (result: unknown) => void }
      queueMicrotask(() =>
        callbacks.onResult({
          picks: new Map([['head', { id: 'head:0001', name: 'Leather Helm', skills: [] }]]),
          decorations: new Map(),
          cuffs: [{ id: 'cuff:C001', name: 'Sharpening PC1', slotSize: 1, skills: [] }],
          skillTotals: new Map([[1, 5]]),
        }),
      )
      return 'req-1'
    })
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const onUseAsBase = vi.fn()
    const user = userEvent.setup()
    const encoded = await encodeSharedState(STATE)
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
    const worker = makeWorker()
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const onBackToSearch = vi.fn()
    const user = userEvent.setup()
    const encoded = await encodeSharedState(STATE)
    render(<ResultPage encoded={encoded} onUseAsBase={() => {}} onBackToSearch={onBackToSearch} />)

    await user.click(screen.getByRole('button', { name: /back to search/i }))

    expect(onBackToSearch).toHaveBeenCalledTimes(1)
  })

  it('shows an error for a link that fails to decode', async () => {
    const worker = makeWorker()
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    render(
      <ResultPage encoded="not-a-valid-encoded-payload" onUseAsBase={() => {}} onBackToSearch={() => {}} />,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(/corrupted/i)
  })
})
