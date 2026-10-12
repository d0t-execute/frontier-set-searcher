"""Covers classify_equipment_category's decision tree against representative
rows for every leaf in docs/gear-category-taxonomy.md's equipment tree.

Fields are built as a flat, comma-split list matching the real row shape
(see docs/data-format-notes.md): only NAME (0), CRE (33) and CLASS (35)
matter to this module, so every other index is left blank except where a
test needs to name a real example row for traceability.
"""

from etl.parse.gear_category import (
    CATEGORY_CARAVAN_G,
    CATEGORY_CARAVAN_GX,
    CATEGORY_CARAVAN_HS,
    CATEGORY_CARAVAN_PLAIN,
    CATEGORY_CARAVAN_RX,
    CATEGORY_DIVA_DEFENSE,
    CATEGORY_EVENT_MYSTERY,
    CATEGORY_EVENT_PLAIN,
    CATEGORY_EVENT_ZENITH,
    CATEGORY_EVENT_ZENITH_ZX,
    CATEGORY_EVENT_ZENITH_ZY,
    CATEGORY_GRANK_BURST_SPECIES,
    CATEGORY_GRANK_EXOTIC,
    CATEGORY_GRANK_EXOTIC_GX,
    CATEGORY_GRANK_G,
    CATEGORY_GRANK_G_HASHU,
    CATEGORY_GRANK_G_HIDEN,
    CATEGORY_GRANK_GX,
    CATEGORY_GRANK_ORIGIN,
    CATEGORY_GUILD_FESTIVAL,
    CATEGORY_GUILD_G,
    CATEGORY_GUILD_GX,
    CATEGORY_GUILD_HS,
    CATEGORY_GUILD_PLAIN,
    CATEGORY_HARDCORE_HASHU,
    CATEGORY_HARDCORE_HC,
    CATEGORY_HARDCORE_HIDEN,
    CATEGORY_HARDCORE_HS,
    CATEGORY_HARDCORE_LX,
    CATEGORY_HARDCORE_RX,
    CATEGORY_HARDCORE_TENRAN,
    CATEGORY_HR100_FX,
    CATEGORY_HR100_GOU,
    CATEGORY_PAID_GACHAPON,
    CATEGORY_PAID_NET_CAFE,
    CATEGORY_PAID_PACKAGE,
    CATEGORY_PAID_PREMIUM_KIT,
    CATEGORY_PAID_PROMOTIONAL,
    CATEGORY_ROAD_G,
    CATEGORY_ROAD_GX,
    CATEGORY_ROAD_HS,
    CATEGORY_ROAD_PLAIN,
    CATEGORY_ROAD_ZENITH,
    CATEGORY_ROAD_ZENITH_ZX,
    CATEGORY_ROAD_ZENITH_ZY,
    CATEGORY_STANDARD_PLAIN,
    CATEGORY_STANDARD_SP,
    CATEGORY_TOURNAMENT_G,
    CATEGORY_TOURNAMENT_GP,
    CATEGORY_TOURNAMENT_GX,
    CATEGORY_TOURNAMENT_HC,
    CATEGORY_TOURNAMENT_HS,
    CATEGORY_TOURNAMENT_PLAIN,
    CATEGORY_TOURNAMENT_ZP,
    CATEGORY_TOWER_G,
    CATEGORY_TOWER_GX_CUSTOM,
    CATEGORY_TOWER_HS,
    CATEGORY_TOWER_PLAIN,
    CATEGORY_UNAVAILABLE_NOT_IMPLEMENTED,
    CATEGORY_UNAVAILABLE_TRAINING_ONLY,
    CATEGORY_ZENITH_PLAIN,
    CATEGORY_ZENITH_ZX,
    CATEGORY_ZENITH_ZY,
    classify_equipment_category,
)


def _row(name: str, cre: str = "", clazz: str = "") -> list[str]:
    fields = [""] * 36
    fields[0] = name
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
    assert (
        classify_equipment_category(_row("Steno GS Vest", cre="4k#", clazz="J"))
        == CATEGORY_PAID_PREMIUM_KIT
    )


def test_gachapon() -> None:
    assert classify_equipment_category(_row("Ukon GS Head", cre="4g")) == CATEGORY_PAID_GACHAPON


def test_net_cafe() -> None:
    assert classify_equipment_category(_row("Kyuura Head", cre="3-")) == CATEGORY_PAID_NET_CAFE
    assert (
        classify_equipment_category(_row("Regyukusu GS Head", cre="3e")) == CATEGORY_PAID_NET_CAFE
    )


def test_promotional() -> None:
    assert classify_equipment_category(_row("Nova Helm", cre="5-")) == CATEGORY_PAID_PROMOTIONAL


def test_promotional_wins_over_class_even_though_hc_matches() -> None:
    # Real example (head:1000, "テリオグHC Cap"): CRE "5-" wins over CLASS "E"
    # (HC) -- the acquisition code always takes precedence, confirmed against
    # the real dataset (see docs/gear-category-taxonomy.md).
    assert (
        classify_equipment_category(_row("Teriogu HC Cap", cre="5-", clazz="E"))
        == CATEGORY_PAID_PROMOTIONAL
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


def test_guild_festival_fx_goes_to_hr100_fx_instead() -> None:
    assert classify_equipment_category(_row("Himeros FX Helm", cre="2m")) == CATEGORY_HR100_FX


def test_guild_plain() -> None:
    assert classify_equipment_category(_row("Comrade Helm", cre="2-")) == CATEGORY_GUILD_PLAIN


def test_guild_hs() -> None:
    assert (
        classify_equipment_category(_row("Mixes HS Helm", cre="2-", clazz="F")) == CATEGORY_GUILD_HS
    )


def test_guild_g() -> None:
    assert (
        classify_equipment_category(_row("Mixes G Helm", cre="2-", clazz="I")) == CATEGORY_GUILD_G
    )


def test_guild_gx() -> None:
    assert classify_equipment_category(_row("Mixes GX Helm", cre="2-")) == CATEGORY_GUILD_GX


# -- Diva Defense ---------------------------------------------------------------


def test_diva_defense() -> None:
    assert (
        classify_equipment_category(_row("Katante Z Helm", cre="2u", clazz="P"))
        == CATEGORY_DIVA_DEFENSE
    )


# -- Tower and Hunter's Road (share CRE "1t") ------------------------------------


def test_tower_plain() -> None:
    assert (
        classify_equipment_category(_row("Ranvuo Helm", cre="1t", clazz="N"))
        == CATEGORY_TOWER_PLAIN
    )


def test_tower_hs() -> None:
    assert (
        classify_equipment_category(_row("Nyui HS Helm", cre="1t", clazz="N")) == CATEGORY_TOWER_HS
    )


def test_tower_g() -> None:
    assert classify_equipment_category(_row("Once G Helm", cre="1t", clazz="N")) == CATEGORY_TOWER_G


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


def test_road_hs() -> None:
    assert (
        classify_equipment_category(_row("Rodokuru HS Head", cre="1t", clazz="F"))
        == CATEGORY_ROAD_HS
    )


def test_road_g() -> None:
    assert classify_equipment_category(_row("Bonito G", cre="1t", clazz="I")) == CATEGORY_ROAD_G


def test_road_gx() -> None:
    assert classify_equipment_category(_row("Miniomu GX", cre="1t", clazz="I")) == CATEGORY_ROAD_GX


def test_road_gx_includes_the_class_i_g_rank_only_ambiguous_rows() -> None:
    # Nympha/Will/Saint/White Fatalis GX: confirmed by the user ("just road's
    # gx tier") to belong here despite being G-rank only, not split out into
    # a separate "Event Cycle" leaf.
    assert (
        classify_equipment_category(_row("Nympha GX Helm", cre="1t", clazz="I")) == CATEGORY_ROAD_GX
    )


def test_road_zenith() -> None:
    assert (
        classify_equipment_category(_row("Renka Headguard Z", cre="1t", clazz="P"))
        == CATEGORY_ROAD_ZENITH
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


def test_caravan_gx() -> None:
    assert classify_equipment_category(_row("Asaku GX Helm", cre="1s")) == CATEGORY_CARAVAN_GX


# -- Hunting Tournament (衛) ------------------------------------------------------


def test_tournament_plain() -> None:
    assert classify_equipment_category(_row("Tandress", cre="1i")) == CATEGORY_TOURNAMENT_PLAIN


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


def test_tournament_gx() -> None:
    assert classify_equipment_category(_row("Tandress GX", cre="1i")) == CATEGORY_TOURNAMENT_GX


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
        classify_equipment_category(_row("Demon Lord GX Helm", cre="1e", clazz="I"))
        == CATEGORY_EVENT_PLAIN
    )


def test_event_zenith() -> None:
    assert (
        classify_equipment_category(_row("Korinyi Z Band", cre="1e", clazz="P"))
        == CATEGORY_EVENT_ZENITH
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
    # both weapon-TYPE variants).
    assert (
        classify_equipment_category(_row("Luxt GX Helm", cre="1e", clazz="I"))
        == CATEGORY_EVENT_MYSTERY
    )
    assert (
        classify_equipment_category(_row("Luxt GX Vest", cre="1e", clazz="I"))
        == CATEGORY_EVENT_MYSTERY
    )


def test_event_mystery_requires_the_luxt_name_to_be_anchored_at_the_start() -> None:
    # A name merely containing "Luxt" later, or without the GX tier, isn't
    # Mystery Quest Armour -- it's a normal Event-series item.
    assert (
        classify_equipment_category(_row("Deluxt GX Helm", cre="1e", clazz="I"))
        == CATEGORY_EVENT_PLAIN
    )
    assert (
        classify_equipment_category(_row("Luxt Helm", cre="1e", clazz="I")) == CATEGORY_EVENT_PLAIN
    )


def test_event_fx_goes_to_hr100_fx_instead() -> None:
    assert classify_equipment_category(_row("Eques FX Helm", cre="1e")) == CATEGORY_HR100_FX


# -- G Rank Armour ---------------------------------------------------------------


def test_grank_g() -> None:
    assert classify_equipment_category(_row("Pietra G Helm", clazz="I")) == CATEGORY_GRANK_G


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
    assert (
        classify_equipment_category(_row("Byakko Kensei G Helm", clazz="L"))
        == CATEGORY_GRANK_G_HIDEN
    )


def test_grank_origin() -> None:
    assert classify_equipment_category(_row("Blitz GX Horn", clazz="M")) == CATEGORY_GRANK_ORIGIN


def test_grank_exotic() -> None:
    assert classify_equipment_category(_row("Zinogre Helm", clazz="O")) == CATEGORY_GRANK_EXOTIC


def test_grank_exotic_gx() -> None:
    assert (
        classify_equipment_category(_row("Zinogre GX Helm", clazz="O")) == CATEGORY_GRANK_EXOTIC_GX
    )


# -- Zenith Armour (default CRE, CLASS "P") ---------------------------------------


def test_zenith_plain() -> None:
    assert classify_equipment_category(_row("Espinas Z Brain", clazz="P")) == CATEGORY_ZENITH_PLAIN


def test_zenith_zy() -> None:
    assert classify_equipment_category(_row("Espinas ZY Brain", clazz="P")) == CATEGORY_ZENITH_ZY


def test_zenith_zx() -> None:
    assert classify_equipment_category(_row("Espinas ZX Brain", clazz="P")) == CATEGORY_ZENITH_ZX


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


# -- HR100~ --------------------------------------------------------------------


def test_hr100_fx() -> None:
    assert classify_equipment_category(_row("Raviente FX Head")) == CATEGORY_HR100_FX


def test_hr100_gou() -> None:
    assert classify_equipment_category(_row("Blitz Horn", clazz="B")) == CATEGORY_HR100_GOU


# -- Standard Armour ---------------------------------------------------------------


def test_standard_plain() -> None:
    assert classify_equipment_category(_row("Leather Helm")) == CATEGORY_STANDARD_PLAIN


def test_standard_sp() -> None:
    assert classify_equipment_category(_row("SP Helm", clazz="A")) == CATEGORY_STANDARD_SP
