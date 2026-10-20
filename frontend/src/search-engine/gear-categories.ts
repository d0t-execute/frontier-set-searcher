/**
 * Display tree for the gear-level category filter (see
 * docs/gear-category-taxonomy.md) -- the category *keys* are produced by the
 * ETL (etl/src/etl/parse/gear_category.py) and exported verbatim on every
 * equipment candidate; this module only supplies human-readable grouping and
 * labels for the UI, kept in its own file so the two can't silently drift
 * (a typo'd key here just shows an empty group, rather than breaking the
 * filter for every other candidate).
 *
 * The "Unavailable" group (`unavailable_not_implemented`/
 * `unavailable_training_only`) is deliberately not one of this tree's
 * leaves (2026-10-20, per the project owner) -- neither category is a real,
 * obtainable item, so both are excluded from the general pool
 * unconditionally in build-query.ts's `_UNOBTAINABLE_EQUIPMENT_CATEGORIES`,
 * the same convention `deco_training_only`/`deco_unimplemented`/
 * `deco_impossible_to_create` already use on the decoration side (see
 * decoration-categories.ts's own docstring) rather than left as a
 * togglable (if default-off) choice here.
 *
 * **2026-10-20 F/FZ and G/GF split:** every category below that used to merge
 * a "plain" tier's F and FZ(/FY) name-suffix rows, or a G-rank tier's G and
 * GF rows, into one leaf now splits them into their own leaves -- confirmed
 * via direct stat comparison (RARE/DEF/HR1 escalation) against the real
 * dataset that these are genuine, separate tiers, not naming variants (see
 * gear_category.py's `_f_or_fz`/`_g_or_gf_or_gx` docstrings). The Musou and
 * Extreme Quest Armor groups also moved from one leaf per monster/quest to
 * one leaf per G/GF/GX tier, per the project owner ("split musou by level
 * instead of source") -- the monster/quest name itself is still visible in
 * the item name, just no longer a separate category branch. Event's own
 * plain G/GF stays merged (a confirmed, intentional exception -- see
 * `event_plain`'s own entry below).
 *
 * **Leaf ordering (2026-10-20 fix):** within each group/section, leaves
 * follow the same rank ladder `GEAR_LEVEL_GRANK_CATEGORIES`'s own doc comment
 * gives -- no suffix -> F -> FZ -> HC -> HS -> GS -> GP -> G -> GF -> GX -> Z
 * -> ZF -> ZY -> ZX -> ZP. Several groups (Package, Premium Kit, Gachapon,
 * Net Cafe, Promotional) had HC sorted after GS/GP instead of before HS, and
 * Hunting Tournament had GS/GP sorted after GX instead of before G -- both
 * fixed to match the ladder and the project owner's own reference taxonomy.
 * Tiers the ladder doesn't cover (FX/RX/LX, SP, CLASS-only tiers like Hiden)
 * keep their existing position since the ladder doesn't specify one for them.
 *
 * The empty "Diva Defense (plain)" leaf (`diva_defense`, confirmed 0 real
 * rows) was removed from the Diva Defense section entirely (2026-10-20) --
 * it's still a valid ETL category key, just no longer surfaced in this tree.
 *
 * **Update (2026-10-20, Diva Defense Zenith split):** `diva_defense_zenith`
 * used to merge both the bare "Z" and "ZF" name-suffix rows (100 each); split
 * into its own `diva_defense_zenith_zf` leaf for consistency with Road/Event
 * Zenith's own ZF leaf (gear_category.py's own history has the full story).
 */

export interface GearCategoryOption {
  readonly key: string
  readonly label: string
}

/** A group's optional third tree level (2026-10-20, per the project owner:
 * "categories should start collapsed" and some branches need a third level
 * "like guild -> diva defense -> diva defense Zenith ZX" for clarity) -- see
 * `CategoryFilterSection` in components/CategoryFilter.tsx for how this
 * renders. Only the handful of groups that grew past ~15 leaves after the
 * F/FZ and G/GF split (Guild, Gachapon, G Rank Armor, Event Armor), plus
 * Standard Armor once the Exotic leaves moved into it, use this; every other
 * group stays a flat leaf list, unchanged. */
export interface GearCategorySection {
  readonly label: string
  readonly categories: readonly GearCategoryOption[]
}

export interface GearCategoryGroup {
  readonly label: string
  readonly categories: readonly GearCategoryOption[]
  readonly sections?: readonly GearCategorySection[]
}

/** Builds a sectioned group's `categories` as the flattened union of its
 * `sections`, so the two can never drift apart -- every "is this leaf
 * G-Rank/Zenith" computation and the plain group-level select-all checkbox
 * keep working off the flat list exactly as they did before sections
 * existed; `sections` is purely an additional display subdivision on top. */
function sectionedGroup(label: string, sections: readonly GearCategorySection[]): GearCategoryGroup {
  return { label, categories: sections.flatMap((section) => section.categories), sections }
}

export const GEAR_CATEGORY_GROUPS: readonly GearCategoryGroup[] = [
  {
    label: 'Package',
    categories: [
      { key: 'paid_package', label: 'Package' },
      { key: 'paid_package_f', label: 'Package F' },
      { key: 'paid_package_fz', label: 'Package FZ' },
      { key: 'paid_package_hc', label: 'Package HC' },
      { key: 'paid_package_hs', label: 'Package HS' },
      { key: 'paid_package_gs', label: 'Package GS' },
      { key: 'paid_package_gp', label: 'Package GP' },
    ],
  },
  {
    label: 'Premium Kit',
    categories: [
      { key: 'paid_premium_kit', label: 'Premium Kit' },
      { key: 'paid_premium_kit_f', label: 'Premium Kit F' },
      { key: 'paid_premium_kit_fz', label: 'Premium Kit FZ' },
      { key: 'paid_premium_kit_hc', label: 'Premium Kit HC' },
      { key: 'paid_premium_kit_hs', label: 'Premium Kit HS' },
      { key: 'paid_premium_kit_gs', label: 'Premium Kit GS' },
      { key: 'paid_premium_kit_gp', label: 'Premium Kit GP' },
      { key: 'paid_premium_kit_zp', label: 'Premium Kit ZP' },
    ],
  },
  sectionedGroup('Gachapon', [
    {
      label: 'Base',
      categories: [
        { key: 'paid_gachapon', label: 'Gachapon' },
        { key: 'paid_gachapon_f', label: 'Gachapon F' },
        { key: 'paid_gachapon_fz', label: 'Gachapon FZ' },
        { key: 'paid_gachapon_hc', label: 'Gachapon HC' },
        { key: 'paid_gachapon_hs', label: 'Gachapon HS' },
        { key: 'paid_gachapon_gs', label: 'Gachapon GS' },
        { key: 'paid_gachapon_gp', label: 'Gachapon GP' },
        { key: 'paid_gachapon_zp', label: 'Gachapon ZP' },
      ],
    },
    {
      label: 'Hiden',
      categories: [
        { key: 'paid_gachapon_hiden', label: 'Gachapon Hiden' },
        { key: 'paid_gachapon_hiden_f', label: 'Gachapon Hiden F' },
        { key: 'paid_gachapon_g_hiden_g', label: 'Gachapon G-Hiden' },
        { key: 'paid_gachapon_g_hiden_gf', label: 'Gachapon G-Hiden GF' },
        { key: 'paid_gachapon_g_hiden_gx', label: 'Gachapon G-Hiden GX' },
      ],
    },
    {
      label: 'Exotic',
      categories: [
        { key: 'paid_gachapon_exotic', label: 'Gachapon Exotic' },
        { key: 'paid_gachapon_exotic_g', label: 'Gachapon Exotic G' },
        { key: 'paid_gachapon_exotic_gf', label: 'Gachapon Exotic GF' },
        { key: 'paid_gachapon_exotic_gx', label: 'Gachapon Exotic GX' },
      ],
    },
  ]),
  {
    label: 'Net Cafe',
    categories: [
      { key: 'paid_net_cafe', label: 'Net Cafe' },
      { key: 'paid_net_cafe_f', label: 'Net Cafe F' },
      { key: 'paid_net_cafe_fz', label: 'Net Cafe FZ' },
      { key: 'paid_net_cafe_hc', label: 'Net Cafe HC' },
      { key: 'paid_net_cafe_hs', label: 'Net Cafe HS' },
      { key: 'paid_net_cafe_gs', label: 'Net Cafe GS' },
      { key: 'paid_net_cafe_gp', label: 'Net Cafe GP' },
      { key: 'paid_net_cafe_zp', label: 'Net Cafe ZP' },
    ],
  },
  {
    label: 'Promotional',
    categories: [
      { key: 'paid_promotional', label: 'Promotional' },
      { key: 'paid_promotional_f', label: 'Promotional F' },
      { key: 'paid_promotional_fz', label: 'Promotional FZ' },
      { key: 'paid_promotional_hc', label: 'Promotional HC' },
      { key: 'paid_promotional_hs', label: 'Promotional HS' },
      { key: 'paid_promotional_gs', label: 'Promotional GS' },
      { key: 'paid_promotional_gp', label: 'Promotional GP' },
      { key: 'paid_promotional_zp', label: 'Promotional ZP' },
    ],
  },
  sectionedGroup('Guild', [
    {
      label: 'Festival',
      categories: [
        { key: 'guild_festival', label: 'Festival' },
        { key: 'guild_festival_f', label: 'Festival F' },
        { key: 'guild_festival_fz', label: 'Festival FZ' },
        { key: 'guild_festival_fx', label: 'Festival FX' },
        { key: 'guild_festival_rx', label: 'Festival RX' },
        { key: 'guild_festival_lx', label: 'Festival LX' },
        { key: 'guild_festival_hc', label: 'Festival HC' },
        { key: 'guild_festival_hs', label: 'Festival HS' },
        { key: 'guild_festival_g', label: 'Festival G' },
        { key: 'guild_festival_gf', label: 'Festival GF' },
        { key: 'guild_festival_gx', label: 'Festival GX' },
        { key: 'guild_festival_other', label: 'Winner and Loser Crowns' },
      ],
    },
    {
      label: 'Diva Defense',
      categories: [
        { key: 'diva_defense_gx', label: 'Diva Defense GX' },
        { key: 'diva_defense_zenith', label: 'Diva Defense Zenith' },
        { key: 'diva_defense_zenith_zf', label: 'Diva Defense Zenith ZF' },
        { key: 'diva_defense_zenith_zy', label: 'Diva Defense Zenith ZY' },
        { key: 'diva_defense_zenith_zx', label: 'Diva Defense Zenith ZX' },
      ],
    },
    {
      label: 'Base',
      categories: [
        { key: 'guild_plain', label: 'Guild' },
        { key: 'guild_plain_f', label: 'Guild F' },
        { key: 'guild_plain_fz', label: 'Guild FZ' },
        { key: 'guild_hs', label: 'Guild HS' },
        { key: 'guild_g', label: 'Guild G' },
        { key: 'guild_gf', label: 'Guild GF' },
        { key: 'guild_gx', label: 'Guild GX' },
      ],
    },
  ]),
  {
    label: 'Tower',
    categories: [
      { key: 'tower_plain', label: 'Tower' },
      { key: 'tower_plain_f', label: 'Tower F' },
      { key: 'tower_plain_fz', label: 'Tower FZ' },
      { key: 'tower_hs', label: 'Tower HS' },
      { key: 'tower_g', label: 'Tower G' },
      { key: 'tower_gf', label: 'Tower GF' },
      { key: 'tower_gx_custom', label: 'Customizable Tower GX' },
    ],
  },
  {
    label: 'Caravan and Diva Battle',
    categories: [
      { key: 'caravan_plain', label: 'Caravan' },
      { key: 'caravan_plain_f', label: 'Caravan F' },
      { key: 'caravan_plain_fz', label: 'Caravan FZ' },
      { key: 'caravan_rx', label: 'Caravan RX' },
      { key: 'caravan_hs', label: 'Caravan HS' },
      { key: 'caravan_g', label: 'Caravan G' },
      { key: 'caravan_gf', label: 'Caravan GF' },
      { key: 'caravan_gx', label: 'Caravan GX' },
    ],
  },
  {
    label: "Hunter's Road",
    categories: [
      { key: 'road_plain', label: 'Road' },
      { key: 'road_plain_f', label: 'Road F' },
      { key: 'road_plain_fz', label: 'Road FZ' },
      { key: 'road_hs', label: 'Road HS' },
      { key: 'road_g', label: 'Road G' },
      { key: 'road_gf', label: 'Road GF' },
      { key: 'road_gx', label: 'Road GX' },
      { key: 'road_zenith', label: 'Road Zenith' },
      { key: 'road_zenith_zf', label: 'Road Zenith ZF' },
      { key: 'road_zenith_zy', label: 'Road Zenith ZY' },
      { key: 'road_zenith_zx', label: 'Road Zenith ZX' },
    ],
  },
  sectionedGroup('G Rank Armor', [
    {
      label: 'Base',
      categories: [
        { key: 'grank_g', label: 'G' },
        { key: 'grank_gf', label: 'GF' },
        { key: 'grank_gx', label: 'GX' },
        { key: 'grank_g_hashu', label: 'G Supremacy' },
        { key: 'grank_burst_species', label: 'Burst Species' },
        { key: 'grank_origin', label: 'Origin' },
      ],
    },
    {
      label: 'G-Hiden',
      categories: [
        { key: 'grank_g_hiden_g', label: 'G-Hiden' },
        { key: 'grank_g_hiden_gf', label: 'G-Hiden GF' },
        { key: 'grank_g_hiden_gx', label: 'G-Hiden GX' },
      ],
    },
    {
      label: 'Exotic',
      categories: [
        { key: 'grank_exotic_g', label: 'Exotic G' },
        { key: 'grank_exotic_gf', label: 'Exotic GF' },
        { key: 'grank_exotic_gx', label: 'Exotic GX' },
      ],
    },
  ]),
  {
    label: 'Zenith Armor',
    categories: [
      { key: 'zenith_plain', label: 'Zenith' },
      { key: 'zenith_zf', label: 'Zenith ZF' },
      { key: 'zenith_zy', label: 'Zenith ZY' },
      { key: 'zenith_zx', label: 'Zenith ZX' },
    ],
  },
  {
    label: 'Hardcore Quests',
    categories: [
      { key: 'hardcore_lx', label: 'LX' },
      { key: 'hardcore_rx', label: 'RX' },
      { key: 'hardcore_hc', label: 'HC' },
      { key: 'hardcore_hs', label: 'HS' },
      { key: 'hardcore_tenran', label: 'Heavenly Storm' },
      { key: 'hardcore_hashu', label: 'Supremacy' },
      { key: 'hardcore_hiden', label: 'Hiden' },
      { key: 'hardcore_hiden_f', label: 'Hiden F' },
    ],
  },
  {
    label: 'HR100~',
    categories: [
      { key: 'hr100_fx', label: 'FX' },
      { key: 'hr100_gou', label: 'Gou' },
    ],
  },
  sectionedGroup('Event Armor', [
    {
      label: 'Event',
      categories: [
        { key: 'event_plain', label: 'Event' },
        { key: 'event_plain_f', label: 'Event F' },
        { key: 'event_plain_fz', label: 'Event FZ' },
        { key: 'event_hc', label: 'Event HC' },
        { key: 'event_hs', label: 'Event HS' },
        { key: 'event_sp', label: 'Event SP' },
        { key: 'event_gs', label: 'Event GS' },
        { key: 'event_gp', label: 'Event GP' },
        { key: 'event_gx', label: 'Event GX' },
        { key: 'event_zenith', label: 'Event Zenith' },
        { key: 'event_zenith_zf', label: 'Event Zenith ZF' },
        { key: 'event_zenith_zy', label: 'Event Zenith ZY' },
        { key: 'event_zenith_zx', label: 'Event Zenith ZX' },
        { key: 'event_mystery', label: 'Mystery Quest Armor' },
      ],
    },
    {
      label: 'Hunting Tournament',
      categories: [
        { key: 'tournament_plain', label: 'Hunting Tournament' },
        { key: 'tournament_plain_f', label: 'Hunting Tournament F' },
        { key: 'tournament_plain_fz', label: 'Hunting Tournament FZ' },
        { key: 'tournament_hc', label: 'Hunting Tournament HC' },
        { key: 'tournament_hs', label: 'Hunting Tournament HS' },
        { key: 'tournament_gs', label: 'Hunting Tournament GS' },
        { key: 'tournament_gp', label: 'Hunting Tournament GP' },
        { key: 'tournament_g', label: 'Hunting Tournament G' },
        { key: 'tournament_gf', label: 'Hunting Tournament GF' },
        { key: 'tournament_gx', label: 'Hunting Tournament GX' },
        { key: 'tournament_zp', label: 'Hunting Tournament ZP' },
      ],
    },
  ]),
  {
    label: 'Musou Armor',
    categories: [
      { key: 'event_musou_g', label: 'Musou G' },
      { key: 'event_musou_gf', label: 'Musou GF' },
      { key: 'event_musou_gx', label: 'Musou GX' },
    ],
  },
  {
    label: 'Extreme Quest Armor',
    categories: [
      { key: 'event_extreme_g', label: 'Extreme Quest G' },
      { key: 'event_extreme_gf', label: 'Extreme Quest GF' },
      { key: 'event_extreme_gx', label: 'Extreme Quest GX' },
    ],
  },
  sectionedGroup('Standard Armor', [
    {
      label: 'Base',
      categories: [
        { key: 'standard_plain', label: 'Standard' },
        { key: 'standard_plain_f', label: 'Standard F' },
        { key: 'standard_plain_fz', label: 'Standard FZ' },
        { key: 'standard_sp', label: 'SP' },
      ],
    },
    {
      label: 'Exotic',
      categories: [{ key: 'grank_exotic', label: 'Exotic' }],
    },
  ]),
]

function allLeafKeys(groups: readonly GearCategoryGroup[]): readonly string[] {
  return groups.flatMap((group) => group.categories.map((c) => c.key))
}

/** Every leaf category key that's G-Rank or later, for the top-level
 * "Gear levels" Pre-G-Rank/G-Rank/Zenith/ZP quick toggles (docs/feedback.md
 * Round 2 #6).
 *
 * **Update (2026-10-20):** superseded the narrower 2026-10-19 rule ("G-Rank"
 * = just the "G Rank Armor" group). The project owner instead gave the full
 * rank ladder every category's own name-suffix tiers are drawn from -- not
 * every category has every rung, but wherever a rung appears it sorts into
 * this same ladder: no suffix -> F -> FZ -> HC -> HS -> GS -> GP -> G -> GF
 * -> GX -> Z -> ZF -> ZY -> ZX -> ZP, with "G and up" G-Rank, "Z and up"
 * Zenith (see `GEAR_LEVEL_ZENITH_CATEGORIES` below), and ZP its own tier
 * (see `GEAR_LEVEL_ZP_CATEGORIES` below). This list is therefore every
 * GS/GP/G/GF/GX-tier leaf in the whole tree, not just "G Rank Armor"'s own
 * leaves -- plus Musou Armor and Extreme Quest Armor (both confirmed G-Rank
 * by the project owner; since 2026-10-20 they're split by G/GF/GX tier
 * rather than curated by monster/quest name, so those tiers now slot into
 * the ladder directly) and the 1 CLASS-only tier the ladder doesn't cover by
 * suffix at all (G-Hiden). F/FZ, HC/HS all stay Pre-G-Rank (they sort below
 * GS on the ladder), as do the FX/RX/LX "HR100~"/Hardcore tiers (not on the
 * ladder at all -- each is `CLASS ""`, the same blank CLASS Pre-G-Rank
 * pieces have) and the CLASS-only Pre-G-Rank tiers (Hiden, Burst Species's
 * 烈種, Gou, Heavenly Storm, Supremacy, SP).
 *
 * **Update (2026-10-20, Exotic's plain leaf corrected to Pre-G-Rank):**
 * Gachapon's own "Exotic" leaf-set is Pre-G-Rank per the project owner's own
 * reference taxonomy, not G-Rank -- despite `CLASS O` being one of
 * `is_grank_or_later_equipment`'s `_GRANK_OR_LATER_CLASSES` in
 * gear_category.py. That ETL function answers a different, unrelated
 * question (whether a piece counts for the real in-game active-skill-cap
 * G-Rank piece-count bonus) and is intentionally left untouched; this list
 * is purely the "Gear levels" UI tier. Of "G Rank Armor"'s own Exotic
 * leaf-set, only the plain `grank_exotic` leaf is Pre-G-Rank -- it moved out
 * to "Standard Armor" (as its own "Exotic" section) to match. Its G/GF/GX
 * tiers (`grank_exotic_g`/`_gf`/`_gx`) are still G-Rank and stayed in "G Rank
 * Armor", in their own "Exotic" section there.
 *
 * Kept as an explicit list, not derived from a group label match, so a
 * future taxonomy reshuffle has to touch this deliberately rather than
 * silently. */
export const GEAR_LEVEL_GRANK_CATEGORIES: readonly string[] = [
  'grank_g',
  'grank_gf',
  'grank_gx',
  'grank_g_hashu',
  'grank_burst_species',
  'grank_g_hiden_g',
  'grank_g_hiden_gf',
  'grank_g_hiden_gx',
  'grank_exotic_g',
  'grank_exotic_gf',
  'grank_exotic_gx',
  'grank_origin',
  'paid_package_gs',
  'paid_package_gp',
  'paid_premium_kit_gs',
  'paid_premium_kit_gp',
  'paid_gachapon_gs',
  'paid_gachapon_gp',
  'paid_gachapon_g_hiden_g',
  'paid_gachapon_g_hiden_gf',
  'paid_gachapon_g_hiden_gx',
  'paid_net_cafe_gs',
  'paid_net_cafe_gp',
  'paid_promotional_gs',
  'paid_promotional_gp',
  'guild_festival_g',
  'guild_festival_gf',
  'guild_festival_gx',
  'diva_defense_gx',
  'guild_g',
  'guild_gf',
  'guild_gx',
  'tower_g',
  'tower_gf',
  'tower_gx_custom',
  'caravan_g',
  'caravan_gf',
  'caravan_gx',
  'road_g',
  'road_gf',
  'road_gx',
  'event_gs',
  'event_gp',
  'event_gx',
  'event_mystery',
  'tournament_g',
  'tournament_gf',
  'tournament_gx',
  'tournament_gs',
  'tournament_gp',
  'event_musou_g',
  'event_musou_gf',
  'event_musou_gx',
  'event_extreme_g',
  'event_extreme_gf',
  'event_extreme_gx',
]

/** Every leaf category key that's Zenith, for the same toggles -- per the
 * same 2026-10-20 rank-ladder rule above ("Z and up" is Zenith), this is
 * every Z/ZF/ZY/ZX-tier leaf in the whole tree: the base "Zenith Armor"
 * group, plus Road/Event/Diva Defense's own Zenith tiers.
 *
 * **Update (2026-10-20, ZP split out):** ZP ("Zenith-Shugo") used to be
 * folded into this same "Zenith" tier (added 2026-10-20 as "Z and up"), but
 * the project owner has since decided it's its own top-level "Gear levels"
 * tier instead -- see `GEAR_LEVEL_ZP_CATEGORIES` below, which now owns every
 * key this list used to include for ZP. */
export const GEAR_LEVEL_ZENITH_CATEGORIES: readonly string[] = [
  'zenith_plain',
  'zenith_zf',
  'zenith_zy',
  'zenith_zx',
  'road_zenith',
  'road_zenith_zf',
  'road_zenith_zy',
  'road_zenith_zx',
  'event_zenith',
  'event_zenith_zf',
  'event_zenith_zy',
  'event_zenith_zx',
  'diva_defense_zenith',
  'diva_defense_zenith_zf',
  'diva_defense_zenith_zy',
  'diva_defense_zenith_zx',
]

/** Every leaf category key that's "ZP" (Zenith-Shugo), for the same toggles
 * -- its own top-level "Gear levels" tier (2026-10-20, per the project
 * owner), split out from the "Zenith" tier it was briefly folded into
 * earlier the same day. Every ZP leaf in the whole tree lives among the
 * Paid-and-Premium routes and Hunting Tournament; no other group has one. */
export const GEAR_LEVEL_ZP_CATEGORIES: readonly string[] = [
  'paid_premium_kit_zp',
  'paid_gachapon_zp',
  'paid_net_cafe_zp',
  'paid_promotional_zp',
  'tournament_zp',
]

/** Every leaf category key that's none of the above -- "Pre-G-Rank" for the
 * same toggles. Derived (not hand-listed) so it can't drift out of sync with
 * `GEAR_CATEGORY_GROUPS` as new categories are added. */
export const GEAR_LEVEL_PRE_GRANK_CATEGORIES: readonly string[] = allLeafKeys(
  GEAR_CATEGORY_GROUPS,
).filter(
  (key) =>
    !GEAR_LEVEL_GRANK_CATEGORIES.includes(key) &&
    !GEAR_LEVEL_ZENITH_CATEGORIES.includes(key) &&
    !GEAR_LEVEL_ZP_CATEGORIES.includes(key),
)
