import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDataBundle } from './useDataBundle'

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useDataBundle', () => {
  it('loads the bundle from /data and exposes it once ready', async () => {
    const files: Record<string, unknown> = {
      '/data/manifest.json': { formatVersion: 1, slotTypes: ['head'] },
      '/data/skills.json': [{ id: 1, name: 'Attack', category: null }],
      '/data/decorations.json': [],
      '/data/equipment/head.json': [{ id: 'head:0001', name: 'Leather Helm', skills: [] }],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(files[url]) }),
      ),
    )

    const { result } = renderHook(() => useDataBundle(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data?.slots.map((s) => s.slotId)).toEqual(['head'])
    expect(result.current.data?.skillNames.get(1)).toBe('Attack')
  })

  it('surfaces a failure when the bundle fails to load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.reject() })),
    )

    const { result } = renderHook(() => useDataBundle(), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
