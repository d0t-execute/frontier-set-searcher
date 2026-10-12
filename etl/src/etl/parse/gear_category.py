"""Classifies an equipment row into the reference set-searcher's gear-level
category leaf, from the raw CRE (acquisition method), CLASS (origin tier),
and name-suffix fields already scraped out of skill/equip.js.

Every rule here, including the leaf names and their confirmed row counts, is
documented in docs/gear-category-taxonomy.md -- that file is the source of
truth for *why* a given field combination maps to a given leaf; this module
is just its implementation.

Field indices are duplicated here (rather than imported from
etl.parse.equipment.Field) to avoid a circular import -- equipment.py calls
into this module, so this module can't import back from equipment.py.
"""

from __future__ import annotations

_NAME = 0
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
