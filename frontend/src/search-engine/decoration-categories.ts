/**
 * Display tree for the decoration tier category filter -- same pattern as
 * `gear-categories.ts`/`cuff-categories.ts` (see their own docstrings), but
 * for decorations (docs/skill-system-roadmap.md TODO #11). Decorations only
 * carry one machine-readable axis today, `NamedDecoration.isTower` (see
 * `build-query.ts`'s `decorationsAfterCategoryFilter`), so this starts as a
 * single toggle rather than the richer multi-group tree armor/cuffs have --
 * a fuller decoration category taxonomy would add more groups here, not
 * change how this filter plugs in.
 */

import type { GearCategoryGroup } from './gear-categories'

/** The category key `decorationsAfterCategoryFilter` maps `isTower: true`
 * decorations to. */
export const TOWER_DECORATION_CATEGORY_KEY = 'tower'

export const DECORATION_CATEGORY_GROUPS: readonly GearCategoryGroup[] = [
  {
    label: 'Decoration tier',
    categories: [{ key: TOWER_DECORATION_CATEGORY_KEY, label: 'Tower Gems' }],
  },
]
