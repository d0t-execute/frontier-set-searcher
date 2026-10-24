import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
        {
          id: 'head:0001',
          name: 'Leather Helm',
          // Grants both catalog skills (not just whichever one a given test
          // happens to request) so every test's `minPoints: 1` requirement is
          // actually reachable -- needed once App.tsx started rejecting a
          // provably-unreachable search before ever calling the worker (see
          // feasibility.ts, docs/feedback.md Round 1 #14); a real empty-skills
          // fixture would otherwise make every search here "impossible."
          skills: [
            { skillId: 1, points: 5 },
            { skillId: 1000001, points: 5 },
          ],
          category: 'standard_plain',
          grankOrLater: false,
          hunterType: 'common',
          exoticSkillId: null,
          defenseMax: null,
          resistances: { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 },
        },
        {
          id: 'head:0002',
          name: 'White Cat Mask',
          skills: [],
          category: 'paid_premium_kit',
          grankOrLater: false,
          hunterType: 'common',
          exoticSkillId: null,
          defenseMax: null,
          resistances: { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 },
        },
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
    {
      id: 'cuff:C003',
      name: 'Lost Cuff',
      slotSize: 0,
      skills: [],
      category: 'cuff_standard_unavailable',
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
      grankOrLater: false,
      hunterType: 'common',
      exoticSkillId: null,
      defenseMax: null,
      resistances: { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 },
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

    await user.click(screen.getByRole('button', { name: 'Attack' }))

    expect(screen.getByRole('button', { name: /search/i })).toBeEnabled()
  })

  it('starts a worker search with the bundle and the chosen requirements', async () => {
    const worker = makeWorker()
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Attack' }))
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
        preferExactMatches: true,
        skillTiers: [
          { skillId: 1, tierThresholds: [] },
          { skillId: 1000001, tierThresholds: [] },
        ],
        pinnedCuffs: [],
        pinnedSlotDecorations: new Map(),
        resistanceFloors: [],
        excludedActiveSkillIds: [],
        pinnedCuffSkillIds: [],
        preferredCandidateIds: new Set(),
        preferredCategoryCounts: [],
        optionalSkillRequirements: [],
      },
      // The "Unavailable"-leaf cuff is excluded unconditionally (see build-
      // query.ts's `_UNOBTAINABLE_CUFF_CATEGORIES`) -- both real ones pass.
      [BUNDLE.cuffs[0], BUNDLE.cuffs[1]],
    )
  })

  it("stops passing preferExactMatches and the bundle's skill tiers once the toggle is unchecked", async () => {
    const worker = makeWorker()
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Attack' }))
    await user.click(screen.getByRole('checkbox', { name: /prefer exact matches/i }))
    await user.click(screen.getByRole('button', { name: /search/i }))

    expect(worker.search).toHaveBeenCalledWith(
      [...BUNDLE.slots, DEFAULT_WEAPON_SLOT],
      [{ skillId: 1, minPoints: 1 }],
      BUNDLE.decorations,
      expect.anything(),
      {
        preferExactMatches: false,
        skillTiers: [
          { skillId: 1, tierThresholds: [] },
          { skillId: 1000001, tierThresholds: [] },
        ],
        pinnedCuffs: [],
        pinnedSlotDecorations: new Map(),
        resistanceFloors: [],
        excludedActiveSkillIds: [],
        pinnedCuffSkillIds: [],
        preferredCandidateIds: new Set(),
        preferredCategoryCounts: [],
        optionalSkillRequirements: [],
      },
      [BUNDLE.cuffs[0], BUNDLE.cuffs[1]],
    )
  })

  it('passes a resistanceFloors entry once an element checkbox is checked', async () => {
    const worker = makeWorker()
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Attack' }))
    await user.click(screen.getByRole('checkbox', { name: 'Fire' }))
    await user.click(screen.getByRole('checkbox', { name: 'Dragon' }))
    await user.click(screen.getByRole('button', { name: /search/i }))

    expect(worker.search).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        resistanceFloors: [
          { element: 'fire', minTotal: 0 },
          { element: 'dragon', minTotal: 0 },
        ],
      }),
      expect.anything(),
    )
  })

  it('checking "All" under Resistances requires every element', async () => {
    const worker = makeWorker()
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Attack' }))
    await user.click(screen.getByRole('checkbox', { name: 'All resistances' }))
    await user.click(screen.getByRole('button', { name: /search/i }))

    expect(worker.search).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        resistanceFloors: [
          { element: 'fire', minTotal: 0 },
          { element: 'water', minTotal: 0 },
          { element: 'thunder', minTotal: 0 },
          { element: 'ice', minTotal: 0 },
          { element: 'dragon', minTotal: 0 },
        ],
      }),
      expect.anything(),
    )
  })

  it('unchecking "All" under Resistances after every element was checked clears them all', async () => {
    const worker = makeWorker()
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Attack' }))
    await user.click(screen.getByRole('checkbox', { name: 'All resistances' }))
    await user.click(screen.getByRole('checkbox', { name: 'All resistances' }))
    await user.click(screen.getByRole('button', { name: /search/i }))

    expect(worker.search).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ resistanceFloors: [] }),
      expect.anything(),
    )
  })

  it('passes an excluded skill to the solver as excludedActiveSkillIds, not a pool filter (docs/skill-system-roadmap.md TODO #37)', async () => {
    const worker = makeWorker()
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const user = userEvent.setup()
    render(<App />)

    // Requires a different skill (Dissolver Up) than the one excluded
    // (Attack), so this isn't a contradictory search.
    await user.click(screen.getByRole('button', { name: 'Dissolver Up' }))
    await user.click(screen.getByRole('button', { name: /exclusions/i }))
    await user.type(screen.getByLabelText('Search skills to exclude'), 'Attack{Enter}')
    await user.click(screen.getByRole('button', { name: /search/i }))

    expect(worker.search).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ excludedActiveSkillIds: [1] }),
      expect.anything(),
    )
    // Still fully eligible in the free candidate pool -- only the solver
    // constraint changed, not what's offered.
    expect(worker.search).toHaveBeenCalledWith(
      [...BUNDLE.slots, expect.anything()],
      expect.anything(),
      BUNDLE.decorations,
      expect.anything(),
      expect.anything(),
      [BUNDLE.cuffs[0], BUNDLE.cuffs[1]],
    )
  })

  it('excludes candidates whose gear-level category is unchecked from the search', async () => {
    const worker = makeWorker()
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Attack' }))
    await user.click(screen.getByRole('button', { name: 'Expand Premium Kit' }))
    await user.click(screen.getByRole('checkbox', { name: 'Premium Kit' }))
    await user.click(screen.getByRole('button', { name: /search/i }))

    expect(worker.search).toHaveBeenCalledWith(
      [{ slotId: 'head', candidates: [BUNDLE.slots[0].candidates[0]] }, DEFAULT_WEAPON_SLOT],
      [{ skillId: 1, minPoints: 1 }],
      BUNDLE.decorations,
      expect.anything(),
      expect.anything(),
      [BUNDLE.cuffs[0], BUNDLE.cuffs[1]],
    )
  })

  it('includes premium cuffs in the search by default', async () => {
    const worker = makeWorker()
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const user = userEvent.setup()
    render(<App />)

    // No cuff checkbox is touched here -- this is the out-of-the-box default.
    await user.click(screen.getByRole('button', { name: 'Attack' }))
    await user.click(screen.getByRole('button', { name: /search/i }))

    expect(worker.search).toHaveBeenCalledWith(
      [...BUNDLE.slots, DEFAULT_WEAPON_SLOT],
      [{ skillId: 1, minPoints: 1 }],
      BUNDLE.decorations,
      expect.anything(),
      expect.anything(),
      [BUNDLE.cuffs[0], BUNDLE.cuffs[1]],
    )
  })

  it('excludes an unavailable-leaf cuff from the search unconditionally', async () => {
    const worker = makeWorker()
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const user = userEvent.setup()
    render(<App />)

    // A piece/cuff that's unobtainable in the real game is never worth
    // surfacing -- see build-query.ts's `_UNOBTAINABLE_CUFF_CATEGORIES`; it's
    // not even a toggle in the UI (no checkbox touched here).
    await user.click(screen.getByRole('button', { name: 'Attack' }))
    await user.click(screen.getByRole('button', { name: /search/i }))

    expect(worker.search).toHaveBeenCalledWith(
      [...BUNDLE.slots, DEFAULT_WEAPON_SLOT],
      [{ skillId: 1, minPoints: 1 }],
      BUNDLE.decorations,
      expect.anything(),
      expect.anything(),
      expect.not.arrayContaining([BUNDLE.cuffs[2]]),
    )
  })

  it('excludes cuffs whose category is unchecked from the search', async () => {
    const worker = makeWorker()
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Attack' }))
    // Standard is included by default -- unchecking it leaves only the
    // Premium cuff enabled. Both the gear-category and cuff filters have
    // their own "Standard" leaf, so the last match is the cuff one (Poogie
    // Cuff Categories renders after Gear categories).
    const standardCheckboxes = screen.getAllByRole('checkbox', { name: 'Standard' })
    await user.click(standardCheckboxes[standardCheckboxes.length - 1])
    await user.click(screen.getByRole('button', { name: /search/i }))

    expect(worker.search).toHaveBeenCalledWith(
      [...BUNDLE.slots, DEFAULT_WEAPON_SLOT],
      [{ skillId: 1, minPoints: 1 }],
      BUNDLE.decorations,
      expect.anything(),
      expect.anything(),
      [BUNDLE.cuffs[0]],
    )
  })

  it('passes a pinned cuff as pinnedCuffs once picked, resolved to its full data', async () => {
    const worker = makeWorker()
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Attack' }))
    await user.type(
      screen.getByLabelText('Search cuffs for Cuff slot 1'),
      BUNDLE.cuffs[0].name.slice(0, 4),
    )
    await user.click(screen.getByRole('option', { name: BUNDLE.cuffs[0].name }))
    await user.click(screen.getByRole('button', { name: /search/i }))

    expect(worker.search).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ pinnedCuffs: [BUNDLE.cuffs[0]] }),
      expect.anything(),
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
    await user.click(screen.getByRole('button', { name: 'Attack' }))
    await user.click(screen.getByRole('button', { name: /search/i }))

    expect(worker.search).toHaveBeenCalledWith(
      [...BUNDLE.slots, DEFAULT_WEAPON_SLOT],
      [{ skillId: 1, minPoints: 1 }],
      BUNDLE.decorations,
      expect.anything(),
      expect.anything(),
      [BUNDLE.cuffs[0], BUNDLE.cuffs[1]],
    )
  })

  it('includes a weapon Zenith skill once checked in, at the chosen slot count', async () => {
    const worker = makeWorker()
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Attack' }))
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
              grankOrLater: false,
              hunterType: 'common',
              exoticSkillId: null,
              defenseMax: null,
              resistances: { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 },
              skills: [],
              openSlotCount: 2,
            },
            {
              id: 'weapon:1000001',
              name: 'Zenith weapon (Dissolver Up)',
              category: 'weapon',
              grankOrLater: false,
              hunterType: 'common',
              exoticSkillId: null,
              defenseMax: null,
              resistances: { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 },
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
      [BUNDLE.cuffs[0], BUNDLE.cuffs[1]],
    )
  })

  it('enables the search button once a Zenith skill alone is picked', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByRole('button', { name: /search/i })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Dissolver Up' }))

    expect(screen.getByRole('button', { name: /search/i })).toBeEnabled()
  })

  it('combines normal and Zenith skill requirements into one search query', async () => {
    const worker = makeWorker()
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Attack' }))
    await user.click(screen.getByRole('button', { name: 'Dissolver Up' }))
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
      [BUNDLE.cuffs[0], BUNDLE.cuffs[1]],
    )
  })

  it('renders a streamed result once the worker reports one', async () => {
    const worker = makeWorker()
    worker.search.mockImplementation((...args: unknown[]) => {
      const callbacks = args[3] as { onResult: (result: unknown) => void }
      callbacks.onResult({
        picks: new Map([
          [
            'head',
            {
              id: 'head:0001',
              name: 'Leather Helm',
              skills: [],
              defenseMax: null,
              resistances: { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 },
            },
          ],
        ]),
        decorations: new Map(),
        cuffs: [],
        skillTotals: new Map([[1, 15]]),
      })
      return 'req-1'
    })
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Attack' }))
    await user.click(screen.getByRole('button', { name: /search/i }))

    const resultsList = await screen.findByRole('list', { name: /search results/i })
    expect(await within(resultsList).findByText(/leather helm/i)).toBeInTheDocument()
  })

  it('produces a shareable link that decodes back to the search that produced it', async () => {
    const worker = makeWorker()
    worker.search.mockImplementation((...args: unknown[]) => {
      const callbacks = args[3] as { onResult: (result: unknown) => void }
      callbacks.onResult({
        picks: new Map([
          [
            'head',
            {
              id: 'head:0001',
              name: 'Leather Helm',
              skills: [],
              defenseMax: 10,
              resistances: { fire: 4, water: -1, thunder: 0, ice: 3, dragon: 2 },
            },
          ],
        ]),
        decorations: new Map(),
        cuffs: [],
        skillTotals: new Map([[1, 15]]),
      })
      return 'req-1'
    })
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Attack' }))
    await user.click(screen.getByRole('button', { name: /search/i }))
    await screen.findByRole('list', { name: /search results/i })
    await user.click(screen.getByRole('button', { name: /get shareable link/i }))

    const link = await screen.findByRole('textbox', { name: /shareable link/i })
    const url = (link as HTMLInputElement).value
    expect(url).toContain('#/result/')

    const { decodeSharedState, encodedResultFromLocation } =
      await import('./search-engine/shared-state')
    window.location.hash = new URL(url).hash
    const decoded = await decodeSharedState(encodedResultFromLocation()!)
    expect(decoded?.requirements).toEqual([{ skillId: 1, minPoints: 1 }])
    expect(decoded?.preferExactMatches).toBe(true)
    expect(decoded?.result.picks).toEqual([
      {
        slotId: 'head',
        id: 'head:0001',
        name: 'Leather Helm',
        openSlotCount: null,
        grankOrLater: null,
        exoticSkillId: null,
        defenseMax: 10,
        resistances: { fire: 4, water: -1, thunder: 0, ice: 3, dragon: 2 },
      },
    ])
  })

  it('re-sorts streamed results by total defense when asked (docs/feedback.md Round 2 #3)', async () => {
    const worker = makeWorker()
    worker.search.mockImplementation((...args: unknown[]) => {
      const callbacks = args[3] as { onResult: (result: unknown) => void }
      callbacks.onResult({
        picks: new Map([
          [
            'head',
            {
              id: 'head:low',
              name: 'Low Defense Helm',
              skills: [],
              defenseMax: 10,
              resistances: { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 },
            },
          ],
        ]),
        decorations: new Map(),
        cuffs: [],
        skillTotals: new Map([[1, 15]]),
      })
      callbacks.onResult({
        picks: new Map([
          [
            'head',
            {
              id: 'head:high',
              name: 'High Defense Helm',
              skills: [],
              defenseMax: 100,
              resistances: { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 },
            },
          ],
        ]),
        decorations: new Map(),
        cuffs: [],
        skillTotals: new Map([[1, 15]]),
      })
      return 'req-1'
    })
    mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Attack' }))
    await user.click(screen.getByRole('button', { name: /search/i }))

    const resultsList = await screen.findByRole('list', { name: /search results/i })
    await within(resultsList).findByText(/low defense helm/i)

    // Default order is the solver's own ranking: low-defense result first,
    // since it streamed in first.
    let cards = within(resultsList).getAllByRole('listitem')
    expect(cards[0]).toHaveTextContent(/low defense helm/i)
    expect(cards[1]).toHaveTextContent(/high defense helm/i)

    await user.selectOptions(screen.getByLabelText('Sort by'), 'Total defense (highest first)')

    cards = within(resultsList).getAllByRole('listitem')
    expect(cards[0]).toHaveTextContent(/high defense helm/i)
    expect(cards[1]).toHaveTextContent(/low defense helm/i)
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
            picks: new Map([
              [
                'head',
                {
                  id: `head:${i}`,
                  name: `Helm ${i}`,
                  skills: [],
                  defenseMax: null,
                  resistances: { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 },
                },
              ],
            ]),
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

    await user.click(screen.getByRole('button', { name: 'Attack' }))
    await user.click(screen.getByRole('button', { name: /search/i }))

    // A query that could stream thousands of results against the real
    // dataset (confirmed by manual testing) must not render all of them --
    // see MAX_RESULTS in App.tsx.
    expect(await screen.findByText(/showing the top/i)).toBeInTheDocument()
    expect(screen.getAllByText(/helm \d+/i).length).toBeLessThan(25)
    expect(worker.cancel).toHaveBeenCalledWith('req-1')
  })

  describe('preferred pieces (docs/feedback.md Round 2 #2)', () => {
    it('passes a preferred piece straight through to the solver as preferredCandidateIds', async () => {
      const worker = makeWorker()
      mockUseSearchWorker.mockReturnValue(worker as unknown as ReturnType<typeof useSearchWorker>)
      const user = userEvent.setup()
      render(<App />)

      await user.click(screen.getByRole('button', { name: /preferred pieces/i }))
      await user.type(screen.getByLabelText('Search armor pieces to prefer'), 'White Cat')
      await user.click(screen.getByRole('option', { name: 'White Cat Mask' }))

      await user.click(screen.getByRole('button', { name: 'Attack' }))
      await user.click(screen.getByRole('button', { name: /search/i }))

      expect(worker.search).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ preferredCandidateIds: new Set(['head:0002']) }),
        expect.anything(),
      )
    })

    it('shows a preferred piece as a badge, removable without affecting pinned armor', async () => {
      const user = userEvent.setup()
      render(<App />)

      await user.click(screen.getByRole('button', { name: /preferred pieces/i }))
      await user.type(screen.getByLabelText('Search armor pieces to prefer'), 'White Cat')
      await user.click(screen.getByRole('option', { name: 'White Cat Mask' }))

      expect(screen.getByText('White Cat Mask')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Remove White Cat Mask' }))

      expect(
        screen.queryByRole('button', { name: 'Remove White Cat Mask' }),
      ).not.toBeInTheDocument()
    })
  })

  describe('active-skill cap preview (docs/feedback.md Round 2 #4)', () => {
    it('shows the baseline cap of 10 before any selection is made', () => {
      render(<App />)

      const preview = screen.getByText(/highest active-skill cap still reachable from here:/i)
      expect(preview).toHaveTextContent('10')
    })

    it('lowers the reachable cap once a selected skill claims the only slot that could otherwise go to Skill Slots Up', async () => {
      // Chest is the *only* slot that can grant "Dissolver Up" here, and it's
      // also the only slot that can grant "Skill Slots Up" -- two different
      // physical pieces competing for the same armor slot, not two skills on
      // one piece (this game's gear never grants more than one Zenith skill
      // per piece). Selecting Dissolver Up should claim that slot, dropping
      // the ceiling by the 2 points of Skill Slots Up it could have otherwise
      // provided -- the project owner's correction (2026-10-19) to the first
      // version of this preview, which instead showed the cap of whatever was
      // *already* equipped/selected rather than the highest still reachable.
      const bundleWithCompetingChestSlot = {
        ...BUNDLE,
        slots: [
          {
            slotId: 'head',
            candidates: [
              {
                ...BUNDLE.slots[0].candidates[0],
                // Head keeps its normal-skill grant (so it can still satisfy
                // "Attack" elsewhere), but not its Dissolver Up grant -- this
                // test needs chest to be the *only* slot that can grant it.
                skills: [{ skillId: 1, points: 5 }],
              },
              BUNDLE.slots[0].candidates[1],
            ],
          },
          {
            slotId: 'chest',
            candidates: [
              {
                id: 'chest:0001',
                name: 'Dissolver Chest',
                skills: [{ skillId: 1000001, points: 1 }],
                category: 'zenith_plain',
                grankOrLater: false,
                hunterType: 'common',
                exoticSkillId: null,
                defenseMax: null,
                resistances: { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 },
              },
              {
                id: 'chest:0002',
                name: 'Slots Up Chest',
                skills: [{ skillId: 1000002, points: 2 }],
                category: 'zenith_plain',
                grankOrLater: false,
                hunterType: 'common',
                exoticSkillId: null,
                defenseMax: null,
                resistances: { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 },
              },
              {
                id: 'chest:0003',
                name: 'Plain Chest',
                skills: [],
                category: 'standard_plain',
                grankOrLater: false,
                hunterType: 'common',
                exoticSkillId: null,
                defenseMax: null,
                resistances: { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 },
              },
            ],
          },
        ],
        zenithSkills: [
          ...BUNDLE.zenithSkills,
          { id: 1000002, name: 'Skill Slots Up', category: null, priorityRank: null, tiers: [] },
        ],
      }
      mockUseDataBundle.mockReturnValue({
        isLoading: false,
        isError: false,
        data: bundleWithCompetingChestSlot,
      } as unknown as ReturnType<typeof useDataBundle>)
      const user = userEvent.setup()
      render(<App />)

      const preview = screen.getByText(/highest active-skill cap still reachable from here:/i)
      expect(preview).toHaveTextContent('12')

      await user.click(screen.getByRole('button', { name: 'Dissolver Up' }))

      expect(preview).toHaveTextContent('10')
    })
  })

  describe('gear-level quick toggles (docs/feedback.md Round 2 #6)', () => {
    it('unchecking the top-level Zenith toggle excludes every Zenith leaf, including the new ZF split', async () => {
      const user = userEvent.setup()
      render(<App />)

      await user.click(screen.getByRole('button', { name: /gear categories/i }))
      await user.click(screen.getByRole('checkbox', { name: 'Zenith gear level' }))
      // Expand every group/section the assertions below reach into -- the
      // quick toggle itself works across collapsed trees (it only touches
      // `excludedCategories`), but a collapsed leaf isn't in the DOM to
      // query against (see CategoryFilter.tsx's own collapse behavior).
      await user.click(screen.getByRole('button', { name: 'Expand Zenith Armor' }))
      await user.click(screen.getByRole('button', { name: "Expand Hunter's Road" }))
      await user.click(screen.getByRole('button', { name: 'Expand Event Armor' }))
      await user.click(screen.getByRole('button', { name: 'Expand Event Armor: Event' }))
      await user.click(screen.getByRole('button', { name: 'Expand Guild' }))
      await user.click(screen.getByRole('button', { name: 'Expand Guild: Base' }))
      await user.click(screen.getByRole('button', { name: 'Expand G Rank Armor' }))
      await user.click(screen.getByRole('button', { name: 'Expand G Rank Armor: Base' }))

      expect(screen.getByRole('checkbox', { name: 'Zenith' })).not.toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Road Zenith ZF' })).not.toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Event Zenith ZF' })).not.toBeChecked()
      // Pre-G-Rank and G-Rank leaves are untouched.
      expect(screen.getByRole('checkbox', { name: 'Guild' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Origin' })).toBeChecked()
    })

    it('shows the G-Rank toggle as indeterminate once one of its leaves is excluded, and re-checking it re-includes everything', async () => {
      const user = userEvent.setup()
      render(<App />)

      await user.click(screen.getByRole('button', { name: /gear categories/i }))
      await user.click(screen.getByRole('button', { name: 'Expand G Rank Armor' }))
      await user.click(screen.getByRole('button', { name: 'Expand G Rank Armor: Base' }))
      await user.click(screen.getByRole('checkbox', { name: 'Origin' }))

      const grankToggle = screen.getByRole('checkbox', {
        name: 'G-Rank gear level',
      }) as HTMLInputElement
      expect(grankToggle.indeterminate).toBe(true)

      await user.click(grankToggle)

      expect(screen.getByRole('checkbox', { name: 'Origin' })).toBeChecked()
    })

    it('unchecking the top-level ZP toggle excludes every ZP leaf but leaves Zenith and G-Rank untouched (2026-10-20: ZP split into its own tier)', async () => {
      const user = userEvent.setup()
      render(<App />)

      await user.click(screen.getByRole('button', { name: /gear categories/i }))
      await user.click(screen.getByRole('checkbox', { name: 'ZP gear level' }))
      await user.click(screen.getByRole('button', { name: 'Expand Premium Kit' }))
      await user.click(screen.getByRole('button', { name: 'Expand Zenith Armor' }))
      await user.click(screen.getByRole('button', { name: 'Expand G Rank Armor' }))
      await user.click(screen.getByRole('button', { name: 'Expand G Rank Armor: Base' }))

      expect(screen.getByRole('checkbox', { name: 'Premium Kit ZP' })).not.toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Zenith' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Origin' })).toBeChecked()
    })
  })

  describe('"Pin specific armor" scoping (docs/skill-system-roadmap.md #33/#35)', () => {
    it('excludes a piece from an excluded gear-level category from the piece search', async () => {
      const user = userEvent.setup()
      render(<App />)

      await user.click(screen.getByRole('button', { name: /gear categories/i }))
      await user.click(screen.getByRole('button', { name: 'Expand Premium Kit' }))
      await user.click(screen.getByRole('checkbox', { name: 'Premium Kit' }))

      await user.click(screen.getByRole('button', { name: /pin specific armor/i }))
      await user.type(screen.getByLabelText('Search pieces for head'), 'Mask')

      expect(screen.getByText('No matches.')).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: 'White Cat Mask' })).not.toBeInTheDocument()
    })

    it('still searches/pins a piece from a category not excluded', async () => {
      const user = userEvent.setup()
      render(<App />)

      await user.click(screen.getByRole('button', { name: /gear categories/i }))
      await user.click(screen.getByRole('button', { name: 'Expand Premium Kit' }))
      await user.click(screen.getByRole('checkbox', { name: 'Premium Kit' }))

      await user.click(screen.getByRole('button', { name: /pin specific armor/i }))
      await user.type(screen.getByLabelText('Search pieces for head'), 'Leather')

      expect(screen.getByRole('option', { name: 'Leather Helm' })).toBeInTheDocument()
    })

    it('excludes a piece restricted to the other Hunter Type from the piece search', async () => {
      const bundleWithGunnerPiece = {
        ...BUNDLE,
        slots: [
          {
            ...BUNDLE.slots[0],
            candidates: [
              ...BUNDLE.slots[0].candidates,
              {
                id: 'head:0003',
                name: 'Gunner Only Mask',
                skills: [],
                category: 'standard_plain',
                grankOrLater: false,
                hunterType: 'gunner',
                exoticSkillId: null,
                defenseMax: null,
                resistances: { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 },
              },
            ],
          },
        ],
      }
      mockUseDataBundle.mockReturnValue({
        isLoading: false,
        isError: false,
        data: bundleWithGunnerPiece,
      } as unknown as ReturnType<typeof useDataBundle>)
      const user = userEvent.setup()
      render(<App />) // Hunter Type defaults to Blademaster.

      await user.click(screen.getByRole('button', { name: /pin specific armor/i }))
      await user.type(screen.getByLabelText('Search pieces for head'), 'Gunner')

      expect(screen.getByText('No matches.')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Gunner' }))

      expect(screen.getByRole('option', { name: 'Gunner Only Mask' })).toBeInTheDocument()
    })

    it('keeps an already-pinned piece visible after its category is excluded', async () => {
      const user = userEvent.setup()
      render(<App />)

      await user.click(screen.getByRole('button', { name: /pin specific armor/i }))
      await user.type(screen.getByLabelText('Search pieces for head'), 'Mask')
      await user.click(screen.getByRole('option', { name: 'White Cat Mask' }))

      expect(screen.getByText('White Cat Mask')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /gear categories/i }))
      await user.click(screen.getByRole('button', { name: 'Expand Premium Kit' }))
      await user.click(screen.getByRole('checkbox', { name: 'Premium Kit' }))

      expect(screen.getByText('White Cat Mask')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument()
    })

    it("resolves a piece's Zenith skill contribution to its real name in the hover summary", async () => {
      const user = userEvent.setup()
      render(<App />)

      await user.click(screen.getByRole('button', { name: /pin specific armor/i }))
      await user.type(screen.getByLabelText('Search pieces for head'), 'Leather')
      await user.hover(screen.getByRole('option', { name: 'Leather Helm' }))

      // Leather Helm grants both a normal skill (Attack) and a Zenith skill
      // (Dissolver Up, id 1000001) -- before this fix, ArmorPicker built its
      // skill-name lookup from `bundle.skills` alone, so the Zenith
      // contribution fell back to "Skill 1000001" instead of its real name.
      expect(screen.getByText('Attack: 5')).toBeInTheDocument()
      expect(screen.getByText(/Dissolver Up: 5/)).toBeInTheDocument()
      expect(screen.queryByText(/Skill 1000001/)).not.toBeInTheDocument()
    })
  })

  describe('Reset button', () => {
    afterEach(() => localStorage.clear())

    it('clears the saved form state and reloads the page', async () => {
      localStorage.setItem(
        'frontier-set-searcher:search-form-state:v1',
        JSON.stringify({ hunterTypeFilter: 'gunner' }),
      )
      // jsdom's `window.location.reload` isn't configurable, so it can't be
      // spied on directly -- replace the whole `location` object instead,
      // same workaround jsdom itself recommends for this method.
      const originalLocation = window.location
      const reload = vi.fn()
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...originalLocation, reload },
      })
      const user = userEvent.setup()
      render(<App />)

      await user.click(screen.getByRole('button', { name: 'Reset' }))

      expect(localStorage.getItem('frontier-set-searcher:search-form-state:v1')).toBeNull()
      expect(reload).toHaveBeenCalled()
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
    })
  })
})
