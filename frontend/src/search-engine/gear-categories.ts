/**
 * Display tree for the gear-level category filter (see
 * docs/gear-category-taxonomy.md) -- the category *keys* are produced by the
 * ETL (etl/src/etl/parse/gear_category.py) and exported verbatim on every
 * equipment candidate; this module only supplies human-readable grouping and
 * labels for the UI, kept in its own file so the two can't silently drift
 * (a typo'd key here just shows an empty group, rather than breaking the
 * filter for every other candidate).
 */

export interface GearCategoryOption {
  readonly key: string
  readonly label: string
}

export interface GearCategoryGroup {
  readonly label: string
  readonly categories: readonly GearCategoryOption[]
}

export const GEAR_CATEGORY_GROUPS: readonly GearCategoryGroup[] = [
  {
    label: 'Package',
    categories: [
      { key: 'paid_package', label: 'Package' },
      { key: 'paid_package_hs', label: 'Package HS' },
      { key: 'paid_package_g_shugo', label: 'Package G-Shugo' },
      { key: 'paid_package_hc', label: 'Package HC' },
    ],
  },
  {
    label: 'Premium Kit',
    categories: [
      { key: 'paid_premium_kit', label: 'Premium Kit' },
      { key: 'paid_premium_kit_hs', label: 'Premium Kit HS' },
      { key: 'paid_premium_kit_g_shugo', label: 'Premium Kit G-Shugo' },
      { key: 'paid_premium_kit_hc', label: 'Premium Kit HC' },
      { key: 'paid_premium_kit_zp', label: 'Premium Kit ZP' },
    ],
  },
  {
    label: 'Gachapon',
    categories: [
      { key: 'paid_gachapon', label: 'Gachapon' },
      { key: 'paid_gachapon_hs', label: 'Gachapon HS' },
      { key: 'paid_gachapon_g_shugo', label: 'Gachapon G-Shugo' },
      { key: 'paid_gachapon_hc', label: 'Gachapon HC' },
      { key: 'paid_gachapon_zp', label: 'Gachapon ZP' },
      { key: 'paid_gachapon_hiden', label: 'Gachapon Hiden' },
      { key: 'paid_gachapon_g_hiden', label: 'Gachapon G-Hiden' },
      { key: 'paid_gachapon_exotic', label: 'Gachapon Exotic' },
    ],
  },
  {
    label: 'Net Cafe',
    categories: [
      { key: 'paid_net_cafe', label: 'Net Cafe' },
      { key: 'paid_net_cafe_hs', label: 'Net Cafe HS' },
      { key: 'paid_net_cafe_g_shugo', label: 'Net Cafe G-Shugo' },
      { key: 'paid_net_cafe_hc', label: 'Net Cafe HC' },
      { key: 'paid_net_cafe_zp', label: 'Net Cafe ZP' },
    ],
  },
  {
    label: 'Promotional',
    categories: [
      { key: 'paid_promotional', label: 'Promotional' },
      { key: 'paid_promotional_hs', label: 'Promotional HS' },
      { key: 'paid_promotional_g_shugo', label: 'Promotional G-Shugo' },
      { key: 'paid_promotional_hc', label: 'Promotional HC' },
      { key: 'paid_promotional_zp', label: 'Promotional ZP' },
    ],
  },
  {
    label: 'Guild',
    categories: [
      { key: 'guild_festival', label: 'Festival' },
      { key: 'guild_plain', label: 'Guild' },
      { key: 'guild_hs', label: 'Guild HS' },
      { key: 'guild_g', label: 'Guild G' },
      { key: 'guild_gx', label: 'Guild GX' },
    ],
  },
  {
    label: 'Diva Defense',
    categories: [{ key: 'diva_defense', label: 'Diva Defense' }],
  },
  {
    label: 'Tower',
    categories: [
      { key: 'tower_plain', label: 'Tower' },
      { key: 'tower_hs', label: 'Tower HS' },
      { key: 'tower_g', label: 'Tower G' },
      { key: 'tower_gx_custom', label: 'Customisable Tower GX' },
    ],
  },
  {
    label: 'Caravan and Diva Battle',
    categories: [
      { key: 'caravan_plain', label: 'Caravan' },
      { key: 'caravan_rx', label: 'Caravan RX' },
      { key: 'caravan_hs', label: 'Caravan HS' },
      { key: 'caravan_g', label: 'Caravan G' },
      { key: 'caravan_gx', label: 'Caravan GX' },
    ],
  },
  {
    label: "Hunter's Road",
    categories: [
      { key: 'road_plain', label: 'Road' },
      { key: 'road_hs', label: 'Road HS' },
      { key: 'road_g', label: 'Road G' },
      { key: 'road_gx', label: 'Road GX' },
      { key: 'road_zenith', label: 'Road Zenith' },
      { key: 'road_zenith_zy', label: 'Road Zenith ZY' },
      { key: 'road_zenith_zx', label: 'Road Zenith ZX' },
    ],
  },
  {
    label: 'G Rank Armour',
    categories: [
      { key: 'grank_g', label: 'G' },
      { key: 'grank_gx', label: 'GX' },
      { key: 'grank_g_hashu', label: 'G Supremacy' },
      { key: 'grank_burst_species', label: 'Burst Species' },
      { key: 'grank_g_hiden', label: 'G-Hiden' },
      { key: 'grank_origin', label: 'Origin' },
      { key: 'grank_exotic', label: 'Exotic' },
      { key: 'grank_exotic_gx', label: 'Exotic GX' },
    ],
  },
  {
    label: 'Zenith Armour',
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
    ],
  },
  {
    label: 'HR100~',
    categories: [
      { key: 'hr100_fx', label: 'FX' },
      { key: 'hr100_gou', label: 'Gou' },
    ],
  },
  {
    label: 'Event Armour',
    categories: [
      { key: 'event_plain', label: 'Event' },
      { key: 'event_gx', label: 'Event GX' },
      { key: 'event_zenith', label: 'Event Zenith' },
      { key: 'event_zenith_zy', label: 'Event Zenith ZY' },
      { key: 'event_zenith_zx', label: 'Event Zenith ZX' },
      { key: 'event_mystery', label: 'Mystery Quest Armour' },
      { key: 'tournament_plain', label: 'Hunting Tournament' },
      { key: 'tournament_hc', label: 'Hunting Tournament HC' },
      { key: 'tournament_hs', label: 'Hunting Tournament HS' },
      { key: 'tournament_g', label: 'Hunting Tournament G' },
      { key: 'tournament_gx', label: 'Hunting Tournament GX' },
      { key: 'tournament_gp', label: 'Hunting Tournament GP' },
      { key: 'tournament_zp', label: 'Hunting Tournament ZP' },
    ],
  },
  {
    label: 'Musou Armour',
    categories: [
      { key: 'event_musou_nargacuga', label: 'Demonclad' },
      { key: 'event_musou_guanzorumu', label: '鬼凛ノ / 童凛ノ' },
      { key: 'event_musou_bogabadorumu', label: 'Rapin' },
      { key: 'event_musou_zinogre', label: 'Chiru' },
      { key: 'event_musou_zerureusu', label: 'Elysi' },
      { key: 'event_musou_elzelion', label: 'Fonse' },
      { key: 'event_musou_miru', label: 'Demon Tale / 童伝ノ' },
      { key: 'event_musou_pariapuria', label: 'Ganeto' },
      { key: 'event_musou_duremudira', label: 'Bonne' },
    ],
  },
  {
    label: 'Extreme Quest Armour',
    categories: [
      { key: 'event_extreme_demon_lord', label: 'Demon Lord' },
      { key: 'event_extreme_heruto', label: 'Heruto' },
      { key: 'event_extreme_iroasu', label: 'Iroasu' },
      { key: 'event_extreme_luchar', label: 'Luchar' },
    ],
  },
  {
    label: 'Standard Armour',
    categories: [
      { key: 'standard_plain', label: 'Standard' },
      { key: 'standard_sp', label: 'SP' },
    ],
  },
  {
    label: 'Unavailable',
    categories: [
      { key: 'unavailable_not_implemented', label: 'Not Implemented' },
      { key: 'unavailable_training_only', label: 'Training Only' },
    ],
  },
]
