import { render, screen, within } from '@testing-library/react'
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
  slots: [
    {
      slotId: 'head',
      candidates: [
        { id: 'head:0001', name: 'Leather Helm', skills: [], category: 'standard_plain' },
        { id: 'head:0002', name: 'White Cat Mask', skills: [], category: 'paid_premium_kit' },
      ],
    },
  ],
  decorations: [],
  cuffs: [
    {
      id: 'cuff:C001',
      name: 'Sharpening PC1',
      slotSize: 1,
      skills: [],
      category: 'cuff_premium_tier1',
    },
    {
      id: 'cuff:C002',
      name: 'Sharpening SC1',
      slotSize: 1,
      skills: [],
      category: 'cuff_standard_tier1',
    },
  ],
  skills: [{ id: 1, name: 'Attack', category: null, priorityRank: null, tiers: [] }],
  zenithSkills: [
    { id: 1000001, name: 'Dissolver Up', category: null, priorityRank: null, tiers: [] },
  ],
  skillNames: new Map([
    [1, 'Attack'],
    [1000001, 'Dissolver Up'],
  ]),
  weaponZenithSkillIds: [1000001],
}

// The weapon slot the search is called with when nothing's touched the new
// "Weapon" section -- every real Zenith skill starts excluded there (see
// App.tsx's `defaultExcludedWeaponZenithSkillIds`), so the sole candidate is
// the plain, no-Zenith-skill fallback at the default 0 reserved slots. Every
// existing assertion on the exact `slots` argument needs this appended now
// that the weapon slot always rides along.
const DEFAULT_WEAPON_SLOT = {
  slotId: 'weapon',
  candidates: [
    {
      id: 'weapon:none',
      name: 'Plain weapon (no Zenith skill)',
      category: 'weapon',
      skills: [],
      openSlotCount: 0,
    },
  ],
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
      [...BUNDLE.slots, DEFAULT_WEAPON_SLOT],
      [{ skillId: 1, minPoints: 1 }],
      BUNDLE.decorations,
      expect.objectContaining({
        onResult: expect.any(Function),
        onDone: expect.any(Function),
        onError: expect.any(Function),
      }),
      {
        preferExactMatches: false,
        skillTiers: [
          { skillId: 1, tierThresholds: [] },
          { skillId: 1000001, tierThresholds: [] },
        ],
      },
      // Premium cuffs are excluded by default (see App.tsx's
      // DEFAULT_EXCLUDED_CUFF_CATEGORIES) -- only the standard one passes.
      [BUNDLE.cuffs[1]],
    )
  })

  it("passes preferExactMatches and the bundle's skill tiers through once the toggle is checked", async () => {
    const worker = makeWorker()
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const user = userEvent.setup()
    render(<App />)

    await user.selectOptions(screen.getByRole('combobox', { name: /add a skill/i }), 'Attack')
    await user.click(screen.getByRole('checkbox', { name: /prefer exact matches/i }))
    await user.click(screen.getByRole('button', { name: /search/i }))

    expect(worker.search).toHaveBeenCalledWith(
      [...BUNDLE.slots, DEFAULT_WEAPON_SLOT],
      [{ skillId: 1, minPoints: 1 }],
      BUNDLE.decorations,
      expect.anything(),
      {
        preferExactMatches: true,
        skillTiers: [
          { skillId: 1, tierThresholds: [] },
          { skillId: 1000001, tierThresholds: [] },
        ],
      },
      [BUNDLE.cuffs[1]],
    )
  })

  it('excludes candidates whose gear-level category is unchecked from the search', async () => {
    const worker = makeWorker()
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const user = userEvent.setup()
    render(<App />)

    await user.selectOptions(screen.getByRole('combobox', { name: /add a skill/i }), 'Attack')
    await user.click(screen.getByRole('checkbox', { name: 'Premium Kit' }))
    await user.click(screen.getByRole('button', { name: /search/i }))

    expect(worker.search).toHaveBeenCalledWith(
      [{ slotId: 'head', candidates: [BUNDLE.slots[0].candidates[0]] }, DEFAULT_WEAPON_SLOT],
      [{ skillId: 1, minPoints: 1 }],
      BUNDLE.decorations,
      expect.anything(),
      expect.anything(),
      [BUNDLE.cuffs[1]],
    )
  })

  it('excludes premium cuffs from the search by default', async () => {
    const worker = makeWorker()
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const user = userEvent.setup()
    render(<App />)

    // Premium cuffs only equip while Poogie wears Premium clothes, a
    // precondition this app can't verify -- see App.tsx's
    // DEFAULT_EXCLUDED_CUFF_CATEGORIES. No cuff checkbox is touched here;
    // this is the out-of-the-box default.
    await user.selectOptions(screen.getByRole('combobox', { name: /add a skill/i }), 'Attack')
    await user.click(screen.getByRole('button', { name: /search/i }))

    expect(worker.search).toHaveBeenCalledWith(
      [...BUNDLE.slots, DEFAULT_WEAPON_SLOT],
      [{ skillId: 1, minPoints: 1 }],
      BUNDLE.decorations,
      expect.anything(),
      expect.anything(),
      [BUNDLE.cuffs[1]],
    )
  })

  it('includes premium cuffs once their category is checked back in', async () => {
    const worker = makeWorker()
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const user = userEvent.setup()
    render(<App />)

    await user.selectOptions(screen.getByRole('combobox', { name: /add a skill/i }), 'Attack')
    await user.click(screen.getByRole('checkbox', { name: 'Premium' }))
    await user.click(screen.getByRole('button', { name: /search/i }))

    expect(worker.search).toHaveBeenCalledWith(
      [...BUNDLE.slots, DEFAULT_WEAPON_SLOT],
      [{ skillId: 1, minPoints: 1 }],
      BUNDLE.decorations,
      expect.anything(),
      expect.anything(),
      BUNDLE.cuffs,
    )
  })

  it('excludes cuffs whose category is unchecked from the search', async () => {
    const worker = makeWorker()
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const user = userEvent.setup()
    render(<App />)

    await user.selectOptions(screen.getByRole('combobox', { name: /add a skill/i }), 'Attack')
    // Standard is included by default -- unchecking it (on top of Premium's
    // own exclude-by-default) leaves no cuff category enabled at all. Both
    // the gear-level and cuff filters have their own "Standard" leaf, so the
    // last match is the cuff one (Poogie cuffs renders after Gear levels).
    const standardCheckboxes = screen.getAllByRole('checkbox', { name: 'Standard' })
    await user.click(standardCheckboxes[standardCheckboxes.length - 1])
    await user.click(screen.getByRole('button', { name: /search/i }))

    expect(worker.search).toHaveBeenCalledWith(
      [...BUNDLE.slots, DEFAULT_WEAPON_SLOT],
      [{ skillId: 1, minPoints: 1 }],
      BUNDLE.decorations,
      expect.anything(),
      expect.anything(),
      [],
    )
  })

  it('excludes every weapon Zenith skill from the search by default', async () => {
    const worker = makeWorker()
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const user = userEvent.setup()
    render(<App />)

    // No weapon checkbox is touched here -- this is the out-of-the-box
    // default (see App.tsx's `defaultExcludedWeaponZenithSkillIds`), which
    // must change nothing about an existing search until the player opts a
    // skill in. DEFAULT_WEAPON_SLOT (asserted via BUNDLE.slots elsewhere)
    // already proves the sole candidate is the plain, no-Zenith-skill one.
    await user.selectOptions(screen.getByRole('combobox', { name: /add a skill/i }), 'Attack')
    await user.click(screen.getByRole('button', { name: /search/i }))

    expect(worker.search).toHaveBeenCalledWith(
      [...BUNDLE.slots, DEFAULT_WEAPON_SLOT],
      [{ skillId: 1, minPoints: 1 }],
      BUNDLE.decorations,
      expect.anything(),
      expect.anything(),
      [BUNDLE.cuffs[1]],
    )
  })

  it('includes a weapon Zenith skill once checked in, at the chosen slot count', async () => {
    const worker = makeWorker()
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const user = userEvent.setup()
    render(<App />)

    await user.selectOptions(screen.getByRole('combobox', { name: /add a skill/i }), 'Attack')
    await user.click(screen.getByRole('checkbox', { name: 'Dissolver Up' }))
    await user.selectOptions(screen.getByRole('combobox', { name: /weapon slots/i }), '2')
    await user.click(screen.getByRole('button', { name: /search/i }))

    expect(worker.search).toHaveBeenCalledWith(
      [
        ...BUNDLE.slots,
        {
          slotId: 'weapon',
          candidates: [
            {
              id: 'weapon:none',
              name: 'Plain weapon (no Zenith skill)',
              category: 'weapon',
              skills: [],
              openSlotCount: 2,
            },
            {
              id: 'weapon:1000001',
              name: 'Zenith weapon (Dissolver Up)',
              category: 'weapon',
              skills: [{ skillId: 1000001, points: 1 }],
              openSlotCount: 2,
            },
          ],
        },
      ],
      [{ skillId: 1, minPoints: 1 }],
      BUNDLE.decorations,
      expect.anything(),
      expect.anything(),
      [BUNDLE.cuffs[1]],
    )
  })

  it('enables the search button once a Zenith skill alone is picked', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByRole('button', { name: /search/i })).toBeDisabled()

    await user.selectOptions(
      screen.getByRole('combobox', { name: /add a zenith skill/i }),
      'Dissolver Up',
    )

    expect(screen.getByRole('button', { name: /search/i })).toBeEnabled()
  })

  it('combines normal and Zenith skill requirements into one search query', async () => {
    const worker = makeWorker()
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const user = userEvent.setup()
    render(<App />)

    await user.selectOptions(screen.getByRole('combobox', { name: /add a skill/i }), 'Attack')
    await user.selectOptions(
      screen.getByRole('combobox', { name: /add a zenith skill/i }),
      'Dissolver Up',
    )
    await user.click(screen.getByRole('button', { name: /search/i }))

    expect(worker.search).toHaveBeenCalledWith(
      [...BUNDLE.slots, DEFAULT_WEAPON_SLOT],
      [
        { skillId: 1, minPoints: 1 },
        { skillId: 1000001, minPoints: 1 },
      ],
      BUNDLE.decorations,
      expect.anything(),
      expect.anything(),
      [BUNDLE.cuffs[1]],
    )
  })

  it('renders a streamed result once the worker reports one', async () => {
    const worker = makeWorker()
    worker.search.mockImplementation((...args: unknown[]) => {
      const callbacks = args[3] as { onResult: (result: unknown) => void }
      callbacks.onResult({
        picks: new Map([['head', { id: 'head:0001', name: 'Leather Helm', skills: [] }]]),
        decorations: new Map(),
        cuffs: [],
        skillTotals: new Map([[1, 15]]),
      })
      return 'req-1'
    })
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const user = userEvent.setup()
    render(<App />)

    await user.selectOptions(screen.getByRole('combobox', { name: /add a skill/i }), 'Attack')
    await user.click(screen.getByRole('button', { name: /search/i }))

    const resultsList = await screen.findByRole('list', { name: /search results/i })
    expect(await within(resultsList).findByText(/leather helm/i)).toBeInTheDocument()
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
            cuffs: [],
            skillTotals: new Map([[1, 15]]),
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
