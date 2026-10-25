/**
 * Display tree for the decoration category filter -- same pattern as
 * `gear-categories.ts`/`cuff-categories.ts` (see their own docstrings), but
 * for `NamedDecoration.category` (see docs/gear-category-taxonomy.md's
 * "Decorations" table for the full rule set and confirmed row counts these
 * leaves implement). Reworked 2026-10-18 to match the reference tool's own
 * decoration tree screenshot the project owner supplied, while keeping every
 * extra distinction this project had already added on top of it (Musou,
 * Extreme Quest, Keoaruboru-as-Diva-Def).
 *
 * Tower Gems are NOT a leaf in this tree at all, togglable or otherwise, even
 * though they have their own category key (`deco_tower`) for traceability --
 * the project owner confirmed they should be excluded from the general
 * search pool entirely, unconditionally (see `build-query.ts`'s
 * `decorationsAfterCategoryFilter`, which drops every `isTower` decoration
 * outright, not via this exclusion-set mechanism). The 3 "Unavailable" leaves
 * (Training/Unimplemented/Impossible to Create) get the identical
 * not-a-leaf-at-all, unconditionally-excluded treatment (2026-10-18, per the
 * project owner: these are confirmed impossible to ever obtain) -- see
 * `UNOBTAINABLE_DECORATION_CATEGORIES` in build-query.ts. Lottery Hiden
 * Decorations (`deco_lottery_hiden`, "do not use" per the reference tool's
 * own tree) got the identical treatment on 2026-10-20 -- previously a
 * default-excluded-but-togglable leaf (see the roadmap doc's 2026-10-15
 * follow-up), now folded into the same unconditional exclusion set instead,
 * since there was never a legitimate reason to re-include it.
 *
 * SP Decorations (`deco_sp`/`deco_sp_lv2`/`deco_sp_lv3`) ARE togglable leaves
 * here (unlike Tower/Unavailable above), but excluded by default
 * (2026-10-18, per the project owner) in `App.tsx`'s
 * `DEFAULT_EXCLUDED_DECORATION_CATEGORIES` -- on top of the same
 * unconditional `isSp` exclusion Tower gets, since the engine still can't
 * target SP armor specifically. Kept as real leaves (rather than omitted like
 * Tower) purely for traceability/consistency with their own default-excluded
 * checkbox state.
 *
 * The "Musou" and "Extreme Quest" leaves, and "Keoaruboru", couldn't be
 * derived from CRE/CLASS alone (unlike every other leaf here) -- they were
 * confirmed by the project owner against the real decoration names in
 * etl/.data/cache/equip.body. Only 5 of the 9 Musou monsters and 3 of the 4
 * Extreme Quest sets have a confirmed decoration (Demon Lord's Extreme Quest
 * has none) -- see docs/gear-category-taxonomy.md for the full table.
 *
 * "(パ) Package" and "(ガTW) Lottery Decorations" from the reference tree are
 * omitted entirely -- confirmed empty (0 real rows), same convention as
 * Taiwanese Premium armor. "(塔GX) Event Cycle Decorations" is also
 * unconfirmed/possibly-empty in this dataset; its CRE=1t bucket is already
 * fully accounted for by Hunter's Road Decorations below.
 */

import type { GearCategoryGroup } from './gear-categories'

export const DECORATION_CATEGORY_GROUPS: readonly GearCategoryGroup[] = [
  {
    label: 'Standard Decorations',
    categories: [
      { key: 'deco_standard', label: 'Standard Production' },
      { key: 'deco_sp', label: 'SP Decorations' },
      { key: 'deco_sp_lv2', label: 'SP Decoration Lv2' },
      { key: 'deco_sp_lv3', label: 'SP Decoration Lv3' },
    ],
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
      { key: 'deco_musou_nargacuga', label: 'Demonclad / Dojiclad' },
      { key: 'deco_musou_bogabadorumu', label: 'Rafan' },
      { key: 'deco_musou_zerureusu', label: 'Elysium' },
      { key: 'deco_musou_duremudira', label: 'Bonne' },
      { key: 'deco_musou_elzelion', label: 'Fonce' },
    ],
  },
  {
    label: 'Extreme Quest Decorations',
    categories: [
      { key: 'deco_extreme_heruto', label: 'Heruto' },
      { key: 'deco_extreme_iroasu', label: 'Iroasu' },
      { key: 'deco_extreme_luchar', label: 'Luchar' },
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
    label: 'Guild and Diva Def',
    categories: [
      { key: 'deco_festival_g', label: 'G or GF Festival' },
      { key: 'deco_festival_gx', label: 'GX Festival' },
      { key: 'deco_guild_g', label: 'G or GF Guild Required' },
      { key: 'deco_guild_gx', label: 'GX Guild Required' },
      { key: 'deco_keoaruboru', label: 'GX Diva Defense' },
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
  {
    label: 'Lottery and Paid Decorations',
    categories: [{ key: 'deco_special', label: 'Special' }],
  },
]
