/**
 * Display tree for the decoration category filter -- same pattern as
 * `gear-categories.ts`/`cuff-categories.ts` (see their own docstrings), but
 * for `NamedDecoration.category` (see docs/gear-category-taxonomy.md's
 * "Decorations" table for the full rule set and confirmed row counts these
 * leaves implement).
 *
 * Tower Gems are NOT one of this tree's leaves, togglable or otherwise, even
 * though they have their own category key (`deco_tower`) for traceability --
 * the project owner confirmed Tower Gems should be excluded from search
 * entirely, unconditionally (see `build-query.ts`'s
 * `decorationsAfterCategoryFilter`, which drops every `isTower` decoration
 * outright, not via this exclusion-set mechanism).
 *
 * The "Musou" leaves and "Keoaruboru" couldn't be derived from CRE/CLASS
 * alone (unlike every other leaf here) -- they were confirmed by the project
 * owner against the real decoration names in etl/.data/cache/equip.body.
 * "(EXd): Extreme Quests" from the reference tool's own tree is deferred --
 * no decoration row could be confirmed for it yet (see
 * docs/skill-system-roadmap.md).
 */

import type { GearCategoryGroup } from './gear-categories'

export const DECORATION_CATEGORY_GROUPS: readonly GearCategoryGroup[] = [
  {
    label: 'Standard Decorations',
    categories: [{ key: 'deco_standard', label: 'Standard Production' }],
  },
  {
    label: 'G Rank Decorations',
    categories: [
      { key: 'deco_g', label: 'G or GF Decorations' },
      { key: 'deco_gx', label: 'GX Decorations' },
    ],
  },
  {
    label: 'Hiden Decorations',
    categories: [
      { key: 'deco_hiden', label: 'Hiden Decorations' },
      { key: 'deco_true_hiden', label: 'True Hiden Decorations' },
      { key: 'deco_lottery_hiden', label: 'Lottery Hiden Decorations (Do not use)' },
    ],
  },
  {
    label: 'Raviente Decorations',
    categories: [
      { key: 'deco_raviente', label: 'Raviente Decorations' },
      { key: 'deco_extreme_raviente', label: 'Extreme Raviente Decorations' },
    ],
  },
  {
    label: 'Musou Decorations',
    categories: [
      { key: 'deco_musou_nargacuga', label: 'Musou Nargacuga' },
      { key: 'deco_musou_bogabadorumu', label: 'Musou Bogabadorumu' },
      { key: 'deco_musou_zerureusu', label: 'Musou Zerureusu' },
      { key: 'deco_musou_duremudira', label: 'Musou Duremudira' },
      { key: 'deco_musou_elzelion', label: 'Musou Elzelion' },
    ],
  },
  {
    label: 'Events',
    categories: [
      { key: 'deco_event', label: 'Event Decorations' },
      { key: 'deco_event_g', label: 'G Event Decorations' },
      { key: 'deco_event_gx', label: 'GX Event Decorations' },
    ],
  },
  {
    label: 'Festival',
    categories: [
      { key: 'deco_festival_g', label: 'G or GF Festival' },
      { key: 'deco_festival_gx', label: 'GX Festival' },
    ],
  },
  {
    label: 'Guild',
    categories: [
      { key: 'deco_guild_g', label: 'G or GF Guild Required' },
      { key: 'deco_guild_gx', label: 'GX Guild Required' },
      { key: 'deco_keoaruboru', label: 'Keoaruboru Decorations' },
    ],
  },
  {
    label: "Hunter's Road Decorations",
    categories: [
      { key: 'deco_road', label: 'Road Decorations' },
      { key: 'deco_road_white_fatalis', label: 'Wht Fatalis Decorations' },
      { key: 'deco_road_gx', label: 'Multi Event Decorations' },
    ],
  },
]
