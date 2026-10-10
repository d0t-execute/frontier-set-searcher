/**
 * The search engine's own `BuildResult` is deliberately decoupled from
 * display names (see search-engine/types.ts) -- but every `Candidate`/
 * `Decoration` actually flowing through this app comes from the loaded data
 * bundle, which always carries one (see load-bundle.ts's `NamedCandidate`/
 * `NamedDecoration`). This narrower type is what the UI renders against;
 * the one cast from `BuildResult` to it lives where results come back from
 * the worker (App.tsx), not scattered through every component.
 */

import type { NamedCandidate, NamedDecoration } from '../search-engine/load-bundle'
import type { SkillId } from '../search-engine/types'

export interface NamedBuildResult {
  readonly picks: ReadonlyMap<string, NamedCandidate>
  readonly decorations: ReadonlyMap<string, readonly NamedDecoration[]>
  readonly skillTotals: ReadonlyMap<SkillId, number>
  readonly surplus: number
}
