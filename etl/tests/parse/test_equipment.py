from pathlib import Path

from etl.parse.equipment import (
    ParsedCuffRow,
    ParsedDecorationRow,
    ParsedEquipmentRow,
    compute_defense_progression,
    parse_cuff_bucket,
    parse_decoration_bucket,
    parse_equip_js,
    parse_equipment_bucket,
)

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"


def _combined_source() -> str:
    equip = (FIXTURES_DIR / "equip_sample.js").read_text(encoding="utf-8")
    defs = (FIXTURES_DIR / "def_patterns.js").read_text(encoding="utf-8")
    return equip + "\n" + defs


# -- defense progression formula (ported from the site's own getDef()) ------


def test_defense_progression_for_leather_helm() -> None:
    # DEFPTN "00" -> pattern "100,120,120,120,120,120,120"; hand-verified
    # against docs/data-format-notes.md's description of the formula.
    progression = compute_defense_progression(
        def_base=2, defptn_hex="00", def_patterns=["100,120,120,120,120,120,120"]
    )
    assert progression == [2, 3, 4, 5, 6, 8, 10]


def test_defense_progression_applies_the_120_exclusion_rule() -> None:
    # pct=120 and current=25 divide evenly (3000 % 100 == 0), which would
    # normally take the no-rounding branch — but the source special-cases
    # exactly this (pct, current) combination to still add +1.
    progression = compute_defense_progression(
        def_base=25, defptn_hex="00", def_patterns=["100,120,100,100,100,100,100"]
    )
    assert progression[1] == 31  # not 30 — the naive floor-only result


def test_defense_progression_applies_the_ptncd_05_exclusion_rule() -> None:
    # ptncd "05" + pct 102 + current 51 is explicitly forced onto the
    # no-rounding branch even though 102*51 % 100 != 0.
    patterns = ["0", "0", "0", "0", "0", "100,102,100,100,100,100,100"]
    progression = compute_defense_progression(def_base=51, defptn_hex="05", def_patterns=patterns)
    assert progression[1] == 52  # not 53 — the naive else-branch result


# -- filtering non-item placeholder rows -------------------------------------


def test_skips_the_0000_placeholder_row_present_in_every_armor_bucket() -> None:
    # Every armor bucket has an identical "0000" entry named "仮装備"
    # ("dummy/temporary equipment") -- confirmed identical across all 5
    # buckets in the real data. It's the UI's "nothing selected" sentinel, not
    # a real item, and unlike the deco junk below it doesn't fail any CHECK
    # constraint on its own, so it has to be filtered explicitly or it would
    # silently end up in the equipment table as a fake 0-stat item.
    bucket_json = (
        '{"0000":"仮装備,0,0,0,,0,0,0,0,0,,,,,,,,,,,,'
        'なし,0,,1,1,0,0,3,,,,,,,,,",'
        '"0001":"Leather Helm,0,0,1,,0,0,0,0,0,22,3,63,3,80,3,,,,,,'
        '01521R,1,0000,7,100,2,0,1,01,00,0B,0,1-,,,,,x,0"}'
    )

    rows = parse_equipment_bucket("head", bucket_json, def_patterns=["100,120,120,120,120,120,120"])

    assert [row.external_id for row in rows] == ["head:0001"]


def test_decoration_bucket_only_keeps_dec_empty_rows() -> None:
    # The "deco" JS bucket mixes three things under one key namespace: real
    # armor decorations (DEC=""), Cuffs (DEC="1" -- a separate equipment
    # category entirely, see parse_cuff_bucket), and a few blank-key UI
    # placeholders (DEC="", slot_size=0). See docs/data-format-notes.md
    # "What's actually in the deco bucket" -- confirmed against the full
    # real dataset's DEC/CLASS/slot_size cross-tabulation, not assumed from
    # slot_size alone (an earlier version of this parser wrongly used
    # slot_size==0 as the "not a real item" signal, which happened to catch
    # the placeholders but also silently discarded every Hiden Cuff).
    bucket_json = (
        '{"031F":"Paralysis 1 Deco,0,0,4,,,,,,,57,2,46,-2,,,,,,,,'
        '031A1R 015F3,1,,1,400,,,1,,,,,1-,,",'
        '"1016":"Attack II PA1,0,0,5,,,,,,,21,5,67,2,,,,,,,,110C1,1,,1,0,,,2,,,,,4k,1,",'
        '"":",0,0,0,,,,,,,,,,,,,,,,,,なし,1,,1,0,,,0,,,,,,,,,,"}'
    )

    rows = parse_decoration_bucket(bucket_json)

    assert [row.external_id for row in rows] == ["deco:031F"]


def test_cuff_bucket_only_keeps_dec_1_and_zenith_cuff_rows() -> None:
    # A Zenith Cuff (DEC="3", CLASS="P") is a Cuff; a Tower Weapon Sigil
    # (DEC="3", CLASS="N") sharing the same DEC value is not -- see
    # docs/data-format-notes.md "Cuffs".
    bucket_json = (
        '{"031F":"Paralysis 1 Deco,0,0,4,,,,,,,57,2,46,-2,,,,,,,,'
        '031A1R 015F3,1,,1,400,,,1,,,,,1-,,",'
        '"1016":"Attack II PA1,0,0,5,,,,,,,21,5,67,2,,,,,,,,110C1,1,,1,0,,,2,,,,,4k,1,",'
        '"":",0,0,0,,,,,,,,,,,,,,,,,,なし,1,,1,0,,,0,,,,,,,,,,",'
        '"3918":"Skill Slots Up Sigil,0,0,5,,,,,,,,,,,,,,,,,,'
        '392F1 359D5 359F5 35A15,2200,,1,250000,,,1,,,,,1t,3,P,,1",'
        '"17BA":"[SnS] Beam Slash,0,0,5,,,,,,,17,27,,,,,,,,,,'
        '2D8E3 1A5C10,2001,,1,150000,,,1,,,,,1t,3,N"}'
    )

    rows = parse_cuff_bucket(bucket_json)

    assert sorted(row.external_id for row in rows) == ["cuff:1016", "cuff:3918"]


def test_cuff_bucket_accepts_slot_size_zero_for_hiden_cuffs() -> None:
    # Hiden Cuffs (CLASS="L") cost no Poogie-slot capacity -- see
    # docs/data-format-notes.md "Cuffs". Confirmed real example: every
    # weapon's "<Weapon>・Basic"/"<Weapon>・G"/named-technique tree is a
    # family of Hiden Cuffs, all slot_size 0.
    bucket_json = (
        '{"3F20":"SnS・Basic,0,0,6,,,,,,,129,6,,,,,,,,,,'
        '3FEB1 3FEC1 3FED1,3001,,1,0,,,0,,,,,1-,1,L"}'
    )

    rows = parse_cuff_bucket(bucket_json)

    assert rows == [
        ParsedCuffRow(
            external_id="cuff:3F20",
            name="SnS・Basic",
            slot_size=0,
            skills=((129, 6),),
            zenith_skill_id=None,
        )
    ]


def test_parses_a_zenith_cuff_row() -> None:
    # Carries only a Zenith skill (via Teni) -- no normal skills at all.
    bucket_json = (
        '{"3918":"Skill Slots Up Sigil,0,0,5,,,,,,,,,,,,,,,,,,'
        '392F1 359D5 359F5 35A15,2200,,1,250000,,,1,,,,,1t,3,P,,1"}'
    )

    rows = parse_cuff_bucket(bucket_json)

    assert rows == [
        ParsedCuffRow(
            external_id="cuff:3918",
            name="Skill Slots Up Sigil",
            slot_size=1,
            skills=(),
            zenith_skill_id=1,
        )
    ]


def test_parses_a_zenith_cuff_with_dec_1_not_just_dec_3() -> None:
    # Found by actually running the real pipeline and sanity-checking the
    # loaded counts, not by inspecting the deco bucket's DEC/CLASS/slot_size
    # shape alone: a second Zenith Cuff variant, "<Name> SZ", lives at
    # DEC="1" (ordinary Cuff) rather than DEC="3" -- same CLASS="P" +
    # populated Teni, same empty SN1-5, but slot_size=2 instead of 1 (a
    # pricier Poogie-slot alternative granting the same Zenith skill). See
    # docs/data-format-notes.md "Cuffs".
    bucket_json = (
        '{"3637":"Skill Slots Up SZ,0,0,6,,,,,,,,,,,,,,,,,,'
        '359B3 359D5 359F5 35A15,2200,,1,250000,,,2,,,,,1-,1,P,,1"}'
    )

    rows = parse_cuff_bucket(bucket_json)

    assert rows == [
        ParsedCuffRow(
            external_id="cuff:3637",
            name="Skill Slots Up SZ",
            slot_size=2,
            skills=(),
            zenith_skill_id=1,
        )
    ]


# -- single-bucket parsing ---------------------------------------------------


def test_parses_the_leather_helm_row_end_to_end() -> None:
    bucket_json = (
        '{"0001":"Leather Helm,0,0,1,,0,0,0,0,0,22,3,63,3,80,3,,,,,,'
        "01521R,1,0000,7,100,2,0,1,01,00,0B,0,1-,,,,,"
        '軽い素材で作られた頭用装備。,0"}'
    )
    def_patterns = ["100,120,120,120,120,120,120"]

    rows = parse_equipment_bucket("head", bucket_json, def_patterns)

    assert rows == [
        ParsedEquipmentRow(
            external_id="head:0001",
            name="Leather Helm",
            slot_type="head",
            rarity=1,
            min_hr=1,
            defense_base=2,
            defense_max=10,
            slot_count_base=0,
            slot_count_max=1,
            skills=((22, 3), (63, 3), (80, 3)),
            is_tower=False,
            zenith_skill_id=None,
        )
    ]


def test_merges_duplicate_skill_ids_within_one_row_by_summing_points() -> None:
    # Real example (arm:1DF3, "Endre F Guard"): SN3/SP3 and SN5/SP5 both
    # reference skill 143 (Stamina Recovery), at 3 points each. The site's own
    # point-totaling code sums contributions by skill ID unconditionally (see
    # docs/data-format-notes.md), so the real total is 6, not two separate
    # entries of 3 — which also wouldn't fit the DB's (equipment_id, skill_id)
    # primary key anyway.
    bucket_json = (
        '{"1DF3":"Endre F Guard,0,2,7,,1,1,1,1,1,71,4,67,5,143,3,47,4,143,3,'
        "1DF21,,2001,0239,7,0,65,1,3,00,04,02,1,1e,,,,,遠方大陸"
        "の技術を応用し、機動性に"
        '優れた腕防具。"}'
    )

    def_patterns = ["100,100,100,100,100,100,100"] * 5  # DEFPTN "04" -> index 4
    rows = parse_equipment_bucket("arm", bucket_json, def_patterns=def_patterns)

    assert rows[0].skills == ((71, 4), (67, 5), (143, 6), (47, 4))


def test_parses_tower_armor() -> None:
    # CLASS="N" -- flavor text (not asserted here) literally says "discovered
    # in the Tenrou/Tower". Exclusive-both-ways compatibility with Tower Gems
    # is a search-engine concern (Phase 3+); here we just need the flag set.
    bucket_json = (
        '{"2543":"Ranvuo Helm,0,0,7,,1,1,1,1,1,36,3,54,3,77,2,64,2,18,2,,'
        '2CC71R,1,0C17,7,0,13,1,2,01,00,0A,0,1t,,N,,,x"}'
    )

    rows = parse_equipment_bucket("head", bucket_json, def_patterns=["100,120,120,120,120,120,120"])

    assert rows[0].is_tower is True
    assert rows[0].zenith_skill_id is None


def test_parses_zenith_armor() -> None:
    # CLASS="P" -- carries normal skills via SN1-5 *and* a Zenith skill via
    # Teni (index 37), stacked. Confirmed universal across CLASS "P"/"Q"
    # (3,776/3,776 real pieces have a non-empty Teni, 0 exceptions).
    bucket_json = (
        '{"2B8D":"Espinas Z Brain,0,0,9,,5,0,0,-2,-5,161,4,205,4,200,4,214,4,189,4,,'
        '359610R 359A1 359C3 35A21,2200,0FA6,1,200000,360,3,3,0B,04,00,0,1-,,P,,1,x"}'
    )

    def_patterns = ["100,100,100,100,100,100,100"] * 5  # DEFPTN "04" -> index 4
    rows = parse_equipment_bucket("head", bucket_json, def_patterns=def_patterns)

    assert rows[0].is_tower is False
    assert rows[0].zenith_skill_id == 1
    assert rows[0].skills == ((161, 4), (205, 4), (200, 4), (214, 4), (189, 4))


def test_parses_a_decoration_row() -> None:
    bucket_json = (
        '{"031F":"Paralysis 1 Deco,0,0,4,,,,,,,57,2,46,-2,,,,,,,,'
        '031A1R 015F3,1,,1,400,,,1,,,,,1-,,"}'
    )

    rows = parse_decoration_bucket(bucket_json)

    assert rows == [
        ParsedDecorationRow(
            external_id="deco:031F",
            name="Paralysis 1 Deco",
            slot_size=1,
            skills=((57, 2), (46, -2)),
            is_tower=False,
        )
    ]


def test_parses_a_tower_gem() -> None:
    # CLASS="N" within DEC="" -- same Decoration shape, but the project owner
    # confirmed exclusive-both-ways compatibility with Tower armor (can't mix
    # with regular decorations/armor). RECIPE1 "天廊宝箱報酬" = "Tenrou
    # treasure box reward".
    bucket_json = (
        '{"287F":"Status Res Gem III,0,0,7,,,,,,,148,30,,,,,,,,,,tenrou,1,,1,0,,,1,,,,,1t,,N"}'
    )

    rows = parse_decoration_bucket(bucket_json)

    assert rows == [
        ParsedDecorationRow(
            external_id="deco:287F",
            name="Status Res Gem III",
            slot_size=1,
            skills=((148, 30),),
            is_tower=True,
        )
    ]


def test_parses_a_regular_cuff_row() -> None:
    bucket_json = '{"1016":"Attack II PA1,0,0,5,,,,,,,21,5,67,2,,,,,,,,110C1,1,,1,0,,,2,,,,,4k,1,"}'

    rows = parse_cuff_bucket(bucket_json)

    assert rows == [
        ParsedCuffRow(
            external_id="cuff:1016",
            name="Attack II PA1",
            slot_size=2,
            skills=((21, 5), (67, 2)),
            zenith_skill_id=None,
        )
    ]


# -- full equip.js source parsing across all buckets -------------------------


def test_parse_equip_js_covers_every_armor_bucket() -> None:
    result = parse_equip_js(_combined_source())

    by_id = {row.external_id: row for row in result.equipment}

    assert "head:0000" not in by_id  # the "dummy equipment" placeholder
    assert by_id["head:0001"].defense_max == 10
    assert by_id["head:1000"] == ParsedEquipmentRow(
        external_id="head:1000",
        name="テリオグHC Cap",
        slot_type="head",
        rarity=7,
        min_hr=100,
        defense_base=74,
        defense_max=96,
        slot_count_base=3,
        slot_count_max=3,
        skills=((9, 5), (68, 10), (26, 5), (18, 5), (65, 4)),
        is_tower=False,
        zenith_skill_id=None,
    )
    assert by_id["body:1000"].slot_type == "chest"
    assert by_id["body:1000"].min_hr == 2200
    assert by_id["body:1000"].skills == ((102, 5), (67, 5), (62, 6), (140, 5), (36, 5))

    assert by_id["arm:1000"].slot_type == "arms"
    assert by_id["arm:1000"].defense_base == 91

    assert by_id["wst:1000"].slot_type == "waist"
    assert by_id["wst:1000"].skills == ((21, 7), (36, 6), (64, 5), (143, 5))

    assert by_id["leg:1000"].slot_type == "legs"
    assert by_id["leg:1000"].defense_base == 88

    assert by_id["head:2543"].name == "Ranvuo Helm"
    assert by_id["head:2543"].is_tower is True
    assert by_id["head:2543"].zenith_skill_id is None

    assert by_id["head:2B8D"].name == "Espinas Z Brain"
    assert by_id["head:2B8D"].is_tower is False
    assert by_id["head:2B8D"].zenith_skill_id == 1


def test_parse_equip_js_covers_decorations() -> None:
    result = parse_equip_js(_combined_source())

    by_id = {row.external_id: row for row in result.decorations}

    assert "deco:" not in by_id  # the blank-key UI placeholder
    assert "deco:1016" not in by_id  # a Cuff, not a decoration
    assert "deco:3F20" not in by_id  # also a Cuff (Hiden)
    assert "deco:3918" not in by_id  # a Zenith Cuff, not a decoration
    assert by_id["deco:031F"] == ParsedDecorationRow(
        external_id="deco:031F",
        name="Paralysis 1 Deco",
        slot_size=1,
        skills=((57, 2), (46, -2)),
        is_tower=False,
    )
    assert by_id["deco:0321"].name == "Sleep 2 Deco"
    assert by_id["deco:0321"].slot_size == 2

    assert by_id["deco:287F"].name == "Status Res Gem III"
    assert by_id["deco:287F"].is_tower is True


def test_parse_equip_js_covers_cuffs() -> None:
    result = parse_equip_js(_combined_source())

    by_id = {row.external_id: row for row in result.cuffs}

    assert "cuff:" not in by_id  # the blank-key UI placeholder
    assert "cuff:031F" not in by_id  # a Decoration, not a Cuff
    assert by_id["cuff:1016"].skills == ((21, 5), (67, 2))
    assert by_id["cuff:1017"] == ParsedCuffRow(
        external_id="cuff:1017",
        name="Attack II PA2",
        slot_size=2,
        skills=((21, 4), (45, 3)),
        zenith_skill_id=None,
    )
    assert by_id["cuff:3F20"] == ParsedCuffRow(
        external_id="cuff:3F20",
        name="SnS・Basic",
        slot_size=0,
        skills=((129, 6),),
        zenith_skill_id=None,
    )
    assert by_id["cuff:3918"] == ParsedCuffRow(
        external_id="cuff:3918",
        name="Skill Slots Up Sigil",
        slot_size=1,
        skills=(),
        zenith_skill_id=1,
    )
