/**
 * Loads the static data bundle once per app session (see docs/PLAN.md §5
 * "TanStack Query (for loading the static data bundle)"). The bundle is
 * versioned and published alongside the app build, so it never needs an
 * automatic refetch -- `staleTime: Infinity` just means "trust this for the
 * lifetime of the page," not "never reload after a deploy" (a fresh page
 * load always gets whatever bundle shipped with that build).
 */

import { useQuery } from '@tanstack/react-query'
import { loadBundle } from '../search-engine/load-bundle'

export function useDataBundle() {
  return useQuery({
    queryKey: ['data-bundle'],
    // `import.meta.env.BASE_URL` (Vite's own `base` config, see
    // vite.config.ts) rather than a hardcoded `/data` -- a project page on
    // GitHub Pages serves this app from a subpath
    // (`/frontier-set-searcher/`, not `/`), and a root-absolute path would
    // 404 there even though it works fine in local dev at the root.
    queryFn: () => loadBundle(`${import.meta.env.BASE_URL}data`, (url) => fetch(url)),
    staleTime: Infinity,
  })
}
