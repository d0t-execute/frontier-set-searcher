from pathlib import Path

from etl.parse.equipment import (
    ParsedDecorationRow,
    ParsedEquipmentRow,
    compute_defense_progression,
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


def test_parses_a_decoration_row() -> None:
    bucket_json = '{"1016":"Attack II PA1,0,0,5,,,,,,,21,5,67,2,,,,,,,,110C1,1,,1,0,,,2,,,,,4k,1,"}'

    rows = parse_decoration_bucket(bucket_json)

    assert rows == [
        ParsedDecorationRow(
            external_id="deco:1016",
            name="Attack II PA1",
            slot_size=2,
            skills=((21, 5), (67, 2)),
        )
    ]


# -- full equip.js source parsing across all buckets -------------------------


def test_parse_equip_js_covers_every_armor_bucket() -> None:
    result = parse_equip_js(_combined_source())

    by_id = {row.external_id: row for row in result.equipment}

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


def test_parse_equip_js_covers_decorations() -> None:
    result = parse_equip_js(_combined_source())

    by_id = {row.external_id: row for row in result.decorations}

    assert by_id["deco:1016"].skills == ((21, 5), (67, 2))
    assert by_id["deco:1017"] == ParsedDecorationRow(
        external_id="deco:1017",
        name="Attack II PA2",
        slot_size=2,
        skills=((21, 4), (45, 3)),
    )
