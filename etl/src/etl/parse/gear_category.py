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
CATEGORY_PAID_PACKAGE = "paid_package"
CATEGORY_PAID_PREMIUM_KIT = "paid_premium_kit"
CATEGORY_PAID_GACHAPON = "paid_gachapon"
CATEGORY_PAID_NET_CAFE = "paid_net_cafe"
CATEGORY_PAID_PROMOTIONAL = "paid_promotional"

CATEGORY_GUILD_FESTIVAL = "guild_festival"
CATEGORY_GUILD_PLAIN = "guild_plain"
CATEGORY_GUILD_HS = "guild_hs"
CATEGORY_GUILD_G = "guild_g"
CATEGORY_GUILD_GX = "guild_gx"

CATEGORY_DIVA_DEFENSE = "diva_defense"

CATEGORY_TOWER_PLAIN = "tower_plain"
CATEGORY_TOWER_HS = "tower_hs"
CATEGORY_TOWER_G = "tower_g"
CATEGORY_TOWER_GX_CUSTOM = "tower_gx_custom"  # 刻GX

CATEGORY_CARAVAN_PLAIN = "caravan_plain"
CATEGORY_CARAVAN_RX = "caravan_rx"
CATEGORY_CARAVAN_HS = "caravan_hs"
CATEGORY_CARAVAN_G = "caravan_g"
CATEGORY_CARAVAN_GX = "caravan_gx"

CATEGORY_ROAD_PLAIN = "road_plain"
CATEGORY_ROAD_HS = "road_hs"
CATEGORY_ROAD_G = "road_g"
CATEGORY_ROAD_GX = "road_gx"
CATEGORY_ROAD_ZENITH = "road_zenith"
CATEGORY_ROAD_ZENITH_ZY = "road_zenith_zy"
CATEGORY_ROAD_ZENITH_ZX = "road_zenith_zx"

CATEGORY_GRANK_G = "grank_g"
CATEGORY_GRANK_GX = "grank_gx"
CATEGORY_GRANK_G_HASHU = "grank_g_hashu"
CATEGORY_GRANK_BURST_SPECIES = (
    "grank_burst_species"  # CLASS H -- label unconfirmed, see taxonomy doc
)
CATEGORY_GRANK_G_HIDEN = "grank_g_hiden"
CATEGORY_GRANK_ORIGIN = "grank_origin"
CATEGORY_GRANK_EXOTIC = "grank_exotic"
CATEGORY_GRANK_EXOTIC_GX = "grank_exotic_gx"

CATEGORY_ZENITH_PLAIN = "zenith_plain"
CATEGORY_ZENITH_ZY = "zenith_zy"
CATEGORY_ZENITH_ZX = "zenith_zx"

CATEGORY_HARDCORE_LX = "hardcore_lx"
CATEGORY_HARDCORE_RX = "hardcore_rx"
CATEGORY_HARDCORE_HC = "hardcore_hc"
CATEGORY_HARDCORE_HS = "hardcore_hs"
CATEGORY_HARDCORE_TENRAN = "hardcore_tenran"
CATEGORY_HARDCORE_HASHU = "hardcore_hashu"
CATEGORY_HARDCORE_HIDEN = "hardcore_hiden"

CATEGORY_HR100_FX = "hr100_fx"
CATEGORY_HR100_GOU = "hr100_gou"

CATEGORY_EVENT_PLAIN = "event_plain"
CATEGORY_EVENT_ZENITH = "event_zenith"
CATEGORY_EVENT_ZENITH_ZY = "event_zenith_zy"
CATEGORY_EVENT_ZENITH_ZX = "event_zenith_zx"
CATEGORY_EVENT_MYSTERY = "event_mystery"  # 謎 -- Luxt series, GX tier only

CATEGORY_TOURNAMENT_PLAIN = "tournament_plain"
CATEGORY_TOURNAMENT_HC = "tournament_hc"
CATEGORY_TOURNAMENT_HS = "tournament_hs"
CATEGORY_TOURNAMENT_G = "tournament_g"
CATEGORY_TOURNAMENT_GX = "tournament_gx"
CATEGORY_TOURNAMENT_GP = "tournament_gp"
CATEGORY_TOURNAMENT_ZP = "tournament_zp"

CATEGORY_STANDARD_PLAIN = "standard_plain"
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
CATEGORY_DECO_OTHER = "deco_other"  # SP改/SP真, Unavailable rows, anything unmodeled

# Name-suffix tokens that mark a gear tier (NOT the "F"/"FY"/"FZ" forge-level
# upgrade markers, which appear within every category uniformly and don't
# affect classification -- confirmed against the real dataset, e.g. "Ranvuo F
# Coil"/"Ranvuo FY Coil" are just upgraded Caravan-GX armor, not a different
# category). Always appear as a standalone whitespace-delimited token in
# equipment names ("{Series} [{SUFFIX}] {SlotWord}"), unlike the decoration
# named-series matching elsewhere in this project, which anchors on the
# series name instead and allows the suffix to appear glued to other text.


def _field(fields: list[str], index: int) -> str:
    return fields[index] if index < len(fields) else ""


def _tokens(name: str) -> frozenset[str]:
    return frozenset(name.split())


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
        return CATEGORY_PAID_PACKAGE
    if cre == "4k":
        return CATEGORY_PAID_PREMIUM_KIT
    if cre == "4g":
        return CATEGORY_PAID_GACHAPON
    if cre in ("3-", "3e"):
        return CATEGORY_PAID_NET_CAFE
    if cre == "5-":
        return CATEGORY_PAID_PROMOTIONAL

    if cre == "2u":
        return CATEGORY_DIVA_DEFENSE
    if cre == "2m":
        if clazz == "" and "FX" in tokens:
            return CATEGORY_HR100_FX
        return CATEGORY_GUILD_FESTIVAL
    if cre == "2-":
        if "GX" in tokens:
            return CATEGORY_GUILD_GX
        if clazz == _CLASS_SHUGO:
            return CATEGORY_GUILD_HS
        if tokens & {"G", "GF"}:
            return CATEGORY_GUILD_G
        return CATEGORY_GUILD_PLAIN

    if cre == "1t":
        if clazz == _CLASS_TOWER:
            if "GX" in tokens:
                return CATEGORY_TOWER_GX_CUSTOM
            if "HS" in tokens:
                return CATEGORY_TOWER_HS
            if tokens & {"G", "GF"}:
                return CATEGORY_TOWER_G
            return CATEGORY_TOWER_PLAIN
        if clazz == _CLASS_ZENITH:
            if "ZX" in tokens:
                return CATEGORY_ROAD_ZENITH_ZX
            if "ZY" in tokens:
                return CATEGORY_ROAD_ZENITH_ZY
            return CATEGORY_ROAD_ZENITH
        if "GX" in tokens:
            return CATEGORY_ROAD_GX
        if clazz == _CLASS_SHUGO:
            return CATEGORY_ROAD_HS
        if tokens & {"G", "GF"}:
            return CATEGORY_ROAD_G
        return CATEGORY_ROAD_PLAIN

    if cre == "1c":
        if "RX" in tokens:
            return CATEGORY_CARAVAN_RX
        return CATEGORY_CARAVAN_PLAIN
    if cre == "1s":
        if "GX" in tokens:
            return CATEGORY_CARAVAN_GX
        if clazz == _CLASS_SHUGO:
            return CATEGORY_CARAVAN_HS
        if clazz == _CLASS_G:
            return CATEGORY_CARAVAN_G
        return CATEGORY_CARAVAN_PLAIN

    if cre == "1i":
        if clazz == _CLASS_ZENITH_SHUGO:
            return CATEGORY_TOURNAMENT_ZP
        if clazz == _CLASS_G_SHUGO:
            return CATEGORY_TOURNAMENT_GP
        if "GX" in tokens:
            return CATEGORY_TOURNAMENT_GX
        if clazz == _CLASS_HC:
            return CATEGORY_TOURNAMENT_HC
        if clazz == _CLASS_SHUGO:
            return CATEGORY_TOURNAMENT_HS
        if clazz == _CLASS_G:
            return CATEGORY_TOURNAMENT_G
        return CATEGORY_TOURNAMENT_PLAIN

    if cre == "1e":
        if clazz == _CLASS_ZENITH:
            if "ZX" in tokens:
                return CATEGORY_EVENT_ZENITH_ZX
            if "ZY" in tokens:
                return CATEGORY_EVENT_ZENITH_ZY
            return CATEGORY_EVENT_ZENITH
        if name.startswith("Luxt") and "GX" in tokens:
            return CATEGORY_EVENT_MYSTERY
        if clazz == "" and "FX" in tokens:
            return CATEGORY_HR100_FX
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
        return CATEGORY_HARDCORE_HIDEN
    if clazz == "" and "LX" in tokens:
        return CATEGORY_HARDCORE_LX
    if clazz == "" and "RX" in tokens:
        return CATEGORY_HARDCORE_RX
    if clazz == _CLASS_G_HASHU:
        return CATEGORY_GRANK_G_HASHU
    if clazz == _CLASS_RESSHU:
        return CATEGORY_GRANK_BURST_SPECIES
    if clazz == _CLASS_G_HIDEN:
        return CATEGORY_GRANK_G_HIDEN
    if clazz == _CLASS_SISYU:
        return CATEGORY_GRANK_ORIGIN
    if clazz == _CLASS_EXOTIC:
        return CATEGORY_GRANK_EXOTIC_GX if "GX" in tokens else CATEGORY_GRANK_EXOTIC
    if clazz == _CLASS_ZENITH:
        if "ZX" in tokens:
            return CATEGORY_ZENITH_ZX
        if "ZY" in tokens:
            return CATEGORY_ZENITH_ZY
        return CATEGORY_ZENITH_PLAIN
    if clazz == _CLASS_G:
        return CATEGORY_GRANK_GX if "GX" in tokens else CATEGORY_GRANK_G

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

    if cre in ("9", "7-", "5-", "4k"):
        return CATEGORY_DECO_OTHER
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
    if clazz == "":
        return CATEGORY_DECO_STANDARD
    return CATEGORY_DECO_OTHER  # CLASS "A" (SP改/SP真) and anything else unmodeled
