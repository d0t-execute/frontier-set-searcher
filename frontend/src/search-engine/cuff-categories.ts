/**
 * Display tree for the cuff category filter -- same pattern as
 * `gear-categories.ts` (see its own docstring), but for `Cuff.category`
 * instead of `Candidate.category` (see docs/gear-category-taxonomy.md's
 * "Tree 2"). Split into "Premium" and "Standard" groups, matching the game's
 * own Premium-vs-Standard Poogie-clothes distinction that motivated cuff
 * category support in the first place (premium cuffs only equip with
 * premium clothes; standard ones always do) -- Hiden cuffs sit outside that
 * distinction entirely (confirmed by the project owner), so they get their
 * own group rather than living under either side.
 *
 * Display labels are English descriptions of each leaf's rule, not the
 * reference tool's own (unconfirmed) label text -- see the taxonomy doc's
 * note that only the `cuff_*` category keys themselves, not their eventual
 * display label, have been verified against the real dataset.
 *
 * The "Unavailable"/"Training Only" leaves (`cuff_premium_unavailable`,
 * `cuff_standard_unavailable`, `cuff_standard_training_only`) are deliberately
 * not leaves in this tree at all (2026-10-20, per the project owner) -- same
 * not-a-leaf-at-all, unconditionally-excluded treatment equipment's own
 * "Unavailable" categories already got, rather than left as a default-off-but-
 * togglable choice -- see `_UNOBTAINABLE_CUFF_CATEGORIES` in build-query.ts.
 */

import type { GearCategoryGroup } from './gear-categories'
import { HIDEN_CUFF_CATEGORY } from './types'

export const CUFF_CATEGORY_GROUPS: readonly GearCategoryGroup[] = [
  {
    label: 'Premium Poogie Cuffs',
    categories: [
      { key: 'cuff_premium_tier1', label: 'Premium' },
      { key: 'cuff_premium_tier2', label: 'Premium II' },
      { key: 'cuff_premium_tier3', label: 'Premium G' },
      { key: 'cuff_premium_net_cafe', label: 'Premium (Net Cafe)' },
      { key: 'cuff_premium_event', label: 'Premium (Event)' },
      { key: 'cuff_premium_special', label: 'Premium (Special)' },
      { key: 'cuff_premium_zenith', label: 'Premium (Zenith)' },
    ],
  },
  {
    label: 'Standard Poogie Cuffs',
    categories: [
      { key: 'cuff_standard_tier1', label: 'Standard' },
      { key: 'cuff_standard_tier2', label: 'Standard G' },
      { key: 'cuff_standard_event', label: 'Standard (Event)' },
      { key: 'cuff_standard_mystery_quest', label: 'Standard (Mystery Quest)' },
      { key: 'cuff_standard_guild', label: 'Standard (Guild)' },
      { key: 'cuff_standard_festival', label: 'Standard (Festival)' },
      { key: 'cuff_standard_zenith', label: 'Standard (Zenith)' },
    ],
  },
  {
    label: 'Hiden Cuffs',
    categories: [{ key: HIDEN_CUFF_CATEGORY, label: 'Hiden' }],
  },
]
