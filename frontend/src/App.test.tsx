import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { useDataBundle } from './data/useDataBundle'
import { useSearchWorker } from './search/useSearchWorker'

vi.mock('./data/useDataBundle')
vi.mock('./search/useSearchWorker')

const mockUseDataBundle = vi.mocked(useDataBundle)
const mockUseSearchWorker = vi.mocked(useSearchWorker)

const BUNDLE = {
  slots: [{ slotId: 'head', candidates: [{ id: 'head:0001', name: 'Leather Helm', skills: [] }] }],
  decorations: [],
  skillNames: new Map([[1, 'Attack']]),
}

function makeWorker() {
  return {
    search: vi.fn(() => 'req-1'),
    cancel: vi.fn(),
  }
}

beforeEach(() => {
  mockUseDataBundle.mockReturnValue({
    isLoading: false,
    isError: false,
    data: BUNDLE,
  } as unknown as ReturnType<typeof useDataBundle>)
  mockUseSearchWorker.mockReturnValue(makeWorker() as unknown as ReturnType<typeof useSearchWorker>)
})

describe('App', () => {
  it('renders the project heading', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /frontier set searcher/i })).toBeInTheDocument()
  })

  it('shows a loading message while the data bundle is loading', () => {
    mockUseDataBundle.mockReturnValue({
      isLoading: true,
      isError: false,
      data: undefined,
    } as unknown as ReturnType<typeof useDataBundle>)

    render(<App />)

    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /search/i })).not.toBeInTheDocument()
  })

  it('shows an error message when the data bundle fails to load', () => {
    mockUseDataBundle.mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
    } as unknown as ReturnType<typeof useDataBundle>)

    render(<App />)

    expect(screen.getByText(/couldn.t load|failed to load/i)).toBeInTheDocument()
  })

  it('disables the search button until at least one skill is picked', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByRole('button', { name: /search/i })).toBeDisabled()

    await user.selectOptions(screen.getByRole('combobox', { name: /add a skill/i }), 'Attack')

    expect(screen.getByRole('button', { name: /search/i })).toBeEnabled()
  })

  it('starts a worker search with the bundle and the chosen requirements', async () => {
    const worker = makeWorker()
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const user = userEvent.setup()
    render(<App />)

    await user.selectOptions(screen.getByRole('combobox', { name: /add a skill/i }), 'Attack')
    await user.click(screen.getByRole('button', { name: /search/i }))

    expect(worker.search).toHaveBeenCalledWith(
      BUNDLE.slots,
      [{ skillId: 1, minPoints: 1 }],
      BUNDLE.decorations,
      expect.objectContaining({
        onResult: expect.any(Function),
        onDone: expect.any(Function),
        onError: expect.any(Function),
      }),
    )
  })

  it('renders a streamed result once the worker reports one', async () => {
    const worker = makeWorker()
    worker.search.mockImplementation((...args: unknown[]) => {
      const callbacks = args[3] as { onResult: (result: unknown) => void }
      callbacks.onResult({
        picks: new Map([['head', { id: 'head:0001', name: 'Leather Helm', skills: [] }]]),
        decorations: new Map(),
        skillTotals: new Map([[1, 15]]),
        surplus: 5,
      })
      return 'req-1'
    })
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const user = userEvent.setup()
    render(<App />)

    await user.selectOptions(screen.getByRole('combobox', { name: /add a skill/i }), 'Attack')
    await user.click(screen.getByRole('button', { name: /search/i }))

    expect(await screen.findByText(/leather helm/i)).toBeInTheDocument()
  })

  it('stops the search and reports a capped result set once enough results have streamed in', async () => {
    const worker = makeWorker()
    worker.search.mockImplementation((...args: unknown[]) => {
      const callbacks = args[3] as { onResult: (result: unknown) => void }
      // Deferred, like the real worker's postMessage-based callbacks (never
      // synchronous) -- App.tsx's cap check relies on `search()`'s returned
      // request id already being assigned by the time a result arrives.
      queueMicrotask(() => {
        for (let i = 0; i < 25; i++) {
          callbacks.onResult({
            picks: new Map([['head', { id: `head:${i}`, name: `Helm ${i}`, skills: [] }]]),
            decorations: new Map(),
            skillTotals: new Map([[1, 15]]),
            surplus: 5,
          })
        }
      })
      return 'req-1'
    })
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const user = userEvent.setup()
    render(<App />)

    await user.selectOptions(screen.getByRole('combobox', { name: /add a skill/i }), 'Attack')
    await user.click(screen.getByRole('button', { name: /search/i }))

    // A query that could stream thousands of results against the real
    // dataset (confirmed by manual testing) must not render all of them --
    // see MAX_RESULTS in App.tsx.
    expect(await screen.findByText(/showing the top/i)).toBeInTheDocument()
    expect(screen.getAllByText(/helm \d+/i).length).toBeLessThan(25)
    expect(worker.cancel).toHaveBeenCalledWith('req-1')
  })
})
