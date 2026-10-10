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
    queryFn: () => loadBundle('/data', (url) => fetch(url)),
    staleTime: Infinity,
  })
}
