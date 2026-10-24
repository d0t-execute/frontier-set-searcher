"""Covers classify_equipment_category's decision tree against representative
rows for every leaf in docs/gear-category-taxonomy.md's equipment tree.

Fields are built as a flat, comma-split list matching the real row shape
(see docs/data-format-notes.md): only NAME (0), CRE (33) and CLASS (35)
matter to this module, so every other index is left blank except where a
test needs to name a real example row for traceability.
"""

from etl.parse.gear_category import (
    CATEGORY_CARAVAN_G,
    CATEGORY_CARAVAN_GF,
    CATEGORY_CARAVAN_GX,
    CATEGORY_CARAVAN_HS,
    CATEGORY_CARAVAN_PLAIN,
    CATEGORY_CARAVAN_PLAIN_F,
    CATEGORY_CARAVAN_PLAIN_FZ,
    CATEGORY_CARAVAN_RX,
    CATEGORY_CUFF_HIDEN,
    CATEGORY_CUFF_PREMIUM_EVENT,
    CATEGORY_CUFF_PREMIUM_NET_CAFE,
    CATEGORY_CUFF_PREMIUM_SPECIAL,
    CATEGORY_CUFF_PREMIUM_TIER1,
    CATEGORY_CUFF_PREMIUM_TIER2,
    CATEGORY_CUFF_PREMIUM_TIER3,
    CATEGORY_CUFF_PREMIUM_UNAVAILABLE,
    CATEGORY_CUFF_PREMIUM_ZENITH,
    CATEGORY_CUFF_STANDARD_EVENT,
    CATEGORY_CUFF_STANDARD_FESTIVAL,
    CATEGORY_CUFF_STANDARD_GUILD,
    CATEGORY_CUFF_STANDARD_MYSTERY_QUEST,
    CATEGORY_CUFF_STANDARD_TIER1,
    CATEGORY_CUFF_STANDARD_TIER2,
    CATEGORY_CUFF_STANDARD_TRAINING_ONLY,
    CATEGORY_CUFF_STANDARD_UNAVAILABLE,
    CATEGORY_CUFF_STANDARD_ZENITH,
    CATEGORY_DECO_EVENT,
    CATEGORY_DECO_EVENT_G,
    CATEGORY_DECO_EVENT_GX,
    CATEGORY_DECO_EXTREME_HERUTO,
    CATEGORY_DECO_EXTREME_IROASU,
    CATEGORY_DECO_EXTREME_LUCHAR,
    CATEGORY_DECO_EXTREME_RAVIENTE,
    CATEGORY_DECO_FESTIVAL_G,
    CATEGORY_DECO_FESTIVAL_GX,
    CATEGORY_DECO_G,
    CATEGORY_DECO_GUILD_G,
    CATEGORY_DECO_GUILD_GX,
    CATEGORY_DECO_GX,
    CATEGORY_DECO_HIDEN,
    CATEGORY_DECO_IMPOSSIBLE_TO_CREATE,
    CATEGORY_DECO_KEOARUBORU,
    CATEGORY_DECO_LOTTERY_HIDEN,
    CATEGORY_DECO_MUSOU_BOGABADORUMU,
    CATEGORY_DECO_MUSOU_DUREMUDIRA,
    CATEGORY_DECO_MUSOU_ELZELION,
    CATEGORY_DECO_MUSOU_NARGACUGA,
    CATEGORY_DECO_MUSOU_ZERUREUSU,
    CATEGORY_DECO_OTHER,
    # (decorations keep their own, unmodified category module -- unaffected by
    # the equipment-side F/FZ and G/GF/GX split below)
    CATEGORY_DECO_RAVIENTE,
    CATEGORY_DECO_ROAD,
    CATEGORY_DECO_ROAD_GX,
    CATEGORY_DECO_ROAD_WHITE_FATALIS,
    CATEGORY_DECO_SP,
    CATEGORY_DECO_SP_LV2,
    CATEGORY_DECO_SP_LV3,
    CATEGORY_DECO_SPECIAL,
    CATEGORY_DECO_STANDARD,
    CATEGORY_DECO_TOWER,
    CATEGORY_DECO_TRAINING_ONLY,
    CATEGORY_DECO_TRUE_HIDEN,
    CATEGORY_DECO_UNIMPLEMENTED,
    CATEGORY_DIVA_DEFENSE,
    CATEGORY_DIVA_DEFENSE_GX,
    CATEGORY_DIVA_DEFENSE_ZENITH,
    CATEGORY_DIVA_DEFENSE_ZENITH_ZF,
    CATEGORY_DIVA_DEFENSE_ZENITH_ZX,
    CATEGORY_DIVA_DEFENSE_ZENITH_ZY,
    CATEGORY_EVENT_EXTREME_G,
    CATEGORY_EVENT_EXTREME_GF,
    CATEGORY_EVENT_EXTREME_GX,
    CATEGORY_EVENT_GP,
    CATEGORY_EVENT_GS,
    CATEGORY_EVENT_GX,
    CATEGORY_EVENT_HC,
    CATEGORY_EVENT_HS,
    CATEGORY_EVENT_MUSOU_G,
    CATEGORY_EVENT_MUSOU_GF,
    CATEGORY_EVENT_MUSOU_GX,
    CATEGORY_EVENT_MYSTERY,
    CATEGORY_EVENT_PLAIN,
    CATEGORY_EVENT_PLAIN_F,
    CATEGORY_EVENT_PLAIN_FZ,
    CATEGORY_EVENT_SP,
    CATEGORY_EVENT_ZENITH,
    CATEGORY_EVENT_ZENITH_ZF,
    CATEGORY_EVENT_ZENITH_ZX,
    CATEGORY_EVENT_ZENITH_ZY,
    CATEGORY_GRANK_BURST_SPECIES,
    CATEGORY_GRANK_EXOTIC,
    CATEGORY_GRANK_EXOTIC_G,
    CATEGORY_GRANK_EXOTIC_GF,
    CATEGORY_GRANK_EXOTIC_GX,
    CATEGORY_GRANK_G,
    CATEGORY_GRANK_G_HASHU,
    CATEGORY_GRANK_G_HIDEN_G,
    CATEGORY_GRANK_G_HIDEN_GF,
    CATEGORY_GRANK_G_HIDEN_GX,
    CATEGORY_GRANK_GF,
    CATEGORY_GRANK_GX,
    CATEGORY_GRANK_ORIGIN,
    CATEGORY_GUILD_FESTIVAL,
    CATEGORY_GUILD_FESTIVAL_FX,
    CATEGORY_GUILD_FESTIVAL_G,
    CATEGORY_GUILD_FESTIVAL_GF,
    CATEGORY_GUILD_FESTIVAL_GX,
    CATEGORY_GUILD_FESTIVAL_HC,
    CATEGORY_GUILD_FESTIVAL_HS,
    CATEGORY_GUILD_FESTIVAL_LX,
    CATEGORY_GUILD_FESTIVAL_OTHER,
    CATEGORY_GUILD_FESTIVAL_RX,
    CATEGORY_GUILD_G,
    CATEGORY_GUILD_GF,
    CATEGORY_GUILD_GX,
    CATEGORY_GUILD_HS,
    CATEGORY_GUILD_PLAIN,
    CATEGORY_GUILD_PLAIN_F,
    CATEGORY_GUILD_PLAIN_FZ,
    CATEGORY_HARDCORE_HASHU,
    CATEGORY_HARDCORE_HC,
    CATEGORY_HARDCORE_HIDEN,
    CATEGORY_HARDCORE_HIDEN_F,
    CATEGORY_HARDCORE_HS,
    CATEGORY_HARDCORE_LX,
    CATEGORY_HARDCORE_RX,
    CATEGORY_HARDCORE_TENRAN,
    CATEGORY_HR100_FX,
    CATEGORY_HR100_GOU,
    CATEGORY_PAID_GACHAPON,
    CATEGORY_PAID_GACHAPON_EXOTIC,
    CATEGORY_PAID_GACHAPON_EXOTIC_GX,
    CATEGORY_PAID_GACHAPON_G_HIDEN_GX,
    CATEGORY_PAID_GACHAPON_GP,
    CATEGORY_PAID_GACHAPON_GS,
    CATEGORY_PAID_GACHAPON_HC,
    CATEGORY_PAID_GACHAPON_HIDEN,
    CATEGORY_PAID_GACHAPON_HS,
    CATEGORY_PAID_GACHAPON_ZP,
    CATEGORY_PAID_NET_CAFE,
    CATEGORY_PAID_NET_CAFE_GP,
    CATEGORY_PAID_NET_CAFE_GS,
    CATEGORY_PAID_NET_CAFE_HC,
    CATEGORY_PAID_NET_CAFE_HS,
    CATEGORY_PAID_NET_CAFE_ZP,
    CATEGORY_PAID_PACKAGE,
    CATEGORY_PAID_PACKAGE_F,
    CATEGORY_PAID_PACKAGE_FZ,
    CATEGORY_PAID_PACKAGE_GP,
    CATEGORY_PAID_PACKAGE_GS,
    CATEGORY_PAID_PACKAGE_HC,
    CATEGORY_PAID_PACKAGE_HS,
    CATEGORY_PAID_PREMIUM_KIT,
    CATEGORY_PAID_PREMIUM_KIT_FZ,
    CATEGORY_PAID_PREMIUM_KIT_GP,
    CATEGORY_PAID_PREMIUM_KIT_GS,
    CATEGORY_PAID_PREMIUM_KIT_HC,
    CATEGORY_PAID_PREMIUM_KIT_HS,
    CATEGORY_PAID_PREMIUM_KIT_ZP,
    CATEGORY_PAID_PROMOTIONAL,
    CATEGORY_PAID_PROMOTIONAL_GP,
    CATEGORY_PAID_PROMOTIONAL_GS,
    CATEGORY_PAID_PROMOTIONAL_HC,
    CATEGORY_PAID_PROMOTIONAL_HS,
    CATEGORY_PAID_PROMOTIONAL_ZP,
    CATEGORY_ROAD_G,
    CATEGORY_ROAD_GF,
    CATEGORY_ROAD_GX,
    CATEGORY_ROAD_HS,
    CATEGORY_ROAD_PLAIN,
    CATEGORY_ROAD_PLAIN_F,
    CATEGORY_ROAD_PLAIN_FZ,
    CATEGORY_ROAD_ZENITH,
    CATEGORY_ROAD_ZENITH_ZF,
    CATEGORY_ROAD_ZENITH_ZX,
    CATEGORY_ROAD_ZENITH_ZY,
    CATEGORY_STANDARD_PLAIN,
    CATEGORY_STANDARD_PLAIN_F,
    CATEGORY_STANDARD_PLAIN_FZ,
    CATEGORY_STANDARD_SP,
    CATEGORY_TOURNAMENT_G,
    CATEGORY_TOURNAMENT_GF,
    CATEGORY_TOURNAMENT_GP,
    CATEGORY_TOURNAMENT_GS,
    CATEGORY_TOURNAMENT_GX,
    CATEGORY_TOURNAMENT_HC,
    CATEGORY_TOURNAMENT_HS,
    CATEGORY_TOURNAMENT_PLAIN,
    CATEGORY_TOURNAMENT_PLAIN_F,
    CATEGORY_TOURNAMENT_PLAIN_FZ,
    CATEGORY_TOURNAMENT_ZP,
    CATEGORY_TOWER_G,
    CATEGORY_TOWER_GF,
    CATEGORY_TOWER_GX_CUSTOM,
    CATEGORY_TOWER_HS,
    CATEGORY_TOWER_PLAIN,
    CATEGORY_TOWER_PLAIN_F,
    CATEGORY_TOWER_PLAIN_FZ,
    CATEGORY_UNAVAILABLE_NOT_IMPLEMENTED,
    CATEGORY_UNAVAILABLE_TRAINING_ONLY,
    CATEGORY_ZENITH_PLAIN,
    CATEGORY_ZENITH_ZF,
    CATEGORY_ZENITH_ZX,
    CATEGORY_ZENITH_ZY,
    classify_cuff_category,
    classify_decoration_category,
    classify_equipment_category,
    is_grank_or_later_equipment,
)


def _row(name: str, cre: str = "", clazz: str = "", recipe: str = "", hr: str = "") -> list[str]:
    fields = [""] * 36
    fields[0] = name
    fields[21] = recipe
    fields[22] = hr
    fields[33] = cre
    fields[35] = clazz
    return fields


def _cuff_row(
    name: str, cre: str = "", clazz: str = "", recipe: str = "", hr: str = ""
) -> list[str]:
    fields = [""] * 36
    fields[0] = name
    fields[21] = recipe
    fields[22] = hr
    fields[33] = cre
    fields[35] = clazz
    return fields


# -- Paid and Premium ---------------------------------------------------------


def test_package() -> None:
    assert classify_equipment_category(_row("Rough Felyne Mask", cre="5p")) == CATEGORY_PAID_PACKAGE


def test_premium_kit() -> None:
    assert (
        classify_equipment_category(_row("White Cat Mask", cre="4k")) == CATEGORY_PAID_PREMIUM_KIT
    )


def test_premium_kit_strips_the_color_variant_hash() -> None:
    # "#" marks a colour-variant row (the site's own c_color toggle), not a
    # separate acquisition method -- confirmed against the real dataset.
    assert classify_equipment_category(_row("Steno Vest", cre="4k#")) == CATEGORY_PAID_PREMIUM_KIT


def test_gachapon() -> None:
    assert classify_equipment_category(_row("Ukon GS Head", cre="4g")) == CATEGORY_PAID_GACHAPON


def test_net_cafe() -> None:
    assert classify_equipment_category(_row("Kyuura Head", cre="3-")) == CATEGORY_PAID_NET_CAFE
    assert (
        classify_equipment_category(_row("Regyukusu GS Head", cre="3e")) == CATEGORY_PAID_NET_CAFE
    )


def test_promotional() -> None:
    assert classify_equipment_category(_row("Nova Helm", cre="5-")) == CATEGORY_PAID_PROMOTIONAL


def test_paid_premium_subcategories() -> None:
    # Every "Paid and Premium" route splits by CLASS into the same tier
    # structure (confirmed against the real dataset, 2026-10-18) -- each
    # route only has real rows for some of the 7 possible tiers.
    assert (
        classify_equipment_category(_row("Secuti HS Helm", cre="5p", clazz="F"))
        == CATEGORY_PAID_PACKAGE_HS
    )
    assert (
        classify_equipment_category(_row("Secuti GS Helm", cre="5p", clazz="J"))
        == CATEGORY_PAID_PACKAGE_GS
    )
    assert (
        classify_equipment_category(_row("Secuti GP Helm", cre="5p", clazz="J"))
        == CATEGORY_PAID_PACKAGE_GP
    )
    assert (
        classify_equipment_category(_row("Teriogu HC Cap", cre="5p", clazz="E"))
        == CATEGORY_PAID_PACKAGE_HC
    )

    assert (
        classify_equipment_category(_row("Secuti HS Helm", cre="4k", clazz="F"))
        == CATEGORY_PAID_PREMIUM_KIT_HS
    )
    assert (
        classify_equipment_category(_row("Secuti GS Helm", cre="4k", clazz="J"))
        == CATEGORY_PAID_PREMIUM_KIT_GS
    )
    assert (
        classify_equipment_category(_row("Secuti GP Helm", cre="4k", clazz="J"))
        == CATEGORY_PAID_PREMIUM_KIT_GP
    )
    assert (
        classify_equipment_category(_row("Teriogu HC Cap", cre="4k", clazz="E"))
        == CATEGORY_PAID_PREMIUM_KIT_HC
    )
    assert (
        classify_equipment_category(_row("Evol ZP Head", cre="4k", clazz="Q"))
        == CATEGORY_PAID_PREMIUM_KIT_ZP
    )

    assert (
        classify_equipment_category(_row("Secuti HS Helm", cre="4g", clazz="F"))
        == CATEGORY_PAID_GACHAPON_HS
    )
    assert (
        classify_equipment_category(_row("Ukon GS Head", cre="4g", clazz="J"))
        == CATEGORY_PAID_GACHAPON_GS
    )
    assert (
        classify_equipment_category(_row("Shoko GP Head", cre="4g", clazz="J"))
        == CATEGORY_PAID_GACHAPON_GP
    )
    assert (
        classify_equipment_category(_row("Teriogu HC Cap", cre="4g", clazz="E"))
        == CATEGORY_PAID_GACHAPON_HC
    )
    assert (
        classify_equipment_category(_row("Evol ZP Head", cre="4g", clazz="Q"))
        == CATEGORY_PAID_GACHAPON_ZP
    )
    assert (
        classify_equipment_category(_row("White Kensei Helm", cre="4g", clazz="K"))
        == CATEGORY_PAID_GACHAPON_HIDEN
    )
    assert (
        classify_equipment_category(_row("White Kensei GX Helm", cre="4g", clazz="L"))
        == CATEGORY_PAID_GACHAPON_G_HIDEN_GX
    )
    assert (
        classify_equipment_category(_row("Yukumo Kasa", cre="4g", clazz="O"))
        == CATEGORY_PAID_GACHAPON_EXOTIC
    )
    assert (
        classify_equipment_category(_row("Yukumo Kasa GX", cre="4g", clazz="O"))
        == CATEGORY_PAID_GACHAPON_EXOTIC_GX
    )

    assert (
        classify_equipment_category(_row("Secuti HS Helm", cre="3-", clazz="F"))
        == CATEGORY_PAID_NET_CAFE_HS
    )
    assert (
        classify_equipment_category(_row("Regyukusu GS Head", cre="3e", clazz="J"))
        == CATEGORY_PAID_NET_CAFE_GS
    )
    assert (
        classify_equipment_category(_row("Regyukusu GP Head", cre="3e", clazz="J"))
        == CATEGORY_PAID_NET_CAFE_GP
    )
    assert (
        classify_equipment_category(_row("Teriogu HC Cap", cre="3-", clazz="E"))
        == CATEGORY_PAID_NET_CAFE_HC
    )
    assert (
        classify_equipment_category(_row("Evol ZP Head", cre="3e", clazz="Q"))
        == CATEGORY_PAID_NET_CAFE_ZP
    )

    assert (
        classify_equipment_category(_row("Secuti HS Helm", cre="5-", clazz="F"))
        == CATEGORY_PAID_PROMOTIONAL_HS
    )
    assert (
        classify_equipment_category(_row("Welf GS Helm", cre="5-", clazz="J"))
        == CATEGORY_PAID_PROMOTIONAL_GS
    )
    assert (
        classify_equipment_category(_row("Holy King GP Head", cre="5-", clazz="J"))
        == CATEGORY_PAID_PROMOTIONAL_GP
    )
    assert (
        classify_equipment_category(_row("Evol ZP Head", cre="5-", clazz="Q"))
        == CATEGORY_PAID_PROMOTIONAL_ZP
    )


def test_paid_premium_base_tier_f_and_fz() -> None:
    # The "plain" (CLASS="") base tier also splits into F/FZ sub-tiers,
    # confirmed via direct stat comparison (2026-10-20 audit) -- same split
    # as every other plain bucket in this file.
    assert classify_equipment_category(_row("Secuti F Helm", cre="5p")) == CATEGORY_PAID_PACKAGE_F
    assert classify_equipment_category(_row("Secuti FZ Helm", cre="5p")) == CATEGORY_PAID_PACKAGE_FZ
    assert (
        classify_equipment_category(_row("Secuti FY Helm", cre="4k"))
        == CATEGORY_PAID_PREMIUM_KIT_FZ
    )


def test_paid_premium_gs_gp_marker_can_be_glued_to_a_kana_name() -> None:
    # Confirmed against the real dataset (2026-10-20 audit): ~10% of Package's
    # CLASS=J rows have no space before the marker (e.g. "メトリーGS Helm・
    # Blue") -- `_gs_or_gp` must find it via regex, not whitespace tokens.
    assert (
        classify_equipment_category(_row("メトリーGS Helm・Blue", cre="5p", clazz="J"))
        == CATEGORY_PAID_PACKAGE_GS
    )


def test_promotional_wins_over_class_for_the_top_level_route() -> None:
    # Real example (head:1000, "テリオグHC Cap"): CRE "5-" (Promotional) wins
    # over CLASS "E" (HC) for *which acquisition route* a row belongs to --
    # it's not reclassified into the Hardcore Quests group entirely. CLASS
    # still refines the leaf *within* Promotional though (2026-10-18, see
    # `_paid_premium_subcategory`), landing on Promotional's own HC sub-leaf
    # rather than the plain one.
    assert (
        classify_equipment_category(_row("Teriogu HC Cap", cre="5-", clazz="E"))
        == CATEGORY_PAID_PROMOTIONAL_HC
    )


# -- Unavailable --------------------------------------------------------------


def test_not_implemented() -> None:
    assert (
        classify_equipment_category(_row("Placeholder Helm", cre="9"))
        == CATEGORY_UNAVAILABLE_NOT_IMPLEMENTED
    )


def test_training_only() -> None:
    assert (
        classify_equipment_category(_row("Guild R. Mail", cre="7-"))
        == CATEGORY_UNAVAILABLE_TRAINING_ONLY
    )


# -- Guild ---------------------------------------------------------------------


def test_guild_festival() -> None:
    assert (
        classify_equipment_category(_row("Festival Headgear", cre="2m")) == CATEGORY_GUILD_FESTIVAL
    )


def test_guild_festival_subcategories() -> None:
    # 2026-10-20: the reference tool's own Festival node (confirmed via the
    # project owner's screenshot) splits into 9 leaves -- a complete
    # partition of CRE=2m, confirmed against the real dataset.
    assert (
        classify_equipment_category(_row("Eques FX Helm", cre="2m")) == CATEGORY_GUILD_FESTIVAL_FX
    )
    assert (
        classify_equipment_category(_row("Khezu RX Helm", cre="2m")) == CATEGORY_GUILD_FESTIVAL_RX
    )
    assert (
        classify_equipment_category(_row("High Metal LX Helm", cre="2m"))
        == CATEGORY_GUILD_FESTIVAL_LX
    )
    assert (
        classify_equipment_category(_row("Eques HC Helm", cre="2m", clazz="E"))
        == CATEGORY_GUILD_FESTIVAL_HC
    )
    assert (
        classify_equipment_category(_row("Nisuru HS Helm", cre="2m", clazz="F"))
        == CATEGORY_GUILD_FESTIVAL_HS
    )
    assert (
        classify_equipment_category(_row("Roses G Helm", cre="2m", clazz="I"))
        == CATEGORY_GUILD_FESTIVAL_G
    )
    assert (
        classify_equipment_category(_row("Roses GF Helm", cre="2m", clazz="I"))
        == CATEGORY_GUILD_FESTIVAL_GF
    )
    assert (
        classify_equipment_category(_row("Roses GX Helm", cre="2m", clazz="I"))
        == CATEGORY_GUILD_FESTIVAL_GX
    )
    assert (
        classify_equipment_category(_row("祭のあとに【勝ち猫】", cre="2m"))
        == CATEGORY_GUILD_FESTIVAL_OTHER
    )


def test_guild_plain() -> None:
    assert classify_equipment_category(_row("Comrade Helm", cre="2-")) == CATEGORY_GUILD_PLAIN


def test_guild_plain_f_and_fz() -> None:
    assert classify_equipment_category(_row("Deliver F Helm", cre="2-")) == CATEGORY_GUILD_PLAIN_F
    assert classify_equipment_category(_row("Deliver FZ Helm", cre="2-")) == CATEGORY_GUILD_PLAIN_FZ
    assert classify_equipment_category(_row("Deliver FY Helm", cre="2-")) == CATEGORY_GUILD_PLAIN_FZ


def test_guild_hs() -> None:
    assert (
        classify_equipment_category(_row("Mixes HS Helm", cre="2-", clazz="F")) == CATEGORY_GUILD_HS
    )


def test_guild_g() -> None:
    assert (
        classify_equipment_category(_row("Mixes G Helm", cre="2-", clazz="I")) == CATEGORY_GUILD_G
    )


def test_guild_gf() -> None:
    assert (
        classify_equipment_category(_row("Mixes GF Helm", cre="2-", clazz="I")) == CATEGORY_GUILD_GF
    )


def test_guild_gx() -> None:
    assert classify_equipment_category(_row("Mixes GX Helm", cre="2-")) == CATEGORY_GUILD_GX


# -- Diva Defense ---------------------------------------------------------------


def test_diva_defense_plain() -> None:
    # 0 real rows today (same defensive-default situation as other base
    # tiers in this file) -- kept as the fallback for anything that isn't
    # CLASS I or CLASS P under CRE=2u.
    assert classify_equipment_category(_row("Placeholder", cre="2u")) == CATEGORY_DIVA_DEFENSE


def test_diva_defense_gx() -> None:
    assert (
        classify_equipment_category(_row("Burning Cliff GX Kabuto", cre="2u", clazz="I"))
        == CATEGORY_DIVA_DEFENSE_GX
    )


def test_diva_defense_gx_marker_can_be_glued_to_other_text() -> None:
    # Real example: "Burning Cliff GX【胴当て】" has no space between "GX" and
    # the following bracket, so `_tokens` membership misses it -- confirmed
    # while regenerating the data bundle after this split (these 2 rows were
    # silently falling into the plain leaf instead of GX).
    assert (
        classify_equipment_category(_row("Burning Cliff GX【胴当て】", cre="2u", clazz="I"))
        == CATEGORY_DIVA_DEFENSE_GX
    )


def test_diva_defense_zenith() -> None:
    # 2026-10-20: split from a single merged "Z"/"ZF" leaf into its own ZF
    # leaf, for consistency with Road/Event Zenith (which already split ZF
    # out) -- the real dataset splits cleanly by this same "ZF" name-suffix
    # marker (100 "Z" rows, 100 "ZF" rows), confirmed directly against
    # etl/.data/cache/equip.body.
    assert (
        classify_equipment_category(_row("Katante Z Helm", cre="2u", clazz="P"))
        == CATEGORY_DIVA_DEFENSE_ZENITH
    )


def test_diva_defense_zenith_zf() -> None:
    assert (
        classify_equipment_category(_row("Katante ZF Helm", cre="2u", clazz="P"))
        == CATEGORY_DIVA_DEFENSE_ZENITH_ZF
    )


def test_diva_defense_zenith_zy() -> None:
    assert (
        classify_equipment_category(_row("Katante ZY Helm", cre="2u", clazz="P"))
        == CATEGORY_DIVA_DEFENSE_ZENITH_ZY
    )


def test_diva_defense_zenith_zx() -> None:
    assert (
        classify_equipment_category(_row("Katante ZX Helm", cre="2u", clazz="P"))
        == CATEGORY_DIVA_DEFENSE_ZENITH_ZX
    )


# -- Tower and Hunter's Road (share CRE "1t") ------------------------------------


def test_tower_plain() -> None:
    assert (
        classify_equipment_category(_row("Ranvuo Helm", cre="1t", clazz="N"))
        == CATEGORY_TOWER_PLAIN
    )


def test_tower_plain_f_and_fz() -> None:
    assert (
        classify_equipment_category(_row("Ranvuo F Helm", cre="1t", clazz="N"))
        == CATEGORY_TOWER_PLAIN_F
    )
    assert (
        classify_equipment_category(_row("Ranvuo FZ Helm", cre="1t", clazz="N"))
        == CATEGORY_TOWER_PLAIN_FZ
    )


def test_tower_hs() -> None:
    assert (
        classify_equipment_category(_row("Nyui HS Helm", cre="1t", clazz="N")) == CATEGORY_TOWER_HS
    )


def test_tower_g() -> None:
    assert classify_equipment_category(_row("Once G Helm", cre="1t", clazz="N")) == CATEGORY_TOWER_G


def test_tower_gf() -> None:
    assert (
        classify_equipment_category(_row("Once GF Helm", cre="1t", clazz="N")) == CATEGORY_TOWER_GF
    )


def test_tower_gx_custom() -> None:
    # Confirmed via user-provided screenshots: all 5 slots, both Blademaster
    # and Gunner TYPE variants, are one leaf -- no further split by name.
    assert (
        classify_equipment_category(_row("Cleora GX Cap", cre="1t", clazz="N"))
        == CATEGORY_TOWER_GX_CUSTOM
    )
    assert (
        classify_equipment_category(_row("Cleora GX Mail", cre="1t", clazz="N"))
        == CATEGORY_TOWER_GX_CUSTOM
    )
    assert (
        classify_equipment_category(_row("Cleora GX Vest", cre="1t", clazz="N"))
        == CATEGORY_TOWER_GX_CUSTOM
    )


def test_road_plain() -> None:
    assert classify_equipment_category(_row("Rios Helm", cre="1t")) == CATEGORY_ROAD_PLAIN


def test_road_plain_f_and_fz() -> None:
    assert classify_equipment_category(_row("Rios F Helm", cre="1t")) == CATEGORY_ROAD_PLAIN_F
    assert classify_equipment_category(_row("Rios FZ Helm", cre="1t")) == CATEGORY_ROAD_PLAIN_FZ


def test_road_hs() -> None:
    assert (
        classify_equipment_category(_row("Rodokuru HS Head", cre="1t", clazz="F"))
        == CATEGORY_ROAD_HS
    )


def test_road_g() -> None:
    assert classify_equipment_category(_row("Bonito G", cre="1t", clazz="I")) == CATEGORY_ROAD_G


def test_road_gf() -> None:
    assert classify_equipment_category(_row("Bonito GF", cre="1t", clazz="I")) == CATEGORY_ROAD_GF


def test_road_gx() -> None:
    assert classify_equipment_category(_row("Miniomu GX", cre="1t", clazz="I")) == CATEGORY_ROAD_GX


def test_road_gx_includes_the_class_i_g_rank_only_ambiguous_rows() -> None:
    # Nympha/Will/Saint/White Fatalis GX: confirmed by the user ("just road's
    # gx tier") to belong here despite being G-rank only, not split out into
    # a separate "Event Cycle" leaf.
    assert (
        classify_equipment_category(_row("Nympha GX Helm", cre="1t", clazz="I")) == CATEGORY_ROAD_GX
    )


def test_road_plain_includes_the_glued_white_fatalis_gx_marker() -> None:
    # Real example: "White Fatalis GXクロウ" has no space between "GX" and the
    # following kana, so a plain `"GX" in tokens` membership check misses it
    # -- confirmed in the 2026-10-20 audit (4 rows were silently falling into
    # the plain leaf instead of road_gx).
    assert (
        classify_equipment_category(_row("White Fatalis GXクロウ", cre="1t", clazz="I"))
        == CATEGORY_ROAD_GX
    )


def test_road_zenith() -> None:
    assert (
        classify_equipment_category(_row("Renka Headguard Z", cre="1t", clazz="P"))
        == CATEGORY_ROAD_ZENITH
    )


def test_road_zenith_zf() -> None:
    assert (
        classify_equipment_category(_row("Nerigeki Headguard ZF", cre="1t", clazz="P"))
        == CATEGORY_ROAD_ZENITH_ZF
    )


def test_road_zenith_zy() -> None:
    assert (
        classify_equipment_category(_row("Nerihi ZY", cre="1t", clazz="P"))
        == CATEGORY_ROAD_ZENITH_ZY
    )


def test_road_zenith_zx() -> None:
    assert (
        classify_equipment_category(_row("Rengoku ZX", cre="1t", clazz="P"))
        == CATEGORY_ROAD_ZENITH_ZX
    )


# -- Caravan and Diva Battle (航) -------------------------------------------------


def test_caravan_plain() -> None:
    assert classify_equipment_category(_row("Espinas R Brain", cre="1c")) == CATEGORY_CARAVAN_PLAIN
    assert classify_equipment_category(_row("Deliver Helm", cre="1s")) == CATEGORY_CARAVAN_PLAIN


def test_caravan_plain_f_and_fz() -> None:
    assert classify_equipment_category(_row("Deliver F Helm", cre="1s")) == CATEGORY_CARAVAN_PLAIN_F
    assert (
        classify_equipment_category(_row("Deliver FZ Helm", cre="1s")) == CATEGORY_CARAVAN_PLAIN_FZ
    )


def test_caravan_rx() -> None:
    assert classify_equipment_category(_row("Espinas RX Brain", cre="1c")) == CATEGORY_CARAVAN_RX


def test_caravan_hs() -> None:
    assert (
        classify_equipment_category(_row("Asaku F HS Helm", cre="1s", clazz="F"))
        == CATEGORY_CARAVAN_HS
    )


def test_caravan_g() -> None:
    assert (
        classify_equipment_category(_row("Asaku G Helm", cre="1s", clazz="I")) == CATEGORY_CARAVAN_G
    )


def test_caravan_gf() -> None:
    assert (
        classify_equipment_category(_row("Asaku GF Helm", cre="1s", clazz="I"))
        == CATEGORY_CARAVAN_GF
    )


def test_caravan_gx() -> None:
    assert classify_equipment_category(_row("Asaku GX Helm", cre="1s")) == CATEGORY_CARAVAN_GX


def test_caravan_g_includes_the_glued_brooke_gx_marker() -> None:
    # Real example: "Brooke GXグローブ" has no space between "GX" and the
    # following kana -- confirmed in the 2026-10-20 audit (4 rows were
    # silently falling into caravan_g instead of caravan_gx).
    assert (
        classify_equipment_category(_row("Brooke GXグローブ", cre="1s", clazz="I"))
        == CATEGORY_CARAVAN_GX
    )


# -- Hunting Tournament (衛) ------------------------------------------------------


def test_tournament_plain() -> None:
    assert classify_equipment_category(_row("Tandress", cre="1i")) == CATEGORY_TOURNAMENT_PLAIN


def test_tournament_plain_f_and_fz() -> None:
    assert classify_equipment_category(_row("Tandress F", cre="1i")) == CATEGORY_TOURNAMENT_PLAIN_F
    assert (
        classify_equipment_category(_row("Tandress FZ", cre="1i")) == CATEGORY_TOURNAMENT_PLAIN_FZ
    )


def test_tournament_hc() -> None:
    assert (
        classify_equipment_category(_row("Tandress HC", cre="1i", clazz="E"))
        == CATEGORY_TOURNAMENT_HC
    )


def test_tournament_hs() -> None:
    assert (
        classify_equipment_category(_row("Tandress HS", cre="1i", clazz="F"))
        == CATEGORY_TOURNAMENT_HS
    )


def test_tournament_g() -> None:
    assert (
        classify_equipment_category(_row("Tandress G", cre="1i", clazz="I"))
        == CATEGORY_TOURNAMENT_G
    )


def test_tournament_gf() -> None:
    assert (
        classify_equipment_category(_row("Tandress GF", cre="1i", clazz="I"))
        == CATEGORY_TOURNAMENT_GF
    )


def test_tournament_gx() -> None:
    assert classify_equipment_category(_row("Tandress GX", cre="1i")) == CATEGORY_TOURNAMENT_GX


def test_tournament_gs() -> None:
    # 2026-10-20 audit: this CLASS=J leaf was previously hardcoded to GP,
    # mislabeling the 3 real GS rows ("Patapatagook GS・Gold/Silver/Copper").
    assert (
        classify_equipment_category(_row("Patapatagook GS・Gold", cre="1i", clazz="J"))
        == CATEGORY_TOURNAMENT_GS
    )


def test_tournament_gp() -> None:
    assert (
        classify_equipment_category(_row("Tandress GP", cre="1i", clazz="J"))
        == CATEGORY_TOURNAMENT_GP
    )


def test_tournament_zp() -> None:
    assert (
        classify_equipment_category(_row("Tandress ZP", cre="1i", clazz="Q"))
        == CATEGORY_TOURNAMENT_ZP
    )


# -- Event Armour (イ) -----------------------------------------------------------


def test_event_plain() -> None:
    assert (
        classify_equipment_category(_row("Jess BM G", cre="1e", clazz="I")) == CATEGORY_EVENT_PLAIN
    )
    # Non-G-rank Event pieces (blank CLASS) are also plain, same bucket as a
    # G-tier one that isn't GX and isn't a curated Musou/Extreme name.
    assert classify_equipment_category(_row("Hunger Helm", cre="1e")) == CATEGORY_EVENT_PLAIN


def test_event_plain_f_and_fz() -> None:
    # Unlike event_plain's G/GF merge (deliberately kept, see the module-level
    # note on CATEGORY_EVENT_PLAIN), the F/FZ split still applies here -- the
    # reference-tool screenshot that justified the G/GF merge only covered
    # G/GX, not F/FZ.
    assert classify_equipment_category(_row("Hunger F Helm", cre="1e")) == CATEGORY_EVENT_PLAIN_F
    assert classify_equipment_category(_row("Hunger FZ Helm", cre="1e")) == CATEGORY_EVENT_PLAIN_FZ


def test_event_gx() -> None:
    assert (
        classify_equipment_category(_row("Jess GX Helm", cre="1e", clazz="I")) == CATEGORY_EVENT_GX
    )


def test_event_gx_marker_can_be_glued_to_other_text() -> None:
    # Real example: "Youthclad ノ肩鎧GX" has no space before "GX" -- confirmed
    # in the 2026-10-20 audit (29 rows with a glued GX marker were silently
    # falling into event_plain instead of event_gx).
    assert (
        classify_equipment_category(_row("Youthclad ノ肩鎧GX", cre="1e", clazz="I"))
        == CATEGORY_EVENT_GX
    )


def test_event_hs() -> None:
    # 2026-10-20 audit: CLASS F (HS) had no branch at all under CRE=1e, same
    # bug shape as the GS/GP one below -- 255 real rows were silently falling
    # into CATEGORY_EVENT_PLAIN.
    assert (
        classify_equipment_category(_row("Oleum HS Helm", cre="1e", clazz="F")) == CATEGORY_EVENT_HS
    )


def test_event_hc() -> None:
    assert (
        classify_equipment_category(_row("Harubadaa HC Head", cre="1e", clazz="E"))
        == CATEGORY_EVENT_HC
    )


def test_event_sp() -> None:
    assert (
        classify_equipment_category(_row("Vashimu Charm SP", cre="1e", clazz="A"))
        == CATEGORY_EVENT_SP
    )


def test_event_gs_and_gp() -> None:
    # 2026-10-20 audit: CLASS=J (G-Shugo) had no branch at all under CRE=1e
    # and was silently falling into CATEGORY_EVENT_PLAIN -- 80 real rows
    # (40 GS + 40 GP), e.g. "Marble GS Head"/"Marble GP Head".
    assert (
        classify_equipment_category(_row("Marble GS Head", cre="1e", clazz="J"))
        == CATEGORY_EVENT_GS
    )
    assert (
        classify_equipment_category(_row("Marble GP Head", cre="1e", clazz="J"))
        == CATEGORY_EVENT_GP
    )


def test_event_zenith() -> None:
    assert (
        classify_equipment_category(_row("Korinyi Z Band", cre="1e", clazz="P"))
        == CATEGORY_EVENT_ZENITH
    )


def test_event_zenith_zf() -> None:
    assert (
        classify_equipment_category(_row("Guridi ZF Helm", cre="1e", clazz="P"))
        == CATEGORY_EVENT_ZENITH_ZF
    )


def test_event_zenith_zy() -> None:
    assert (
        classify_equipment_category(_row("Kiyoshi Helm ZY", cre="1e", clazz="P"))
        == CATEGORY_EVENT_ZENITH_ZY
    )


def test_event_zenith_zx() -> None:
    assert (
        classify_equipment_category(_row("Kiyoshi Helm ZX", cre="1e", clazz="P"))
        == CATEGORY_EVENT_ZENITH_ZX
    )


def test_event_mystery() -> None:
    # 謎 -- confirmed: the Luxt series, GX tier, all 10 rows (all 5 slots x
    # both weapon-TYPE variants). 2026-10-20: this check was originally wired
    # into the `cre == "1e"` branch under the (wrong) assumption Luxt's rows
    # used CRE=1e -- the real rows (etl/.data/cache/equip.body) are a full
    # standard-tier set (plain/F/FY/HS/G/GF/GX) at CRE=1-/CLASS=I, same as any
    # other G-rank armor; only its GX tier gets pulled into this leaf.
    assert classify_equipment_category(_row("Luxt GX Helm", clazz="I")) == CATEGORY_EVENT_MYSTERY
    assert classify_equipment_category(_row("Luxt GX Vest", clazz="I")) == CATEGORY_EVENT_MYSTERY


def test_event_mystery_requires_the_luxt_name_to_be_anchored_at_the_start() -> None:
    # A name merely containing "Luxt" later, or without the GX tier, isn't
    # Mystery Quest Armour -- it's a normal G-rank item (GX-tier, so grank_gx;
    # the non-GX one falls to the normal grank_g/grank_gf tiers).
    assert classify_equipment_category(_row("Deluxt GX Helm", clazz="I")) == CATEGORY_GRANK_GX
    assert classify_equipment_category(_row("Luxt G Helm", clazz="I")) == CATEGORY_GRANK_G
    assert classify_equipment_category(_row("Luxt GF Helm", clazz="I")) == CATEGORY_GRANK_GF


def test_event_fx_goes_to_hr100_fx_instead() -> None:
    assert classify_equipment_category(_row("Eques FX Helm", cre="1e")) == CATEGORY_HR100_FX


def test_event_musou_armor() -> None:
    # Real armor names confirmed by the project owner for all 9 Musou-tier
    # monsters (2026-10-18) -- differ from the matching Musou *decoration*
    # names for Bogabadorumu/Zerureusu/Elzelion (Rafan/Elysium/Fonce there vs
    # Rapin/Elysi/Fonse here). 2026-10-20: split by G/GF/GX tier rather than
    # by monster (project owner: "split musou by level instead of source") --
    # the monster name stays visible in the item name but is no longer a
    # separate category branch.
    for name in (
        "Demonclad Horn G",
        "鬼凛ノ角G",
        "童凛ノ角G",
        "Rapin G Helm",
        "Chiru G Head",
        "Elysi G Helm",
        "Fonse G Helm",
        "Demon Tale Horn G",
        "童伝ノ角G",
        "Ganeto G Head",
        "Bonne G Helm",
    ):
        assert (
            classify_equipment_category(_row(name, cre="1e", clazz="I")) == CATEGORY_EVENT_MUSOU_G
        )
    assert (
        classify_equipment_category(_row("Demonclad Horn GF", cre="1e", clazz="I"))
        == CATEGORY_EVENT_MUSOU_GF
    )
    # A Musou name wins over the plain GX fallback too.
    assert (
        classify_equipment_category(_row("Demonclad Horn GX", cre="1e", clazz="I"))
        == CATEGORY_EVENT_MUSOU_GX
    )


def test_event_extreme_quest_armor() -> None:
    # 4 distinct Extreme Quest rewards confirmed by the project owner
    # (2026-10-18), none tied to an actual Musou monster. 2026-10-20: split
    # by G/GF/GX tier rather than by quest, same as Musou above.
    assert (
        classify_equipment_category(_row("Demon Lord ノ肩鎧G", cre="1e", clazz="I"))
        == CATEGORY_EVENT_EXTREME_G
    )
    assert (
        classify_equipment_category(_row("童子ノ角GF", cre="1e", clazz="I"))
        == CATEGORY_EVENT_EXTREME_GF
    )
    assert (
        classify_equipment_category(_row("Heruto GX Piercing", cre="1e", clazz="I"))
        == CATEGORY_EVENT_EXTREME_GX
    )
    assert (
        classify_equipment_category(_row("Iroasu GX Piercing", cre="1e", clazz="I"))
        == CATEGORY_EVENT_EXTREME_GX
    )
    assert (
        classify_equipment_category(_row("Luchar GX Piercing", cre="1e", clazz="I"))
        == CATEGORY_EVENT_EXTREME_GX
    )


# -- G Rank Armour ---------------------------------------------------------------


def test_grank_g() -> None:
    assert classify_equipment_category(_row("Pietra G Helm", clazz="I")) == CATEGORY_GRANK_G


def test_grank_gf() -> None:
    assert classify_equipment_category(_row("Pietra GF Helm", clazz="I")) == CATEGORY_GRANK_GF


def test_grank_gx() -> None:
    assert classify_equipment_category(_row("Pietra GX Helm", clazz="I")) == CATEGORY_GRANK_GX


def test_grank_g_hashu() -> None:
    assert classify_equipment_category(_row("Odiva G Helm", clazz="G")) == CATEGORY_GRANK_G_HASHU


def test_grank_burst_species() -> None:
    assert (
        classify_equipment_category(_row("Altera GF Helm", clazz="H"))
        == CATEGORY_GRANK_BURST_SPECIES
    )


def test_grank_g_hiden() -> None:
    # G-Hiden (CLASS=L) has no "plain" variant -- every real row carries G,
    # GF, or GX (2026-10-20 audit: 280/280/280 real split).
    assert (
        classify_equipment_category(_row("Byakko Kensei G Helm", clazz="L"))
        == CATEGORY_GRANK_G_HIDEN_G
    )
    assert (
        classify_equipment_category(_row("Byakko Kensei GF Helm", clazz="L"))
        == CATEGORY_GRANK_G_HIDEN_GF
    )
    assert (
        classify_equipment_category(_row("Byakko Kensei GX Helm", clazz="L"))
        == CATEGORY_GRANK_G_HIDEN_GX
    )


def test_grank_origin() -> None:
    assert classify_equipment_category(_row("Blitz GX Horn", clazz="M")) == CATEGORY_GRANK_ORIGIN


def test_grank_exotic() -> None:
    assert classify_equipment_category(_row("Zinogre Helm", clazz="O")) == CATEGORY_GRANK_EXOTIC


def test_grank_exotic_g() -> None:
    assert classify_equipment_category(_row("Zinogre G Helm", clazz="O")) == CATEGORY_GRANK_EXOTIC_G


def test_grank_exotic_gf() -> None:
    assert (
        classify_equipment_category(_row("Zinogre GF Helm", clazz="O")) == CATEGORY_GRANK_EXOTIC_GF
    )


def test_grank_exotic_gx() -> None:
    assert (
        classify_equipment_category(_row("Zinogre GX Helm", clazz="O")) == CATEGORY_GRANK_EXOTIC_GX
    )


def test_grank_exotic_gx_includes_the_glued_tempest_gx_marker() -> None:
    # Real example: "Tempest GX【衣】" has no space between "GX" and the
    # following bracket -- confirmed in the 2026-10-20 audit (8 rows were
    # silently falling into grank_exotic instead of grank_exotic_gx).
    assert (
        classify_equipment_category(_row("Tempest GX【衣】", clazz="O")) == CATEGORY_GRANK_EXOTIC_GX
    )


# -- Zenith Armour (default CRE, CLASS "P") ---------------------------------------


def test_zenith_plain() -> None:
    assert classify_equipment_category(_row("Espinas Z Brain", clazz="P")) == CATEGORY_ZENITH_PLAIN


def test_zenith_zy() -> None:
    assert classify_equipment_category(_row("Espinas ZY Brain", clazz="P")) == CATEGORY_ZENITH_ZY


def test_zenith_zx() -> None:
    assert classify_equipment_category(_row("Espinas ZX Brain", clazz="P")) == CATEGORY_ZENITH_ZX


def test_zenith_zf() -> None:
    # Confirmed against the real dataset (2026-10-18): an exact 50/50 split
    # of what used to all be `zenith_plain` -- every remaining "plain" row
    # actually carries a bare "Z" token, and exactly as many carry "ZF"
    # instead, the same name-suffix-token pattern as ZX/ZY above.
    assert classify_equipment_category(_row("Espinas ZF Brain", clazz="P")) == CATEGORY_ZENITH_ZF


# -- Hardcore Quests ---------------------------------------------------------------


def test_hardcore_lx() -> None:
    assert classify_equipment_category(_row("Rathalos LX Helm")) == CATEGORY_HARDCORE_LX


def test_hardcore_rx() -> None:
    assert classify_equipment_category(_row("Rath Soul RX Helm")) == CATEGORY_HARDCORE_RX


def test_hardcore_hc() -> None:
    assert classify_equipment_category(_row("Garnet HC Helm", clazz="E")) == CATEGORY_HARDCORE_HC


def test_hardcore_hs() -> None:
    assert classify_equipment_category(_row("Garnet HS Helm", clazz="F")) == CATEGORY_HARDCORE_HS


def test_hardcore_tenran() -> None:
    assert classify_equipment_category(_row("Odiva F Helm", clazz="C")) == CATEGORY_HARDCORE_TENRAN


def test_hardcore_hashu() -> None:
    assert classify_equipment_category(_row("Odiva FX Helm", clazz="D")) == CATEGORY_HARDCORE_HASHU


def test_hardcore_hiden() -> None:
    assert classify_equipment_category(_row("Garnet Helm", clazz="K")) == CATEGORY_HARDCORE_HIDEN


def test_hardcore_hiden_f() -> None:
    # Hiden has only "F" -- no FZ/FY in the real dataset (unlike the plain
    # CLASS="" buckets elsewhere in this file).
    assert (
        classify_equipment_category(_row("Garnet F Helm", clazz="K")) == CATEGORY_HARDCORE_HIDEN_F
    )


# -- HR100~ --------------------------------------------------------------------


def test_hr100_fx() -> None:
    assert classify_equipment_category(_row("Raviente FX Head")) == CATEGORY_HR100_FX


def test_hr100_gou() -> None:
    assert classify_equipment_category(_row("Blitz Horn", clazz="B")) == CATEGORY_HR100_GOU


# -- Standard Armour ---------------------------------------------------------------


def test_standard_plain() -> None:
    assert classify_equipment_category(_row("Leather Helm")) == CATEGORY_STANDARD_PLAIN


def test_standard_plain_f_and_fz() -> None:
    assert classify_equipment_category(_row("Leather F Helm")) == CATEGORY_STANDARD_PLAIN_F
    assert classify_equipment_category(_row("Leather FZ Helm")) == CATEGORY_STANDARD_PLAIN_FZ
    assert classify_equipment_category(_row("Leather FY Helm")) == CATEGORY_STANDARD_PLAIN_FZ


def test_standard_sp() -> None:
    assert classify_equipment_category(_row("SP Helm", clazz="A")) == CATEGORY_STANDARD_SP


# == is_grank_or_later_equipment ===============================================
# The active-skill-cap piece-count bonus (docs/skill-system-roadmap.md TODO #1)
# needs a G-Rank-or-later signal independent of the display category above --
# several categories (every "Paid and Premium" one, Guild Festival, Event, Road)
# mix below-G-rank and G-Rank-or-later CLASS values together and can't answer
# this question on their own. Confirmed directly against the real cached
# dataset: e.g. paid_gachapon alone holds 1,056 CLASS "Q" (Zenith-Shugo/ZP-tier)
# and 840 CLASS "L" (G-Hiden) rows among its 13,745.


def test_grank_or_later_true_for_every_grank_or_zenith_class() -> None:
    for clazz in ("G", "H", "I", "J", "L", "M", "O", "P", "Q"):
        assert is_grank_or_later_equipment(_row("Some Piece", clazz=clazz)) is True


def test_grank_or_later_false_for_every_below_grank_class() -> None:
    for clazz in ("", "A", "B", "C", "D", "E", "F", "K"):
        assert is_grank_or_later_equipment(_row("Some Piece", clazz=clazz)) is False


def test_grank_or_later_ignores_cre_acquisition_route() -> None:
    # Same CLASS "Q" (Zenith-Shugo/ZP), different CRE routes -- true either way,
    # unlike classify_equipment_category, which sorts these into unrelated
    # leaves (paid_gachapon vs tournament_zp) and loses the tier distinction
    # for the "4g" one entirely.
    assert is_grank_or_later_equipment(_row("Tandress ZP", cre="1i", clazz="Q")) is True
    assert is_grank_or_later_equipment(_row("Ukon ZP Head", cre="4g", clazz="Q")) is True


def test_grank_or_later_tower_keys_on_name_suffix_not_class() -> None:
    # Tower armor is always CLASS "N" regardless of tier -- the G/GX
    # distinction lives in the name suffix instead (see tower_g/tower_gx_custom).
    assert is_grank_or_later_equipment(_row("Ranvuo Helm", cre="1t", clazz="N")) is False
    assert is_grank_or_later_equipment(_row("Nyui HS Helm", cre="1t", clazz="N")) is False
    assert is_grank_or_later_equipment(_row("Once G Helm", cre="1t", clazz="N")) is True
    assert is_grank_or_later_equipment(_row("Cleora GX Cap", cre="1t", clazz="N")) is True


# == Cuffs (Tree 2 in docs/gear-category-taxonomy.md) =========================
# Real example names/recipe prefixes from the live dataset (etl/.data/cache/
# equip.body), counts verified against the taxonomy doc's confirmed totals.

# -- Premium -------------------------------------------------------------------


def test_cuff_premium_tier1() -> None:
    assert (
        classify_cuff_category(_cuff_row("Artisan PA1", cre="4k", recipe="09E51"))
        == CATEGORY_CUFF_PREMIUM_TIER1
    )


def test_cuff_premium_tier2() -> None:
    assert (
        classify_cuff_category(_cuff_row("Sharpening PB1", cre="4k", recipe="110E1"))
        == CATEGORY_CUFF_PREMIUM_TIER2
    )


def test_cuff_premium_tier3() -> None:
    assert (
        classify_cuff_category(_cuff_row("Evasion PC1", cre="4k", recipe="208C1"))
        == CATEGORY_CUFF_PREMIUM_TIER3
    )


def test_cuff_premium_tier3_is_the_fallback_for_an_unrecognized_recipe_prefix() -> None:
    assert (
        classify_cuff_category(_cuff_row("Mystery PA1", cre="4k", recipe="FFFF1"))
        == CATEGORY_CUFF_PREMIUM_TIER3
    )


def test_cuff_premium_net_cafe() -> None:
    assert (
        classify_cuff_category(_cuff_row("Something PA1", cre="3e"))
        == CATEGORY_CUFF_PREMIUM_NET_CAFE
    )


def test_cuff_premium_event() -> None:
    assert classify_cuff_category(_cuff_row("Event PA1", cre="1e")) == CATEGORY_CUFF_PREMIUM_EVENT


def test_cuff_premium_special() -> None:
    assert classify_cuff_category(_cuff_row("Nova PA1", cre="5-")) == CATEGORY_CUFF_PREMIUM_SPECIAL


def test_cuff_premium_zenith() -> None:
    assert (
        classify_cuff_category(_cuff_row("Skill Slots Up PZ1", cre="4g", clazz="P"))
        == CATEGORY_CUFF_PREMIUM_ZENITH
    )


def test_cuff_premium_unavailable() -> None:
    assert (
        classify_cuff_category(_cuff_row("Unreleased PA1", cre="9"))
        == CATEGORY_CUFF_PREMIUM_UNAVAILABLE
    )


# -- Standard ------------------------------------------------------------------


def test_cuff_standard_tier1_below_hr_2001() -> None:
    assert (
        classify_cuff_category(_cuff_row("Para Res SA1", cre="1-", hr="100"))
        == CATEGORY_CUFF_STANDARD_TIER1
    )


def test_cuff_standard_tier2_at_or_above_hr_2001() -> None:
    assert (
        classify_cuff_category(_cuff_row("Gather Speed SB1", cre="1-", hr="2001"))
        == CATEGORY_CUFF_STANDARD_TIER2
    )


def test_cuff_standard_event() -> None:
    assert classify_cuff_category(_cuff_row("Hunger SA1", cre="1e")) == CATEGORY_CUFF_STANDARD_EVENT


def test_cuff_standard_mystery_quest() -> None:
    assert (
        classify_cuff_category(_cuff_row("Backpacking SB1", cre="1i"))
        == CATEGORY_CUFF_STANDARD_MYSTERY_QUEST
    )


def test_cuff_standard_guild() -> None:
    assert (
        classify_cuff_category(_cuff_row("Fasting SA1", cre="2-")) == CATEGORY_CUFF_STANDARD_GUILD
    )


def test_cuff_standard_guild_also_covers_the_lone_interception_outlier() -> None:
    # One real row ("Rush SA1") has CRE "2u" instead of the expected "2-" --
    # confirmed folded into the same leaf, not split out like equipment's
    # Diva Defense (there's no separate Diva Defense leaf for cuffs).
    assert classify_cuff_category(_cuff_row("Rush SA1", cre="2u")) == CATEGORY_CUFF_STANDARD_GUILD


def test_cuff_standard_festival() -> None:
    assert (
        classify_cuff_category(_cuff_row("Adrenaline SB1", cre="2m"))
        == CATEGORY_CUFF_STANDARD_FESTIVAL
    )


def test_cuff_standard_zenith_sz_variant() -> None:
    assert (
        classify_cuff_category(_cuff_row("Skill Slots Up SZ", cre="1-", clazz="P"))
        == CATEGORY_CUFF_STANDARD_ZENITH
    )


def test_cuff_standard_zenith_sigil_variant() -> None:
    assert (
        classify_cuff_category(_cuff_row("Skill Slots Up Sigil", cre="1t", clazz="P"))
        == CATEGORY_CUFF_STANDARD_ZENITH
    )


def test_cuff_standard_unavailable() -> None:
    assert (
        classify_cuff_category(_cuff_row("Capture Expert", cre="9"))
        == CATEGORY_CUFF_STANDARD_UNAVAILABLE
    )


def test_cuff_standard_training_only() -> None:
    assert (
        classify_cuff_category(_cuff_row("Guild R. Cuff 1", cre="7-"))
        == CATEGORY_CUFF_STANDARD_TRAINING_ONLY
    )


def test_cuff_hiden() -> None:
    assert (
        classify_cuff_category(_cuff_row("SnS - Basic", cre="1-", clazz="L")) == CATEGORY_CUFF_HIDEN
    )


# == Decorations (Tree 2 in docs/gear-category-taxonomy.md) ===================
# Real example names from the live dataset (etl/.data/cache/equip.body),
# confirmed by the project owner where CRE/CLASS alone couldn't distinguish a
# leaf (every Musou leaf, Keoaruboru).


def test_deco_standard() -> None:
    assert classify_decoration_category(_row("Attack Gem", cre="1-")) == CATEGORY_DECO_STANDARD


def test_deco_standard_class_with_g_name_token_is_g_not_standard() -> None:
    # Regression (2026-10-24, beta feedback): a decoration can carry a G or
    # GX name token with no CLASS of its own -- these were previously
    # miscategorized as plain Standard Production since only CLASS was
    # checked, not the name. Real examples: "Defense G" (suffix), "G
    # Rage・Attack" (prefix, a combo decoration).
    assert classify_decoration_category(_row("Defense G", cre="1-")) == CATEGORY_DECO_G
    assert classify_decoration_category(_row("G Rage・Attack", cre="1-")) == CATEGORY_DECO_G
    assert classify_decoration_category(_row("Defense GX1", cre="1-")) == CATEGORY_DECO_GX


def test_deco_g() -> None:
    assert classify_decoration_category(_row("Rathalos G", cre="1-", clazz="I")) == CATEGORY_DECO_G


def test_deco_gx() -> None:
    assert (
        classify_decoration_category(_row("Rathalos GX1", cre="1-", clazz="I")) == CATEGORY_DECO_GX
    )


def test_deco_hiden() -> None:
    assert (
        classify_decoration_category(_row("SnS Hiden? White", cre="1-", clazz="L"))
        == CATEGORY_DECO_HIDEN
    )


def test_deco_true_hiden() -> None:
    assert (
        classify_decoration_category(_row("SnS True? White", cre="1-", clazz="L"))
        == CATEGORY_DECO_TRUE_HIDEN
    )


def test_deco_lottery_hiden() -> None:
    assert (
        classify_decoration_category(_row("SnS Hiden EX?White", cre="4g", clazz="L"))
        == CATEGORY_DECO_LOTTERY_HIDEN
    )


def test_deco_raviente() -> None:
    assert (
        classify_decoration_category(_row("Raviente BM GX1", cre="1-", clazz="I"))
        == CATEGORY_DECO_RAVIENTE
    )
    assert (
        classify_decoration_category(_row("Violent Ravi BM GX1", cre="1-", clazz="I"))
        == CATEGORY_DECO_RAVIENTE
    )
    assert (
        classify_decoration_category(_row("Berserk Ravi BM GX1", cre="1-", clazz="I"))
        == CATEGORY_DECO_RAVIENTE
    )


def test_deco_extreme_raviente() -> None:
    assert (
        classify_decoration_category(_row("Extreme Ravi BM GX1", cre="1-", clazz="I"))
        == CATEGORY_DECO_EXTREME_RAVIENTE
    )


def test_deco_musou_nargacuga() -> None:
    # Both the Blademaster ("Demonclad") and Gunner ("Dojiclad") named series
    # map to the same leaf -- confirmed by the project owner.
    assert (
        classify_decoration_category(_row("Demonclad BM GX1", cre="1e", clazz="I"))
        == CATEGORY_DECO_MUSOU_NARGACUGA
    )
    assert (
        classify_decoration_category(_row("Dojiclad GN GX1", cre="1e", clazz="I"))
        == CATEGORY_DECO_MUSOU_NARGACUGA
    )


def test_deco_musou_bogabadorumu() -> None:
    assert (
        classify_decoration_category(_row("Rafan BM GX1", cre="1e", clazz="I"))
        == CATEGORY_DECO_MUSOU_BOGABADORUMU
    )


def test_deco_musou_zerureusu() -> None:
    assert (
        classify_decoration_category(_row("Elysium BM GX1", cre="1e", clazz="I"))
        == CATEGORY_DECO_MUSOU_ZERUREUSU
    )


def test_deco_musou_duremudira() -> None:
    assert (
        classify_decoration_category(_row("Bonne BM GX1", cre="1e", clazz="I"))
        == CATEGORY_DECO_MUSOU_DUREMUDIRA
    )


def test_deco_musou_elzelion() -> None:
    assert (
        classify_decoration_category(_row("Fonce BM GX1", cre="1e", clazz="I"))
        == CATEGORY_DECO_MUSOU_ELZELION
    )


def test_deco_event() -> None:
    assert classify_decoration_category(_row("Hunger Gem", cre="1e")) == CATEGORY_DECO_EVENT


def test_deco_event_g() -> None:
    assert (
        classify_decoration_category(_row("Jess BM G", cre="1e", clazz="I"))
        == CATEGORY_DECO_EVENT_G
    )


def test_deco_event_class_blank_with_g_name_token_is_event_g_not_event() -> None:
    # Regression (2026-10-24, beta feedback): a CRE="1e" row with no CLASS of
    # its own ("Blade Protect G", "G Attack・Style") was previously dumped
    # into plain Event Decorations, since the tier-token check only ran when
    # CLASS=="I" -- every real deco_event row turned out to carry a G/GX name
    # token, none a genuinely tier-free event name.
    assert classify_decoration_category(_row("Blade Protect G", cre="1e")) == CATEGORY_DECO_EVENT_G
    assert classify_decoration_category(_row("G Attack・Style", cre="1e")) == CATEGORY_DECO_EVENT_G
    assert (
        classify_decoration_category(_row("Blade Protect GX1", cre="1e")) == CATEGORY_DECO_EVENT_GX
    )


def test_deco_event_gx() -> None:
    assert (
        classify_decoration_category(_row("Jess BM GX1", cre="1e", clazz="I"))
        == CATEGORY_DECO_EVENT_GX
    )


def test_deco_festival_g() -> None:
    assert (
        classify_decoration_category(_row("Arumyu BM G", cre="2m", clazz="I"))
        == CATEGORY_DECO_FESTIVAL_G
    )


def test_deco_festival_gx() -> None:
    assert (
        classify_decoration_category(_row("Arumyu BM GX1", cre="2m", clazz="I"))
        == CATEGORY_DECO_FESTIVAL_GX
    )


def test_deco_guild_g() -> None:
    assert (
        classify_decoration_category(_row("Mixes G", cre="2-", clazz="I")) == CATEGORY_DECO_GUILD_G
    )


def test_deco_guild_gx() -> None:
    assert (
        classify_decoration_category(_row("Mixes GX1", cre="2-", clazz="I"))
        == CATEGORY_DECO_GUILD_GX
    )


def test_deco_keoaruboru() -> None:
    # Confirmed by the project owner: obtained through Diva Defense, one and
    # the same as the reference tool's "Diva Def" leaf -- not split in two.
    assert (
        classify_decoration_category(_row("Burning Cliff BM GX1", cre="2u", clazz="I"))
        == CATEGORY_DECO_KEOARUBORU
    )
    assert (
        classify_decoration_category(_row("Crimson Cliff GN GX1", cre="2u", clazz="I"))
        == CATEGORY_DECO_KEOARUBORU
    )


def test_deco_road() -> None:
    assert classify_decoration_category(_row("G Break・Blade", cre="1t")) == CATEGORY_DECO_ROAD


def test_deco_road_white_fatalis() -> None:
    assert (
        classify_decoration_category(_row("Wht Fatalis BM GX1", cre="1t", clazz="I"))
        == CATEGORY_DECO_ROAD_WHITE_FATALIS
    )


def test_deco_road_gx() -> None:
    assert (
        classify_decoration_category(_row("Miniomu GX1", cre="1t", clazz="I"))
        == CATEGORY_DECO_ROAD_GX
    )


def test_deco_tower_not_surfaced_in_the_ui_tree() -> None:
    # Tower Gems are already filtered by the separate `is_tower` flag -- this
    # leaf exists purely for traceability, not for a checkbox.
    assert (
        classify_decoration_category(_row("Status Res Gem III", cre="1t", clazz="N"))
        == CATEGORY_DECO_TOWER
    )


def test_deco_other_for_unmodeled_rows() -> None:
    # CLASS "Z" isn't a real decode -- never seen in the real dataset, but the
    # function must still fall through to something rather than raise.
    assert (
        classify_decoration_category(_row("Placeholder Gem", cre="1-", clazz="Z"))
        == CATEGORY_DECO_OTHER
    )


def test_deco_sp_tiers() -> None:
    assert classify_decoration_category(_row("Recoil SP", cre="1-", clazz="A")) == CATEGORY_DECO_SP
    assert (
        classify_decoration_category(_row("Recoil SP α", cre="1-", clazz="A"))
        == CATEGORY_DECO_SP_LV2
    )
    assert (
        classify_decoration_category(_row("Recoil SP β", cre="1-", clazz="A"))
        == CATEGORY_DECO_SP_LV3
    )


def test_deco_extreme_quest() -> None:
    assert (
        classify_decoration_category(_row("Heruto GX", cre="1e", clazz="I"))
        == CATEGORY_DECO_EXTREME_HERUTO
    )
    assert (
        classify_decoration_category(_row("Iroasu GX", cre="1e", clazz="I"))
        == CATEGORY_DECO_EXTREME_IROASU
    )
    assert (
        classify_decoration_category(_row("Luchar GN GX", cre="1e", clazz="I"))
        == CATEGORY_DECO_EXTREME_LUCHAR
    )


def test_deco_training_only() -> None:
    assert (
        classify_decoration_category(_row("Instructor Gem I", cre="7-"))
        == CATEGORY_DECO_TRAINING_ONLY
    )


def test_deco_impossible_to_create() -> None:
    assert (
        classify_decoration_category(_row("Blessing 1 Deco", cre="9", recipe="作成不可"))
        == CATEGORY_DECO_IMPOSSIBLE_TO_CREATE
    )


def test_deco_unimplemented() -> None:
    assert (
        classify_decoration_category(_row("G Thunder Clad", cre="9", hr="10000"))
        == CATEGORY_DECO_UNIMPLEMENTED
    )
    # No recipe/HR sentinel at all -- still treated as Unimplemented, the same
    # fallback equipment's own CRE="9" uses (CATEGORY_UNAVAILABLE_NOT_IMPLEMENTED).
    assert (
        classify_decoration_category(_row("Placeholder Gem", cre="9"))
        == CATEGORY_DECO_UNIMPLEMENTED
    )


def test_deco_special() -> None:
    assert (
        classify_decoration_category(_row("G Rolling・Curtain", cre="4k")) == CATEGORY_DECO_SPECIAL
    )
    assert classify_decoration_category(_row("G Issen・Protect", cre="5-")) == CATEGORY_DECO_SPECIAL
