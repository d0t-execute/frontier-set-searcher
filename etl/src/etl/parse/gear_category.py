"""Classifies an equipment or cuff row into the reference set-searcher's
gear-level category leaf, from the raw CRE (acquisition method), CLASS
(origin tier), and name-suffix fields already scraped out of skill/equip.js.

Every rule here, including the leaf names and their confirmed row counts, is
documented in docs/gear-category-taxonomy.md -- that file is the source of
truth for *why* a given field combination maps to a given leaf; this module
is just its implementation.

Field indices are duplicated here (rather than imported from
etl.parse.equipment.Field) to avoid a circular import -- equipment.py calls
into this module, so this module can't import back from equipment.py.
"""

from __future__ import annotations

import re

_NAME = 0
_RECIPE1 = 21
_HR1 = 22
_CRE = 33
_CLASS = 35

# CLASS codes -- see docs/data-format-notes.md "Equipment taxonomy" for the
# full decode table this module implements.
_CLASS_SP = "A"
_CLASS_GOU = "B"
_CLASS_TENRAN = "C"
_CLASS_HASHU = "D"
_CLASS_HC = "E"
_CLASS_SHUGO = "F"
_CLASS_G_HASHU = "G"
_CLASS_RESSHU = "H"
_CLASS_G = "I"
_CLASS_G_SHUGO = "J"
_CLASS_HIDEN = "K"
_CLASS_G_HIDEN = "L"
_CLASS_SISYU = "M"
_CLASS_TOWER = "N"
_CLASS_EXOTIC = "O"
_CLASS_ZENITH = "P"
_CLASS_ZENITH_SHUGO = "Q"

# Category leaf keys -- names and groupings match docs/gear-category-taxonomy.md.
# Paid and Premium armor -- each of the 5 acquisition routes below further
# splits by CLASS into the same tier structure (confirmed against the real
# dataset, 2026-10-18): a plain base tier, plus whichever of Shugo/GS/GP/HC/
# Zenith-Shugo/Hiden/G-Hiden/Exotic that route actually has real rows for (not
# every route has every tier -- no leaf is defined for a tier with 0 real
# rows in a given route, same no-leaf-for-confirmed-empty convention as
# Taiwanese Premium). The project owner asked for this precisely because the
# un-split buckets were huge (Premium Kit alone was 21,733 rows in one leaf).
#
# Update (2026-10-20): the CLASS=J tier was originally a single "G-Shugo"
# leaf per route, merging 2 name-suffix variants ("GS"/"GP") that share that
# one CLASS value. The project owner asked for these split to mirror the
# in-game piece names -- confirmed against the real dataset that every route
# with a CLASS=J row has both variants, roughly evenly split (exactly even
# for Premium Kit/Gachapon/Net Cafe; close but not exact for Package 440/360
# and Promotional 230/203, i.e. real, not an artifact of the audit). The
# marker can be glued directly onto a kana name with no preceding space (e.g.
# "メトリーGS Helm"), so it's detected via regex, not `_tokens` membership.
#
# Update (2026-10-20, later same day): each route's own "base" tier (CLASS
# "") further splits into up to 3 rank-ladder rungs -- confirmed against the
# real dataset via a direct stat comparison (Package's own "Secuti" line:
# RARE 7/DEF 13 -> RARE 7/DEF 50 ("F") -> RARE 7/DEF 88 ("FZ") -> jumps to
# RARE 9+/DEF 116+ at CLASS=J). "FY" is a differently-worded name for the
# same tier position as "FZ" (a given armor set's own upgrade chain uses
# either FY or FZ, never both), so both map to the one `_fz`-suffixed leaf;
# see `_f_or_fz`.
CATEGORY_PAID_PACKAGE = "paid_package"  # CRE=5p, CLASS "" (base tier)
CATEGORY_PAID_PACKAGE_F = "paid_package_f"
CATEGORY_PAID_PACKAGE_FZ = "paid_package_fz"
CATEGORY_PAID_PACKAGE_HS = "paid_package_hs"
CATEGORY_PAID_PACKAGE_GS = "paid_package_gs"
CATEGORY_PAID_PACKAGE_GP = "paid_package_gp"
CATEGORY_PAID_PACKAGE_HC = "paid_package_hc"

CATEGORY_PAID_PREMIUM_KIT = "paid_premium_kit"  # CRE=4k, CLASS "" (base tier)
CATEGORY_PAID_PREMIUM_KIT_F = "paid_premium_kit_f"
CATEGORY_PAID_PREMIUM_KIT_FZ = "paid_premium_kit_fz"
CATEGORY_PAID_PREMIUM_KIT_HS = "paid_premium_kit_hs"
CATEGORY_PAID_PREMIUM_KIT_GS = "paid_premium_kit_gs"
CATEGORY_PAID_PREMIUM_KIT_GP = "paid_premium_kit_gp"
CATEGORY_PAID_PREMIUM_KIT_HC = "paid_premium_kit_hc"
CATEGORY_PAID_PREMIUM_KIT_ZP = "paid_premium_kit_zp"

CATEGORY_PAID_GACHAPON = "paid_gachapon"  # CRE=4g, CLASS "" (base tier)
CATEGORY_PAID_GACHAPON_F = "paid_gachapon_f"
CATEGORY_PAID_GACHAPON_FZ = "paid_gachapon_fz"
CATEGORY_PAID_GACHAPON_HS = "paid_gachapon_hs"
CATEGORY_PAID_GACHAPON_GS = "paid_gachapon_gs"
CATEGORY_PAID_GACHAPON_GP = "paid_gachapon_gp"
CATEGORY_PAID_GACHAPON_HC = "paid_gachapon_hc"
CATEGORY_PAID_GACHAPON_ZP = "paid_gachapon_zp"
CATEGORY_PAID_GACHAPON_HIDEN = "paid_gachapon_hiden"  # plain Hiden -- "F" tier only, no FZ/FY
CATEGORY_PAID_GACHAPON_HIDEN_F = "paid_gachapon_hiden_f"
# G-Hiden (CLASS=L) within Gachapon has no "plain" rows of its own -- every
# real row carries G/GF/GX (confirmed against the real dataset: 280/280/280,
# summing exactly to the old flat total), so there's no base leaf to keep.
CATEGORY_PAID_GACHAPON_G_HIDEN_G = "paid_gachapon_g_hiden_g"
CATEGORY_PAID_GACHAPON_G_HIDEN_GF = "paid_gachapon_g_hiden_gf"
CATEGORY_PAID_GACHAPON_G_HIDEN_GX = "paid_gachapon_g_hiden_gx"
# Exotic (CLASS=O) within Gachapon has its own internal G/GF/GX escalation on
# top of a plain Exotic tier (confirmed: 62/62/62/62, summing exactly to the
# old flat total) -- the same nested ladder `grank_exotic` below also has.
CATEGORY_PAID_GACHAPON_EXOTIC = "paid_gachapon_exotic"
CATEGORY_PAID_GACHAPON_EXOTIC_G = "paid_gachapon_exotic_g"
CATEGORY_PAID_GACHAPON_EXOTIC_GF = "paid_gachapon_exotic_gf"
CATEGORY_PAID_GACHAPON_EXOTIC_GX = "paid_gachapon_exotic_gx"

CATEGORY_PAID_NET_CAFE = "paid_net_cafe"  # CRE=3-/3e, CLASS "" (base tier)
CATEGORY_PAID_NET_CAFE_F = "paid_net_cafe_f"
CATEGORY_PAID_NET_CAFE_FZ = "paid_net_cafe_fz"
CATEGORY_PAID_NET_CAFE_HS = "paid_net_cafe_hs"
CATEGORY_PAID_NET_CAFE_GS = "paid_net_cafe_gs"
CATEGORY_PAID_NET_CAFE_GP = "paid_net_cafe_gp"
CATEGORY_PAID_NET_CAFE_HC = "paid_net_cafe_hc"
CATEGORY_PAID_NET_CAFE_ZP = "paid_net_cafe_zp"

CATEGORY_PAID_PROMOTIONAL = "paid_promotional"  # CRE=5-, CLASS "" (base tier)
CATEGORY_PAID_PROMOTIONAL_F = "paid_promotional_f"
CATEGORY_PAID_PROMOTIONAL_FZ = "paid_promotional_fz"
CATEGORY_PAID_PROMOTIONAL_HS = "paid_promotional_hs"
CATEGORY_PAID_PROMOTIONAL_GS = "paid_promotional_gs"
CATEGORY_PAID_PROMOTIONAL_GP = "paid_promotional_gp"
CATEGORY_PAID_PROMOTIONAL_HC = "paid_promotional_hc"
CATEGORY_PAID_PROMOTIONAL_ZP = "paid_promotional_zp"

# Festival (2026-10-20): previously one unsplit leaf (2,548 rows, with its FX
# rows diverted into the shared HR100 FX leaf). The project owner supplied a
# screenshot of the reference tool's own Festival node, which splits into 9
# leaves of its own -- confirmed against the real dataset, a complete
# partition summing to the same 2,548 total. The screenshot also shows "FX
# Festival" as Festival's own child, not merged with CRE=1-/1e's FX rows under
# the shared HR100 bucket, so Festival's FX rows are carved out of
# CATEGORY_HR100_FX into their own leaf here (HR100 FX now only covers
# CRE=1-/1e, 242 of the previous 282 rows).
CATEGORY_GUILD_FESTIVAL = "guild_festival"
CATEGORY_GUILD_FESTIVAL_F = "guild_festival_f"
CATEGORY_GUILD_FESTIVAL_FZ = "guild_festival_fz"
CATEGORY_GUILD_FESTIVAL_FX = "guild_festival_fx"
CATEGORY_GUILD_FESTIVAL_RX = "guild_festival_rx"
CATEGORY_GUILD_FESTIVAL_LX = "guild_festival_lx"
CATEGORY_GUILD_FESTIVAL_HC = "guild_festival_hc"
CATEGORY_GUILD_FESTIVAL_HS = "guild_festival_hs"
CATEGORY_GUILD_FESTIVAL_G = "guild_festival_g"
CATEGORY_GUILD_FESTIVAL_GF = "guild_festival_gf"
CATEGORY_GUILD_FESTIVAL_GX = "guild_festival_gx"
# "Winner and Loser Crowns" -- CRE=2m, plain CLASS, curated by name (no field
# combination distinguishes these 5 rows from the other 1,264 plain Festival
# rows): "祭のあとに【勝ち猫】"(Winner Cat)/"祭のあとに【負け犬】"(Loser Dog),
# each with "旧"(old)/"(劣)"(inferior) variants.
CATEGORY_GUILD_FESTIVAL_OTHER = "guild_festival_other"
CATEGORY_GUILD_PLAIN = "guild_plain"
CATEGORY_GUILD_PLAIN_F = "guild_plain_f"
CATEGORY_GUILD_PLAIN_FZ = "guild_plain_fz"
CATEGORY_GUILD_HS = "guild_hs"
CATEGORY_GUILD_G = "guild_g"
CATEGORY_GUILD_GF = "guild_gf"
CATEGORY_GUILD_GX = "guild_gx"

# Diva Defense (2026-10-20): previously one unsplit leaf (410 rows: 400
# CLASS=P Zenith "Diva" family + 10 CLASS=I GX "Burning Cliff"/"Crimson
# Cliff") -- already flagged in this file's own history as a candidate for
# the same Z/ZF/ZY/ZX-style split Road Zenith and Event Zenith already have.
# The project owner supplied a screenshot of the reference tool's own Diva
# Defense node (nested under Guild, not top-level -- see gear-categories.ts),
# showing exactly 5 children: plain/GX/辿(Zenith)/辿ZY/辿ZX -- no separate ZF
# leaf, unlike Road/Event Zenith. Confirmed against the real dataset: the 200
# "辿" rows are a real Z(100)+ZF(100) merge, not a parsing gap -- the
# screenshot is the direct source for keeping them merged here. The plain
# leaf has 0 real rows today (same no-real-rows situation as a few other
# defensive-default base tiers in this file), kept as the defensive fallback.
CATEGORY_DIVA_DEFENSE = "diva_defense"
CATEGORY_DIVA_DEFENSE_GX = "diva_defense_gx"
CATEGORY_DIVA_DEFENSE_ZENITH = "diva_defense_zenith"
CATEGORY_DIVA_DEFENSE_ZENITH_ZY = "diva_defense_zenith_zy"
CATEGORY_DIVA_DEFENSE_ZENITH_ZX = "diva_defense_zenith_zx"

CATEGORY_TOWER_PLAIN = "tower_plain"
CATEGORY_TOWER_PLAIN_F = "tower_plain_f"
CATEGORY_TOWER_PLAIN_FZ = "tower_plain_fz"
CATEGORY_TOWER_HS = "tower_hs"
CATEGORY_TOWER_G = "tower_g"
CATEGORY_TOWER_GF = "tower_gf"
CATEGORY_TOWER_GX_CUSTOM = "tower_gx_custom"  # 刻GX

CATEGORY_CARAVAN_PLAIN = "caravan_plain"
CATEGORY_CARAVAN_PLAIN_F = "caravan_plain_f"
CATEGORY_CARAVAN_PLAIN_FZ = "caravan_plain_fz"
CATEGORY_CARAVAN_RX = "caravan_rx"
CATEGORY_CARAVAN_HS = "caravan_hs"
CATEGORY_CARAVAN_G = "caravan_g"
CATEGORY_CARAVAN_GF = "caravan_gf"
CATEGORY_CARAVAN_GX = "caravan_gx"

CATEGORY_ROAD_PLAIN = "road_plain"
CATEGORY_ROAD_PLAIN_F = "road_plain_f"
CATEGORY_ROAD_PLAIN_FZ = "road_plain_fz"
CATEGORY_ROAD_HS = "road_hs"
CATEGORY_ROAD_G = "road_g"
CATEGORY_ROAD_GF = "road_gf"
CATEGORY_ROAD_GX = "road_gx"
CATEGORY_ROAD_ZENITH = "road_zenith"
CATEGORY_ROAD_ZENITH_ZF = "road_zenith_zf"
CATEGORY_ROAD_ZENITH_ZY = "road_zenith_zy"
CATEGORY_ROAD_ZENITH_ZX = "road_zenith_zx"

# Update (2026-10-20): "G" used to merge 2 real, sequential power tiers ("G"
# and "GF") -- confirmed against the real dataset via a direct stat
# comparison (Festival's own "Roses" line: RARE 8/DEF 137 ("G") -> RARE
# 10/DEF 146 ("GF") -> RARE 11/DEF 233 ("GX"); TYPE=0 for all 3, so this
# isn't a Blademaster/Gunner naming pair like Mail/Vest). Exotic (CLASS=O)
# and G-Hiden (CLASS=L) each carry this same 3-step ladder as their own
# *internal* escalation (on top of already being G-rank via CLASS alone),
# confirmed by the same stat-comparison method -- see their own leaves below.
CATEGORY_GRANK_G = "grank_g"
CATEGORY_GRANK_GF = "grank_gf"
CATEGORY_GRANK_GX = "grank_gx"
CATEGORY_GRANK_G_HASHU = "grank_g_hashu"
CATEGORY_GRANK_BURST_SPECIES = (
    "grank_burst_species"  # CLASS H -- label unconfirmed, see taxonomy doc
)
# G-Hiden (CLASS=L) has no "plain" rows of its own -- every real row carries
# G/GF/GX (confirmed: 280/280/280, summing exactly to the old flat total).
CATEGORY_GRANK_G_HIDEN_G = "grank_g_hiden_g"
CATEGORY_GRANK_G_HIDEN_GF = "grank_g_hiden_gf"
CATEGORY_GRANK_G_HIDEN_GX = "grank_g_hiden_gx"
CATEGORY_GRANK_ORIGIN = "grank_origin"
# Exotic (CLASS=O) has its own internal G/GF/GX escalation on top of a plain
# Exotic tier (confirmed: 110/110/110/110, summing exactly to the old flat
# total).
CATEGORY_GRANK_EXOTIC = "grank_exotic"
CATEGORY_GRANK_EXOTIC_G = "grank_exotic_g"
CATEGORY_GRANK_EXOTIC_GF = "grank_exotic_gf"
CATEGORY_GRANK_EXOTIC_GX = "grank_exotic_gx"

CATEGORY_ZENITH_PLAIN = "zenith_plain"
CATEGORY_ZENITH_ZF = "zenith_zf"
CATEGORY_ZENITH_ZY = "zenith_zy"
CATEGORY_ZENITH_ZX = "zenith_zx"

CATEGORY_HARDCORE_LX = "hardcore_lx"
CATEGORY_HARDCORE_RX = "hardcore_rx"
CATEGORY_HARDCORE_HC = "hardcore_hc"
CATEGORY_HARDCORE_HS = "hardcore_hs"
CATEGORY_HARDCORE_TENRAN = "hardcore_tenran"
CATEGORY_HARDCORE_HASHU = "hardcore_hashu"
CATEGORY_HARDCORE_HIDEN = "hardcore_hiden"  # plain Hiden -- "F" tier only, no FZ/FY
CATEGORY_HARDCORE_HIDEN_F = "hardcore_hiden_f"

CATEGORY_HR100_FX = "hr100_fx"
CATEGORY_HR100_GOU = "hr100_gou"

CATEGORY_EVENT_PLAIN = "event_plain"
CATEGORY_EVENT_PLAIN_F = "event_plain_f"
CATEGORY_EVENT_PLAIN_FZ = "event_plain_fz"
CATEGORY_EVENT_GX = "event_gx"
# CLASS=J (G-Shugo) rows (2026-10-20 audit: 80 real rows, GS/GP evenly split)
# had no branch at all here and were silently falling into CATEGORY_EVENT_PLAIN.
CATEGORY_EVENT_GS = "event_gs"
CATEGORY_EVENT_GP = "event_gp"
# 2026-10-20: CLASS F/E/A (HS/HC/SP) rows had no branch at all here either,
# same bug shape as the GS/GP one above -- 255/91/3 real rows were silently
# falling into CATEGORY_EVENT_PLAIN, found while inspecting event_plain's own
# CLASS breakdown for further structure (every other acquisition route in
# this taxonomy already splits its own HS/HC/SP tier into its own leaf).
CATEGORY_EVENT_HS = "event_hs"
CATEGORY_EVENT_HC = "event_hc"
CATEGORY_EVENT_SP = "event_sp"
CATEGORY_EVENT_ZENITH = "event_zenith"
CATEGORY_EVENT_ZENITH_ZF = "event_zenith_zf"
CATEGORY_EVENT_ZENITH_ZY = "event_zenith_zy"
CATEGORY_EVENT_ZENITH_ZX = "event_zenith_zx"
CATEGORY_EVENT_MYSTERY = "event_mystery"  # 謎 -- Luxt series, GX tier only

# Musou armor -- carved out of what would otherwise be event_plain/event_gx
# (CRE=1e, CLASS=I), confirmed by the project owner against the real armor
# names for all 9 Musou-tier monsters (2026-10-18). Unlike the matching Musou
# *decorations* (which key on a separate BM/GN "<name> GX1".."GX5" naming
# scheme and share one leaf per monster across both names), Musou ARMOR only
# has a genuine two-name split for 2 of the 9 monsters (Guanzorumu, Mi Ru) --
# the other 7 use a single name common to both hunter types. See
# docs/gear-category-taxonomy.md for the full per-monster name table.
#
# 2026-10-20: split by G/GF/GX tier rather than by monster -- the project
# owner asked for "level instead of source" once it was confirmed every one
# of the 9 monster sets independently carries all 3 tiers (audit: 2026-10-20).
# The monster name itself stays visible in the item name; it's no longer a
# separate category branch.
CATEGORY_EVENT_MUSOU_G = "event_musou_g"
CATEGORY_EVENT_MUSOU_GF = "event_musou_gf"
CATEGORY_EVENT_MUSOU_GX = "event_musou_gx"

# Extreme Quest armor -- also carved out of event_plain/event_gx, confirmed
# by the project owner: 4 distinct quests, none tied to an actual Musou
# monster. "Demon Lord"/"童子ノ" is a full 5-slot set (two hunter-type-
# flavored names, same shape as the dual-named Musou monsters above); the
# other 3 are head-slot-only items with no other-slot counterpart. Split by
# G/GF/GX tier rather than by quest, same as Musou above (2026-10-20).
CATEGORY_EVENT_EXTREME_G = "event_extreme_g"
CATEGORY_EVENT_EXTREME_GF = "event_extreme_gf"
CATEGORY_EVENT_EXTREME_GX = "event_extreme_gx"

CATEGORY_TOURNAMENT_PLAIN = "tournament_plain"
CATEGORY_TOURNAMENT_PLAIN_F = "tournament_plain_f"
CATEGORY_TOURNAMENT_PLAIN_FZ = "tournament_plain_fz"
CATEGORY_TOURNAMENT_HC = "tournament_hc"
CATEGORY_TOURNAMENT_HS = "tournament_hs"
CATEGORY_TOURNAMENT_G = "tournament_g"
CATEGORY_TOURNAMENT_GF = "tournament_gf"
CATEGORY_TOURNAMENT_GX = "tournament_gx"
# CLASS=J (G-Shugo): previously one leaf hardcoded to GP, mislabeling half of
# the 6 real rows -- 2026-10-20 audit found 3 GS + 3 GP, not 6 GP.
CATEGORY_TOURNAMENT_GS = "tournament_gs"
CATEGORY_TOURNAMENT_GP = "tournament_gp"
CATEGORY_TOURNAMENT_ZP = "tournament_zp"

CATEGORY_STANDARD_PLAIN = "standard_plain"
CATEGORY_STANDARD_PLAIN_F = "standard_plain_f"
CATEGORY_STANDARD_PLAIN_FZ = "standard_plain_fz"
CATEGORY_STANDARD_SP = "standard_sp"

CATEGORY_UNAVAILABLE_NOT_IMPLEMENTED = "unavailable_not_implemented"
CATEGORY_UNAVAILABLE_TRAINING_ONLY = "unavailable_training_only"

# Cuff category leaf keys -- "Tree 2: Decorations and Cuffs" (Cuffs half) in
# docs/gear-category-taxonomy.md. Prefixed `cuff_` (rather than reusing the
# equipment constants above) because a cuff and an armor piece can land on
# the same CRE code but mean a different leaf in each tree -- see
# `classify_cuff_category`'s own docstring. Display labels for these leaves
# haven't been confirmed against the reference tool's own cuff tree yet
# (unlike every equipment leaf above) -- these keys are correct and already
# usable for filtering, but treat the eventual UI label for each as still
# open, the same way CATEGORY_GRANK_BURST_SPECIES's label is flagged above.
CATEGORY_CUFF_PREMIUM_TIER1 = "cuff_premium_tier1"  # P
CATEGORY_CUFF_PREMIUM_TIER2 = "cuff_premium_tier2"  # P_II
CATEGORY_CUFF_PREMIUM_TIER3 = "cuff_premium_tier3"  # P_G
CATEGORY_CUFF_PREMIUM_NET_CAFE = "cuff_premium_net_cafe"  # P_ネ
CATEGORY_CUFF_PREMIUM_EVENT = "cuff_premium_event"  # P_イ
CATEGORY_CUFF_PREMIUM_SPECIAL = "cuff_premium_special"  # P_特
CATEGORY_CUFF_PREMIUM_ZENITH = "cuff_premium_zenith"  # P_辿
CATEGORY_CUFF_PREMIUM_UNAVAILABLE = "cuff_premium_unavailable"  # P_未

CATEGORY_CUFF_STANDARD_TIER1 = "cuff_standard_tier1"  # S
CATEGORY_CUFF_STANDARD_TIER2 = "cuff_standard_tier2"  # S_G
CATEGORY_CUFF_STANDARD_EVENT = "cuff_standard_event"  # S_イ
CATEGORY_CUFF_STANDARD_MYSTERY_QUEST = "cuff_standard_mystery_quest"  # S_謎
CATEGORY_CUFF_STANDARD_GUILD = "cuff_standard_guild"  # S_猟
CATEGORY_CUFF_STANDARD_FESTIVAL = "cuff_standard_festival"  # S_祭
CATEGORY_CUFF_STANDARD_ZENITH = "cuff_standard_zenith"  # S_辿
CATEGORY_CUFF_STANDARD_UNAVAILABLE = "cuff_standard_unavailable"  # S_未
CATEGORY_CUFF_STANDARD_TRAINING_ONLY = "cuff_standard_training_only"  # S_不
CATEGORY_CUFF_HIDEN = "cuff_hiden"  # 祕

# Decoration category leaf keys -- "Tree 2: Decorations and Cuffs" (Decorations
# half) in docs/gear-category-taxonomy.md. Prefixed `deco_` for the same
# cross-tree-collision reason as the `cuff_` keys above (a decoration row can
# land on the same CRE as an equipment or cuff row but mean a different leaf).
# Tower Gems get their own leaf here purely for traceability -- they're never
# surfaced through this tree in the UI, since they're already filtered by the
# separate, pre-existing `is_tower` flag (see ParsedDecorationRow.is_tower).
CATEGORY_DECO_STANDARD = "deco_standard"  # 無分類
CATEGORY_DECO_G = "deco_g"  # G
CATEGORY_DECO_GX = "deco_gx"  # GX
CATEGORY_DECO_HIDEN = "deco_hiden"  # G祕
CATEGORY_DECO_TRUE_HIDEN = "deco_true_hiden"  # 真G祕
CATEGORY_DECO_LOTTERY_HIDEN = "deco_lottery_hiden"  # ガG祕 ("do not use")
CATEGORY_DECO_RAVIENTE = "deco_raviente"  # 蛇GX
CATEGORY_DECO_EXTREME_RAVIENTE = "deco_extreme_raviente"  # 極蛇GX
# Musou leaves -- confirmed by the project owner against the real decoration
# names (etl/.data/cache/equip.body), since CRE/CLASS alone can't distinguish
# these from any other named monster's G-rank decorations (see
# docs/gear-category-taxonomy.md's "Musou Decorations" table for the full
# name-to-leaf mapping this implements).
CATEGORY_DECO_MUSOU_NARGACUGA = "deco_musou_nargacuga"  # DClad
CATEGORY_DECO_MUSOU_BOGABADORUMU = "deco_musou_bogabadorumu"  # Rapin
CATEGORY_DECO_MUSOU_ZERUREUSU = "deco_musou_zerureusu"  # Elysium
CATEGORY_DECO_MUSOU_DUREMUDIRA = "deco_musou_duremudira"  # Bonne
CATEGORY_DECO_MUSOU_ELZELION = "deco_musou_elzelion"  # Fonce
CATEGORY_DECO_EVENT = "deco_event"  # イ
CATEGORY_DECO_EVENT_G = "deco_event_g"  # イG
CATEGORY_DECO_EVENT_GX = "deco_event_gx"  # イGX
CATEGORY_DECO_FESTIVAL_G = "deco_festival_g"  # 祭G
CATEGORY_DECO_FESTIVAL_GX = "deco_festival_gx"  # 祭GX
CATEGORY_DECO_GUILD_G = "deco_guild_g"  # 猟G
CATEGORY_DECO_GUILD_GX = "deco_guild_gx"  # 猟GX
# Keoaruboru decorations ("Burning Cliff"/"Crimson Cliff") -- confirmed by the
# project owner to be obtained through Diva Defense, i.e. one and the same as
# the reference tool's separate "Diva Def" leaf, not two leaves.
CATEGORY_DECO_KEOARUBORU = "deco_keoaruboru"  # 衛GX
CATEGORY_DECO_ROAD = "deco_road"  # 道
CATEGORY_DECO_ROAD_WHITE_FATALIS = "deco_road_white_fatalis"  # Wht
CATEGORY_DECO_ROAD_GX = "deco_road_gx"  # 道GX ("Multi Event")
CATEGORY_DECO_TOWER = "deco_tower"  # Tower Gem -- not surfaced in the UI tree
# SP decorations (CLASS "A") -- 3 tiers distinguished by name suffix (plain/
# " α"/" β"), confirmed against the real dataset. Like Tower Gems, these are
# restricted to usable-only-in-SP-armor by the project owner (2026-10-18);
# see ParsedDecorationRow.is_sp for the enforcement mechanism this leaf set
# feeds alongside.
CATEGORY_DECO_SP = "deco_sp"  # SP
CATEGORY_DECO_SP_LV2 = "deco_sp_lv2"  # SP改
CATEGORY_DECO_SP_LV3 = "deco_sp_lv3"  # SP真
# Extreme Quest decorations -- carved out of event_gx by curated name, same
# CRE=1e+CLASS=I bucket as the Musou decorations above. Only 3 of the 4
# Extreme Quest sets have a confirmed decoration; "Demon Lord"/童子ノ has none
# (confirmed empty, no leaf -- same convention as Taiwanese Premium armor).
CATEGORY_DECO_EXTREME_HERUTO = "deco_extreme_heruto"
CATEGORY_DECO_EXTREME_IROASU = "deco_extreme_iroasu"
CATEGORY_DECO_EXTREME_LUCHAR = "deco_extreme_luchar"
# Unavailable decorations -- split 3 ways per the reference tool's own tree
# (力/未/不), confirmed against the real dataset: CRE="7-" is Training (same
# code equipment uses for CATEGORY_UNAVAILABLE_TRAINING_ONLY); within CRE="9",
# a literal "作成不可" ("cannot be created") RECIPE1 marks Impossible to
# Create, and an HR1 sentinel of "10000" (unreachable) marks Unimplemented.
CATEGORY_DECO_TRAINING_ONLY = "deco_training_only"  # 力
CATEGORY_DECO_UNIMPLEMENTED = "deco_unimplemented"  # 未
CATEGORY_DECO_IMPOSSIBLE_TO_CREATE = "deco_impossible_to_create"  # 不
# "(特)" in the reference tree -- the only real decoration rows left among the
# lottery/paid CRE codes once Cuffs are excluded are 5 "kit purchase" rows
# (CRE 4k/5-, RECIPE1 literally names an anniversary/premium kit purchase) --
# "(パ) Package" and "(ガTW) Lottery Decorations" have zero real decoration
# rows in this dataset (confirmed empty, no leaf, same as Taiwanese Premium).
# This label is a judgment call, not a project-owner confirmation -- flagged
# the same way CATEGORY_GRANK_BURST_SPECIES's label is.
CATEGORY_DECO_SPECIAL = "deco_special"  # 特, label unconfirmed
CATEGORY_DECO_OTHER = "deco_other"  # anything unmodeled

# Name-suffix tokens that mark a gear tier (NOT the "F"/"FY"/"FZ" forge-level
# upgrade markers, which appear within every category uniformly and don't
# affect classification -- confirmed against the real dataset, e.g. "Ranvuo F
# Coil"/"Ranvuo FY Coil" are just upgraded Caravan-GX armor, not a different
# category). Almost always appear as a standalone whitespace-delimited token
# in equipment names ("{Series} [{SUFFIX}] {SlotWord}"), unlike the
# decoration named-series matching elsewhere in this project, which anchors
# on the series name instead and allows the suffix to appear glued to other
# text -- except the GS/GP marker specifically, which can be glued directly
# onto a kana series name with no preceding space (e.g. "メトリーGS Helm・
# Blue"), confirmed in ~10% of Package's G-Shugo rows during the 2026-10-20
# GS/GP split audit, so `_gs_or_gp` below uses a regex instead of `_tokens`.


def _field(fields: list[str], index: int) -> str:
    return fields[index] if index < len(fields) else ""


def _tokens(name: str) -> frozenset[str]:
    return frozenset(name.split())


_GS_OR_GP_RE = re.compile(r"(?<![A-Za-z])(GS|GP)(?![A-Za-z])")


def _gs_or_gp(name: str) -> str | None:
    """Returns "GS", "GP", or None, for the name-suffix marker that
    distinguishes the two real, evenly-split variants sharing CLASS=J
    (G-Shugo) -- see `_paid_premium_subcategory`.
    """
    match = _GS_OR_GP_RE.search(name)
    return match.group(1) if match else None


def _has_marker(name: str, marker: str) -> bool:
    """Like `marker in _tokens(name)`, but also matches a marker glued
    directly onto other text with no surrounding whitespace -- confirmed
    necessary for "Burning Cliff GX【胴当て】" (Diva Defense's own GX tier),
    the same glued-token situation `_gs_or_gp` above already has to handle.
    """
    return re.search(rf"(?<![A-Za-z]){re.escape(marker)}(?![A-Za-z])", name) is not None


def _f_or_fz(name: str) -> str | None:
    """Returns "F", "FZ", or None, for the tier-2/tier-3 forge-upgrade
    name-suffix marker within a "plain" (`CLASS=""`) bucket -- confirmed via
    direct stat comparison against the real dataset (e.g. Package's "Secuti"
    line: RARE 7/DEF 13 (plain) -> RARE 7/DEF 50 ("F") -> RARE 7/DEF 88
    ("FZ"), before CLASS=F/J pick up from there). "FY" is a differently-
    worded name for the same tier-2 position as "FZ" -- a given armor set's
    own upgrade chain uses either "FY" or "FZ", never both (confirmed: no
    row carries both tokens) -- so both map to the `_fz`-suffixed leaf.

    Only call this where `clazz == ""` -- unlike GS/GP, a bare "F"/"G" token
    is common enough in ordinary item/skill names (e.g. "G・Guard", "Rider
    Head G") that this isn't safe to run unconditionally; restricting it to
    the blank-CLASS "plain" bucket (where only real forge-upgrade rows and
    the already-excluded FX/RX/LX tiers live) avoids every false positive
    found during the 2026-10-20 audit.
    """
    if _has_marker(name, "FZ") or _has_marker(name, "FY"):
        return "FZ"
    if _has_marker(name, "F"):
        return "F"
    return None


def _g_or_gf_or_gx(name: str) -> str | None:
    """Returns "G", "GF", "GX", or None, for the 3-step G-rank upgrade chain
    a CLASS=I/L/O row may carry -- confirmed via direct stat comparison
    against the real dataset (e.g. Festival's "Roses" line: RARE 8/DEF 137
    ("G") -> RARE 10/DEF 146 ("GF") -> RARE 11/DEF 233 ("GX"); TYPE=0 for all
    3, so this isn't a Blademaster/Gunner naming pair).

    Only call this where `clazz` is already confirmed G-rank (I/L/O) -- see
    `_f_or_fz`'s own docstring for why a bare "G" token isn't safe to check
    unconditionally.
    """
    if _has_marker(name, "GX"):
        return "GX"
    if _has_marker(name, "GF"):
        return "GF"
    if _has_marker(name, "G"):
        return "G"
    return None


# Whether a piece is "G Rank or later" (the in-game active-skill-cap piece-
# count rule, see docs/skill-system-roadmap.md TODO #1) is decided purely by
# CLASS -- see docs/data-format-notes.md's "CLASS field" decode table -- and
# is independent of the display category/CRE acquisition route a piece was
# obtained through. Confirmed directly against the real cached dataset: the
# "Paid and Premium" categories (CRE 4k/4g/3-/3e/5-/5p) and some route-level
# "plain"/Festival/Event buckets never split by CLASS at all today, so they
# silently mix below-G-rank pieces with G-rank-or-later ones (e.g.
# paid_gachapon alone holds 1,056 CLASS "Q" Zenith-Shugo rows and 840 CLASS
# "L" G-Hiden rows among its 13,745) -- this function is the authoritative,
# category-independent signal those buckets are missing.
#
# G/GX (G-class) | G-Hashu | Resshu ("Burst Species") | G-Shugo (explicitly
# documented as "G-rank sibling of" plain Shugo/HS) | G-Hiden | Sisyu/Origin |
# Exotic | Zenith/Tan'i (both P and Q tiers).
_GRANK_OR_LATER_CLASSES: frozenset[str] = frozenset(
    {
        _CLASS_G,
        _CLASS_G_HASHU,
        _CLASS_RESSHU,
        _CLASS_G_SHUGO,
        _CLASS_G_HIDEN,
        _CLASS_SISYU,
        _CLASS_EXOTIC,
        _CLASS_ZENITH,
        _CLASS_ZENITH_SHUGO,
    }
)


def is_grank_or_later_equipment(fields: list[str]) -> bool:
    """Whether this equipment row is "G Rank or later" for the active-skill-
    cap piece-count bonus -- see `_GRANK_OR_LATER_CLASSES` above.

    Tower armor (`CLASS="N"`) is a special case: Tower uses one CLASS value
    for every tier, so its G-rank-or-later distinction is carried by the
    name-suffix "G"/"GX" tokens instead (same tokens `classify_equipment_category`
    already keys on for `tower_g`/`tower_gx_custom`), not by CLASS membership.
    """
    clazz = _field(fields, _CLASS)
    if clazz == _CLASS_TOWER:
        tokens = _tokens(_field(fields, _NAME))
        return bool(tokens & {"G", "GF", "GX"})
    return clazz in _GRANK_OR_LATER_CLASSES


# Musou armor name prefixes (CRE=1e, CLASS=I) -- confirmed by the project
# owner against the real armor names (etl/.data/cache/equip.body), covering
# all 9 Musou-tier monsters. Each tuple's names are TYPE=0 (common to both
# hunter types) except where noted; a monster with two names has them as
# wholly separate common armor sets, not a Blademaster/Gunner-restricted
# pair (see CATEGORY_EVENT_MUSOU_G's own comment above). Used only to tell
# "is this Musou armor at all" apart from plain event armor -- the resulting
# category is then decided by G/GF/GX tier, not by which prefix matched.
_EVENT_MUSOU_NAME_PREFIXES: tuple[str, ...] = (
    "Demonclad",
    "鬼凛ノ",
    "童凛ノ",
    "Rapin",
    "Chiru",
    "Elysi",
    "Fonse",
    "Demon Tale",
    "童伝ノ",
    "Ganeto",
    "Bonne",
)

# Extreme Quest armor name prefixes (CRE=1e, CLASS=I) -- confirmed by the
# project owner: 4 distinct quests, none tied to an actual Musou monster (see
# CATEGORY_EVENT_EXTREME_G's own comment above). Used only to tell "is this
# Extreme Quest armor at all" apart from plain event armor -- the resulting
# category is then decided by G/GF/GX tier, not by which prefix matched.
_EVENT_EXTREME_NAME_PREFIXES: tuple[str, ...] = (
    "Demon Lord",
    "童子ノ",
    "Heruto",
    "Iroasu",
    "Luchar",
)

# "Winner and Loser Crowns" (CRE=2m, plain CLASS) -- see
# CATEGORY_GUILD_FESTIVAL_OTHER's own comment above. Only 5 real rows, none
# with a Blademaster/Gunner-pair name.
_FESTIVAL_OTHER_NAME_PREFIX = "祭のあとに"


def _paid_premium_subcategory(
    clazz: str,
    name: str,
    *,
    base: str,
    base_f: str | None = None,
    base_fz: str | None = None,
    hs: str,
    gs: str,
    gp: str,
    hc: str,
    zp: str | None = None,
    hiden: str | None = None,
    hiden_f: str | None = None,
    g_hiden_g: str | None = None,
    g_hiden_gf: str | None = None,
    g_hiden_gx: str | None = None,
    exotic: str | None = None,
    exotic_g: str | None = None,
    exotic_gf: str | None = None,
    exotic_gx: str | None = None,
) -> str:
    """Shared CLASS-tier split for every "Paid and Premium" acquisition route
    (CRE 5p/4k/4g/3-/3e/5-) -- confirmed against the real dataset (2026-10-18)
    to be a complete partition of each route by CLASS alone (name-suffix
    tokens like "HS"/"HC"/"ZP" just corroborate the CLASS value, the same way
    "HS" already corroborates `_CLASS_SHUGO` elsewhere in this file -- they're
    not needed to decide the leaf). A route's own caller only passes the
    keyword leaves it actually has real rows for; any CLASS value without a
    matching keyword falls back to `base` rather than raising, as a defensive
    default (every real route's CLASS set was confirmed complete at
    implementation time, but a cache refresh could in principle surface a
    CLASS value this project hasn't seen yet).

    CLASS=J (G-Shugo) is one exception within this shared tier: it holds 2
    real, evenly-split name-suffix variants ("GS"/"GP") that the project
    owner asked to be split into separate `gs`/`gp` leaves (2026-10-20) to
    match the in-game piece names, via `_gs_or_gp`.

    CLASS "" (`base`), Hiden (`hiden`), G-Hiden, and Exotic are the other
    exceptions (2026-10-20, later same day): each further splits by its own
    rank-ladder rung via `_f_or_fz`/`_g_or_gf_or_gx` -- `base`/`hiden` by
    F/FZ (`base_f`/`base_fz`/`hiden_f`), G-Hiden/Exotic by their own internal
    G/GF/GX escalation (`exotic`/`exotic_g`/`exotic_gf`/`exotic_gx`; G-Hiden
    has no "plain" rows of its own, hence no bare `g_hiden` kwarg). All are
    optional, same no-leaf-for-a-tier-with-0-real-rows convention as every
    other kwarg here.
    """
    if clazz == _CLASS_SHUGO:
        return hs
    if clazz == _CLASS_G_SHUGO:
        marker = _gs_or_gp(name)
        return gp if marker == "GP" else gs
    if clazz == _CLASS_HC:
        return hc
    if zp is not None and clazz == _CLASS_ZENITH_SHUGO:
        return zp
    if hiden is not None and clazz == _CLASS_HIDEN:
        marker = _f_or_fz(name)
        if marker == "F" and hiden_f is not None:
            return hiden_f
        return hiden
    if g_hiden_g is not None and clazz == _CLASS_G_HIDEN:
        marker = _g_or_gf_or_gx(name)
        if marker == "GX":
            return g_hiden_gx if g_hiden_gx is not None else g_hiden_g
        if marker == "GF":
            return g_hiden_gf if g_hiden_gf is not None else g_hiden_g
        return g_hiden_g
    if exotic is not None and clazz == _CLASS_EXOTIC:
        marker = _g_or_gf_or_gx(name)
        if marker == "GX" and exotic_gx is not None:
            return exotic_gx
        if marker == "GF" and exotic_gf is not None:
            return exotic_gf
        if marker == "G" and exotic_g is not None:
            return exotic_g
        return exotic
    if clazz == "":
        marker = _f_or_fz(name)
        if marker == "FZ" and base_fz is not None:
            return base_fz
        if marker == "F" and base_f is not None:
            return base_f
        return base
    return base


def classify_equipment_category(fields: list[str]) -> str:
    """Returns the gear-level category leaf key for one equipment row.

    `fields` is the same raw comma-split field list `parse_equipment_bucket`
    already builds. See docs/gear-category-taxonomy.md for the full decode
    tables and confirmed row counts each branch below implements -- the
    acquisition code (CRE) wins first, with CLASS and the name suffix only
    deciding the leaf *within* a CRE bucket (confirmed precedence from the
    real-data research pass).
    """
    name = _field(fields, _NAME)
    cre = _field(fields, _CRE).replace(
        "#", ""
    )  # "#" is a color-variant toggle, not a separate code
    clazz = _field(fields, _CLASS)
    tokens = _tokens(name)

    if cre == "9":
        return CATEGORY_UNAVAILABLE_NOT_IMPLEMENTED
    if cre == "7-":
        return CATEGORY_UNAVAILABLE_TRAINING_ONLY

    if cre == "5p":
        return _paid_premium_subcategory(
            clazz,
            name,
            base=CATEGORY_PAID_PACKAGE,
            base_f=CATEGORY_PAID_PACKAGE_F,
            base_fz=CATEGORY_PAID_PACKAGE_FZ,
            hs=CATEGORY_PAID_PACKAGE_HS,
            gs=CATEGORY_PAID_PACKAGE_GS,
            gp=CATEGORY_PAID_PACKAGE_GP,
            hc=CATEGORY_PAID_PACKAGE_HC,
        )
    if cre == "4k":
        return _paid_premium_subcategory(
            clazz,
            name,
            base=CATEGORY_PAID_PREMIUM_KIT,
            base_f=CATEGORY_PAID_PREMIUM_KIT_F,
            base_fz=CATEGORY_PAID_PREMIUM_KIT_FZ,
            hs=CATEGORY_PAID_PREMIUM_KIT_HS,
            gs=CATEGORY_PAID_PREMIUM_KIT_GS,
            gp=CATEGORY_PAID_PREMIUM_KIT_GP,
            hc=CATEGORY_PAID_PREMIUM_KIT_HC,
            zp=CATEGORY_PAID_PREMIUM_KIT_ZP,
        )
    if cre == "4g":
        return _paid_premium_subcategory(
            clazz,
            name,
            base=CATEGORY_PAID_GACHAPON,
            base_f=CATEGORY_PAID_GACHAPON_F,
            base_fz=CATEGORY_PAID_GACHAPON_FZ,
            hs=CATEGORY_PAID_GACHAPON_HS,
            gs=CATEGORY_PAID_GACHAPON_GS,
            gp=CATEGORY_PAID_GACHAPON_GP,
            hc=CATEGORY_PAID_GACHAPON_HC,
            zp=CATEGORY_PAID_GACHAPON_ZP,
            hiden=CATEGORY_PAID_GACHAPON_HIDEN,
            hiden_f=CATEGORY_PAID_GACHAPON_HIDEN_F,
            g_hiden_g=CATEGORY_PAID_GACHAPON_G_HIDEN_G,
            g_hiden_gf=CATEGORY_PAID_GACHAPON_G_HIDEN_GF,
            g_hiden_gx=CATEGORY_PAID_GACHAPON_G_HIDEN_GX,
            exotic=CATEGORY_PAID_GACHAPON_EXOTIC,
            exotic_g=CATEGORY_PAID_GACHAPON_EXOTIC_G,
            exotic_gf=CATEGORY_PAID_GACHAPON_EXOTIC_GF,
            exotic_gx=CATEGORY_PAID_GACHAPON_EXOTIC_GX,
        )
    if cre in ("3-", "3e"):
        return _paid_premium_subcategory(
            clazz,
            name,
            base=CATEGORY_PAID_NET_CAFE,
            base_f=CATEGORY_PAID_NET_CAFE_F,
            base_fz=CATEGORY_PAID_NET_CAFE_FZ,
            hs=CATEGORY_PAID_NET_CAFE_HS,
            gs=CATEGORY_PAID_NET_CAFE_GS,
            gp=CATEGORY_PAID_NET_CAFE_GP,
            hc=CATEGORY_PAID_NET_CAFE_HC,
            zp=CATEGORY_PAID_NET_CAFE_ZP,
        )
    if cre == "5-":
        return _paid_premium_subcategory(
            clazz,
            name,
            base=CATEGORY_PAID_PROMOTIONAL,
            base_f=CATEGORY_PAID_PROMOTIONAL_F,
            base_fz=CATEGORY_PAID_PROMOTIONAL_FZ,
            hs=CATEGORY_PAID_PROMOTIONAL_HS,
            gs=CATEGORY_PAID_PROMOTIONAL_GS,
            gp=CATEGORY_PAID_PROMOTIONAL_GP,
            hc=CATEGORY_PAID_PROMOTIONAL_HC,
            zp=CATEGORY_PAID_PROMOTIONAL_ZP,
        )

    if cre == "2u":
        if clazz == _CLASS_G:
            return CATEGORY_DIVA_DEFENSE_GX if _has_marker(name, "GX") else CATEGORY_DIVA_DEFENSE
        if clazz == _CLASS_ZENITH:
            if "ZX" in tokens:
                return CATEGORY_DIVA_DEFENSE_ZENITH_ZX
            if "ZY" in tokens:
                return CATEGORY_DIVA_DEFENSE_ZENITH_ZY
            return CATEGORY_DIVA_DEFENSE_ZENITH  # "Z" or "ZF" -- merged, see comment above
        return CATEGORY_DIVA_DEFENSE
    if cre == "2m":
        if clazz == "":
            if "FX" in tokens:
                return CATEGORY_GUILD_FESTIVAL_FX
            if "RX" in tokens:
                return CATEGORY_GUILD_FESTIVAL_RX
            if "LX" in tokens:
                return CATEGORY_GUILD_FESTIVAL_LX
            if name.startswith(_FESTIVAL_OTHER_NAME_PREFIX):
                return CATEGORY_GUILD_FESTIVAL_OTHER
            marker = _f_or_fz(name)
            if marker == "FZ":
                return CATEGORY_GUILD_FESTIVAL_FZ
            if marker == "F":
                return CATEGORY_GUILD_FESTIVAL_F
            return CATEGORY_GUILD_FESTIVAL
        if clazz == _CLASS_HC:
            return CATEGORY_GUILD_FESTIVAL_HC
        if clazz == _CLASS_SHUGO:
            return CATEGORY_GUILD_FESTIVAL_HS
        if clazz == _CLASS_G:
            marker = _g_or_gf_or_gx(name)
            if marker == "GX":
                return CATEGORY_GUILD_FESTIVAL_GX
            if marker == "GF":
                return CATEGORY_GUILD_FESTIVAL_GF
            return CATEGORY_GUILD_FESTIVAL_G
        return CATEGORY_GUILD_FESTIVAL
    if cre == "2-":
        if _has_marker(name, "GX"):
            return CATEGORY_GUILD_GX
        if clazz == _CLASS_SHUGO:
            return CATEGORY_GUILD_HS
        if clazz == _CLASS_G or clazz == _CLASS_G_SHUGO:
            if _has_marker(name, "GF"):
                return CATEGORY_GUILD_GF
            if _has_marker(name, "G"):
                return CATEGORY_GUILD_G
        if clazz == "":
            marker = _f_or_fz(name)
            if marker == "FZ":
                return CATEGORY_GUILD_PLAIN_FZ
            if marker == "F":
                return CATEGORY_GUILD_PLAIN_F
        return CATEGORY_GUILD_PLAIN

    if cre == "1t":
        if clazz == _CLASS_TOWER:
            if _has_marker(name, "GX"):
                return CATEGORY_TOWER_GX_CUSTOM
            if "HS" in tokens:
                return CATEGORY_TOWER_HS
            if _has_marker(name, "GF"):
                return CATEGORY_TOWER_GF
            if _has_marker(name, "G"):
                return CATEGORY_TOWER_G
            marker = _f_or_fz(name)
            if marker == "FZ":
                return CATEGORY_TOWER_PLAIN_FZ
            if marker == "F":
                return CATEGORY_TOWER_PLAIN_F
            return CATEGORY_TOWER_PLAIN
        if clazz == _CLASS_ZENITH:
            if "ZX" in tokens:
                return CATEGORY_ROAD_ZENITH_ZX
            if "ZY" in tokens:
                return CATEGORY_ROAD_ZENITH_ZY
            if "ZF" in tokens:
                return CATEGORY_ROAD_ZENITH_ZF
            return CATEGORY_ROAD_ZENITH
        if _has_marker(name, "GX"):
            return CATEGORY_ROAD_GX
        if clazz == _CLASS_SHUGO:
            return CATEGORY_ROAD_HS
        if clazz == _CLASS_G:
            if _has_marker(name, "GF"):
                return CATEGORY_ROAD_GF
            if _has_marker(name, "G"):
                return CATEGORY_ROAD_G
        if clazz == "":
            marker = _f_or_fz(name)
            if marker == "FZ":
                return CATEGORY_ROAD_PLAIN_FZ
            if marker == "F":
                return CATEGORY_ROAD_PLAIN_F
        return CATEGORY_ROAD_PLAIN

    if cre == "1c":
        if "RX" in tokens:
            return CATEGORY_CARAVAN_RX
        return CATEGORY_CARAVAN_PLAIN
    if cre == "1s":
        if _has_marker(name, "GX"):
            return CATEGORY_CARAVAN_GX
        if clazz == _CLASS_SHUGO:
            return CATEGORY_CARAVAN_HS
        if clazz == _CLASS_G:
            return CATEGORY_CARAVAN_GF if _has_marker(name, "GF") else CATEGORY_CARAVAN_G
        if clazz == "":
            marker = _f_or_fz(name)
            if marker == "FZ":
                return CATEGORY_CARAVAN_PLAIN_FZ
            if marker == "F":
                return CATEGORY_CARAVAN_PLAIN_F
        return CATEGORY_CARAVAN_PLAIN

    if cre == "1i":
        if clazz == _CLASS_ZENITH_SHUGO:
            return CATEGORY_TOURNAMENT_ZP
        if clazz == _CLASS_G_SHUGO:
            return CATEGORY_TOURNAMENT_GP if _gs_or_gp(name) == "GP" else CATEGORY_TOURNAMENT_GS
        if _has_marker(name, "GX"):
            return CATEGORY_TOURNAMENT_GX
        if clazz == _CLASS_HC:
            return CATEGORY_TOURNAMENT_HC
        if clazz == _CLASS_SHUGO:
            return CATEGORY_TOURNAMENT_HS
        if clazz == _CLASS_G:
            return CATEGORY_TOURNAMENT_GF if _has_marker(name, "GF") else CATEGORY_TOURNAMENT_G
        if clazz == "":
            marker = _f_or_fz(name)
            if marker == "FZ":
                return CATEGORY_TOURNAMENT_PLAIN_FZ
            if marker == "F":
                return CATEGORY_TOURNAMENT_PLAIN_F
        return CATEGORY_TOURNAMENT_PLAIN

    if cre == "1e":
        if clazz == _CLASS_ZENITH:
            if "ZX" in tokens:
                return CATEGORY_EVENT_ZENITH_ZX
            if "ZY" in tokens:
                return CATEGORY_EVENT_ZENITH_ZY
            if "ZF" in tokens:
                return CATEGORY_EVENT_ZENITH_ZF
            return CATEGORY_EVENT_ZENITH
        if clazz == _CLASS_G_SHUGO:
            return CATEGORY_EVENT_GP if _gs_or_gp(name) == "GP" else CATEGORY_EVENT_GS
        if clazz == _CLASS_SHUGO:
            return CATEGORY_EVENT_HS
        if clazz == _CLASS_HC:
            return CATEGORY_EVENT_HC
        if clazz == _CLASS_SP:
            return CATEGORY_EVENT_SP
        if clazz == "" and "FX" in tokens:
            return CATEGORY_HR100_FX
        if clazz == _CLASS_G:
            if name.startswith(_EVENT_EXTREME_NAME_PREFIXES):
                marker = _g_or_gf_or_gx(name)
                if marker == "GX":
                    return CATEGORY_EVENT_EXTREME_GX
                if marker == "GF":
                    return CATEGORY_EVENT_EXTREME_GF
                return CATEGORY_EVENT_EXTREME_G
            if name.startswith(_EVENT_MUSOU_NAME_PREFIXES):
                marker = _g_or_gf_or_gx(name)
                if marker == "GX":
                    return CATEGORY_EVENT_MUSOU_GX
                if marker == "GF":
                    return CATEGORY_EVENT_MUSOU_GF
                return CATEGORY_EVENT_MUSOU_G
            # G/GF-tier non-curated rows deliberately stay merged into
            # event_plain here, matching the reference tool's own 2-leaf
            # "イ/イGX" shape (confirmed via the project owner's screenshot,
            # see CATEGORY_EVENT_PLAIN's own module-level note) -- unlike
            # every other route in this file, Event's G/GF isn't split out.
            # `_has_marker`, not a plain `"GX" in tokens` membership check --
            # 2026-10-20 audit found 29 rows with "GX" glued directly onto
            # following kana/kanji/bracket text (e.g. "若Crimson葉GX【角】",
            # "Youthclad ノ肩鎧GX", "Shirukku GXグローブ") silently falling
            # into event_plain instead, the same glued-marker bug shape fixed
            # elsewhere in this file (road_gx, caravan_gx, grank_exotic_gx).
            if _has_marker(name, "GX"):
                return CATEGORY_EVENT_GX
        if clazz == "":
            marker = _f_or_fz(name)
            if marker == "FZ":
                return CATEGORY_EVENT_PLAIN_FZ
            if marker == "F":
                return CATEGORY_EVENT_PLAIN_F
        return CATEGORY_EVENT_PLAIN

    # Standard tier: CRE is blank/"1"/"-"/"1-" (no special acquisition path).
    # Everything below is decided purely by CLASS and name suffix.
    if clazz == "" and "FX" in tokens:
        return CATEGORY_HR100_FX
    if clazz == _CLASS_GOU:
        return CATEGORY_HR100_GOU
    if clazz == _CLASS_SP:
        return CATEGORY_STANDARD_SP
    if clazz == _CLASS_TENRAN:
        return CATEGORY_HARDCORE_TENRAN
    if clazz == _CLASS_HASHU:
        return CATEGORY_HARDCORE_HASHU
    if clazz == _CLASS_HC:
        return CATEGORY_HARDCORE_HC
    if clazz == _CLASS_SHUGO:
        return CATEGORY_HARDCORE_HS
    if clazz == _CLASS_HIDEN:
        return CATEGORY_HARDCORE_HIDEN_F if _f_or_fz(name) == "F" else CATEGORY_HARDCORE_HIDEN
    if clazz == "" and "LX" in tokens:
        return CATEGORY_HARDCORE_LX
    if clazz == "" and "RX" in tokens:
        return CATEGORY_HARDCORE_RX
    if clazz == _CLASS_G_HASHU:
        return CATEGORY_GRANK_G_HASHU
    if clazz == _CLASS_RESSHU:
        return CATEGORY_GRANK_BURST_SPECIES
    if clazz == _CLASS_G_HIDEN:
        marker = _g_or_gf_or_gx(name)
        if marker == "GX":
            return CATEGORY_GRANK_G_HIDEN_GX
        if marker == "GF":
            return CATEGORY_GRANK_G_HIDEN_GF
        return CATEGORY_GRANK_G_HIDEN_G
    if clazz == _CLASS_SISYU:
        return CATEGORY_GRANK_ORIGIN
    if clazz == _CLASS_EXOTIC:
        marker = _g_or_gf_or_gx(name)
        if marker == "GX":
            return CATEGORY_GRANK_EXOTIC_GX
        if marker == "GF":
            return CATEGORY_GRANK_EXOTIC_GF
        if marker == "G":
            return CATEGORY_GRANK_EXOTIC_G
        return CATEGORY_GRANK_EXOTIC
    if clazz == _CLASS_ZENITH:
        if "ZX" in tokens:
            return CATEGORY_ZENITH_ZX
        if "ZY" in tokens:
            return CATEGORY_ZENITH_ZY
        if "ZF" in tokens:
            return CATEGORY_ZENITH_ZF
        return CATEGORY_ZENITH_PLAIN
    if clazz == _CLASS_G:
        # Mystery Quest Armour ("Luxt" series, GX tier only) -- confirmed by
        # the project owner, but originally miswired into the `cre == "1e"`
        # branch above under the assumption its rows used CRE=1e. The real
        # rows (2026-10-20 audit) are full standard-tier sets (plain/F/FY/HS/
        # G/GF/GX) at CRE=1-, same as any other G-rank armor -- only the GX
        # tier is pulled into its own "Mystery Quest Armour" leaf; G/GF stay
        # in the ordinary grank_g/grank_gf leaves below.
        if name.startswith("Luxt") and _has_marker(name, "GX"):
            return CATEGORY_EVENT_MYSTERY
        marker = _g_or_gf_or_gx(name)
        if marker == "GX":
            return CATEGORY_GRANK_GX
        if marker == "GF":
            return CATEGORY_GRANK_GF
        return CATEGORY_GRANK_G

    marker = _f_or_fz(name)
    if marker == "FZ":
        return CATEGORY_STANDARD_PLAIN_FZ
    if marker == "F":
        return CATEGORY_STANDARD_PLAIN_F
    return CATEGORY_STANDARD_PLAIN


# The name-suffix marker that separates Premium from Standard cuffs --
# confirmed against the real dataset (etl/.data/cache/equip.body): among the
# 2,890 "regular" cuffs (CLASS ""), 1,775 names end in `P` + letter + digit
# (PA1/PB2/PC1/...) and 1,102 end in `S` + letter + digit (SA1/SB2/...); the
# same pattern also separates the 276 "SZ"-slot Zenith cuffs into 250
# premium ("...PZ1" through "...PZ19") vs 26 standard ("...SZ", no digit).
# Confirmed by the project owner: Premium cuffs can only be equipped when
# Poogie is wearing Premium (not Standard) clothes; Standard cuffs are fine
# either way, so this is purely a per-cuff availability tag, not a build-time
# exclusivity constraint (no two cuffs can ever conflict over it).
_PREMIUM_SUFFIX_RE = re.compile(r"P[A-Z]\d+$")


def _is_premium_suffix(name: str) -> bool:
    tokens = name.split()
    return bool(tokens) and _PREMIUM_SUFFIX_RE.search(tokens[-1]) is not None


def classify_cuff_category(fields: list[str]) -> str:
    """Returns the gear-level category leaf key for one cuff row.

    `fields` is the same raw comma-split field list `parse_cuff_bucket`
    already builds (only ever called with rows already confirmed to be
    cuffs -- see `_is_cuff_row`). See docs/gear-category-taxonomy.md's
    "Standard Pugi Cuffs"/"Premium Outfit Pugi Cuffs" tables for the full
    rule set and confirmed row counts this implements -- CRE wins first
    (matching `classify_equipment_category`'s own precedence), with the
    name-suffix Premium/Standard marker only used to disambiguate within a
    CRE bucket that covers both (CRE=4g, CRE=1e, CRE=9).
    """
    name = _field(fields, _NAME)
    cre = _field(fields, _CRE).replace("#", "")
    clazz = _field(fields, _CLASS)
    recipe = _field(fields, _RECIPE1)
    premium = _is_premium_suffix(name)

    if cre == "7-":
        return CATEGORY_CUFF_STANDARD_TRAINING_ONLY
    if cre == "9":
        return CATEGORY_CUFF_PREMIUM_UNAVAILABLE if premium else CATEGORY_CUFF_STANDARD_UNAVAILABLE
    if cre == "4k":
        if recipe[:4] in ("09E5", "09E6", "09E7"):
            return CATEGORY_CUFF_PREMIUM_TIER1
        if recipe[:4] in ("110C", "110D", "110E"):
            return CATEGORY_CUFF_PREMIUM_TIER2
        return CATEGORY_CUFF_PREMIUM_TIER3  # recipe 208A/B/C, or an unseen prefix
    if cre == "3e":
        return CATEGORY_CUFF_PREMIUM_NET_CAFE
    if cre == "1e":
        return CATEGORY_CUFF_PREMIUM_EVENT if premium else CATEGORY_CUFF_STANDARD_EVENT
    if cre == "5-":
        return CATEGORY_CUFF_PREMIUM_SPECIAL
    if cre == "4g":
        return CATEGORY_CUFF_PREMIUM_ZENITH
    if cre == "1i":
        return CATEGORY_CUFF_STANDARD_MYSTERY_QUEST
    if cre in ("2-", "2u"):
        return CATEGORY_CUFF_STANDARD_GUILD
    if cre == "2m":
        return CATEGORY_CUFF_STANDARD_FESTIVAL

    # Remaining rows are all CRE "1-" or "1t" -- decided by CLASS, then HR.
    if clazz == _CLASS_G_HIDEN:
        return CATEGORY_CUFF_HIDEN
    if clazz == _CLASS_ZENITH:
        return CATEGORY_CUFF_STANDARD_ZENITH
    hr = _field(fields, _HR1)
    if hr.isdigit() and int(hr) >= 2001:
        return CATEGORY_CUFF_STANDARD_TIER2
    return CATEGORY_CUFF_STANDARD_TIER1


# Musou leaves share CRE "1e" + CLASS "I" with ordinary Event-GX decorations --
# the only thing that distinguishes them is the decoration's own name, so each
# leaf is keyed on the exact name prefix(es) confirmed against the real
# dataset (both a Blademaster-named and a Gunner-named series can map to the
# same leaf, e.g. "Demonclad"/"Dojiclad" both being Musou Nargacuga).
_MUSOU_NAME_PREFIXES: tuple[tuple[tuple[str, ...], str], ...] = (
    (("Demonclad", "Dojiclad"), CATEGORY_DECO_MUSOU_NARGACUGA),
    (("Rafan",), CATEGORY_DECO_MUSOU_BOGABADORUMU),
    (("Elysium",), CATEGORY_DECO_MUSOU_ZERUREUSU),
    (("Bonne",), CATEGORY_DECO_MUSOU_DUREMUDIRA),
    (("Fonce",), CATEGORY_DECO_MUSOU_ELZELION),
)

# Extreme Quest decoration name prefixes (CRE=1e, CLASS=I) -- confirmed by the
# project owner: only 3 of the 4 Extreme Quest sets have one ("Reiresu",
# "Reuasu", and "Riaruo" are a different, unrelated trio of plain event-GX
# decorations, not Extreme Quest items -- explicitly ruled out).
_EXTREME_NAME_PREFIXES: tuple[tuple[tuple[str, ...], str], ...] = (
    (("Heruto",), CATEGORY_DECO_EXTREME_HERUTO),
    (("Iroasu",), CATEGORY_DECO_EXTREME_IROASU),
    (("Luchar",), CATEGORY_DECO_EXTREME_LUCHAR),
)

# Raviente/Violent Raviente/Berserk Raviente GX decorations (蛇GX) share CRE
# "1-" + CLASS "I" with ordinary G/GX monster decorations -- same situation as
# Musou above, keyed on name prefix. Extreme Raviente GX (極蛇GX) is a fourth,
# separate prefix within the same bucket.
_RAVIENTE_NAME_PREFIXES = ("Raviente", "Violent Ravi", "Berserk Ravi")

_DECO_GX_TIER_RE = re.compile(r"GX\d*$")
_DECO_G_TIER_RE = re.compile(r"G\d*$")
_DECO_GF_TIER_RE = re.compile(r"GF\d*$")


def _has_deco_gx_tier(tokens: frozenset[str]) -> bool:
    # Decoration names carry the GX tier as a "GX"/"GX1".."GX5" token, unlike
    # equipment's always-bare "GX" -- confirmed against the real dataset.
    return any(_DECO_GX_TIER_RE.fullmatch(token) for token in tokens)


def _has_deco_g_or_gf_tier(tokens: frozenset[str]) -> bool:
    # Same numbered-token quirk as GX above (e.g. "Shantien BM G2"/"GF3"), so a
    # bare {"G", "GF"} membership check isn't enough -- but this must still be
    # anchored (fullmatch, not a substring/prefix test) so it doesn't also
    # catch an ordinary monster name that happens to start with "G"
    # (e.g. "Gravios").
    return any(_DECO_G_TIER_RE.fullmatch(t) or _DECO_GF_TIER_RE.fullmatch(t) for t in tokens)


def classify_decoration_category(fields: list[str]) -> str:
    """Returns the decoration-tree category leaf key for one decoration row.

    `fields` is the same raw comma-split field list `parse_decoration_bucket`
    already builds (only ever called with rows already confirmed to be real
    decorations, not Cuffs or UI placeholders). See
    docs/gear-category-taxonomy.md's "Decorations" table for the full rule set
    and confirmed row counts this implements -- CRE wins first (matching
    `classify_equipment_category`/`classify_cuff_category`'s own precedence),
    with CLASS and the decoration's own name only deciding the leaf *within* a
    CRE bucket that needs it.
    """
    name = _field(fields, _NAME)
    cre = _field(fields, _CRE).replace("#", "")
    clazz = _field(fields, _CLASS)
    tokens = _tokens(name)

    if cre == "7-":
        return CATEGORY_DECO_TRAINING_ONLY
    if cre == "9":
        if _field(fields, _RECIPE1) == "作成不可":
            return CATEGORY_DECO_IMPOSSIBLE_TO_CREATE
        return CATEGORY_DECO_UNIMPLEMENTED
    if cre in ("5-", "4k"):
        return CATEGORY_DECO_SPECIAL
    if cre == "4g":
        return CATEGORY_DECO_LOTTERY_HIDEN
    if cre == "2u":
        return CATEGORY_DECO_KEOARUBORU
    if cre == "2m":
        if _has_deco_gx_tier(tokens):
            return CATEGORY_DECO_FESTIVAL_GX
        if _has_deco_g_or_gf_tier(tokens):
            return CATEGORY_DECO_FESTIVAL_G
        return CATEGORY_DECO_OTHER
    if cre == "2-":
        if _has_deco_gx_tier(tokens):
            return CATEGORY_DECO_GUILD_GX
        if _has_deco_g_or_gf_tier(tokens):
            return CATEGORY_DECO_GUILD_G
        return CATEGORY_DECO_OTHER
    if cre == "1t":
        if clazz == _CLASS_TOWER:
            return CATEGORY_DECO_TOWER
        if clazz == _CLASS_G:
            if name.startswith("Wht Fatalis"):
                return CATEGORY_DECO_ROAD_WHITE_FATALIS
            return CATEGORY_DECO_ROAD_GX
        return CATEGORY_DECO_ROAD
    if cre == "1e":
        if clazz == _CLASS_G:
            for prefixes, category in _EXTREME_NAME_PREFIXES:
                if name.startswith(prefixes):
                    return category
            for prefixes, category in _MUSOU_NAME_PREFIXES:
                if name.startswith(prefixes):
                    return category
            if _has_deco_gx_tier(tokens):
                return CATEGORY_DECO_EVENT_GX
            if _has_deco_g_or_gf_tier(tokens):
                return CATEGORY_DECO_EVENT_G
            return CATEGORY_DECO_OTHER
        return CATEGORY_DECO_EVENT

    # Standard tier: CRE is "1-" (no special acquisition path). Everything
    # below is decided purely by CLASS and name.
    if clazz == _CLASS_G_HIDEN:
        if "True?" in name:
            return CATEGORY_DECO_TRUE_HIDEN
        if "Hiden?" in name:
            return CATEGORY_DECO_HIDEN
        return CATEGORY_DECO_OTHER
    if clazz == _CLASS_G:
        if name.startswith(_RAVIENTE_NAME_PREFIXES):
            return CATEGORY_DECO_RAVIENTE
        if name.startswith("Extreme Ravi"):
            return CATEGORY_DECO_EXTREME_RAVIENTE
        if _has_deco_gx_tier(tokens):
            return CATEGORY_DECO_GX
        if _has_deco_g_or_gf_tier(tokens):
            return CATEGORY_DECO_G
        return CATEGORY_DECO_OTHER
    if clazz == _CLASS_SP:
        if name.endswith("SP β"):  # β -- 2nd recipe tier, references the α item
            return CATEGORY_DECO_SP_LV3
        if name.endswith("SP α"):  # α -- 1st recipe tier, references the base SP item
            return CATEGORY_DECO_SP_LV2
        return CATEGORY_DECO_SP
    if clazz == "":
        return CATEGORY_DECO_STANDARD
    return CATEGORY_DECO_OTHER  # anything unmodeled
