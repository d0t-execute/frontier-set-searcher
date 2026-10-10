from pathlib import Path

from etl.parse.weapon import ParsedWeaponRow, parse_weapon_page

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"


def _fixture_html() -> str:
    return (FIXTURES_DIR / "weapon_sample.htm").read_text(encoding="utf-8")


def _bow_fixture_html() -> str:
    return (FIXTURES_DIR / "weapon_sample_bow.htm").read_text(encoding="utf-8")


def _bowgun_fixture_html() -> str:
    return (FIXTURES_DIR / "weapon_sample_bowgun.htm").read_text(encoding="utf-8")


def test_parses_a_plain_weapon() -> None:
    rows = parse_weapon_page("taiken", _fixture_html())

    buster_sword = next(r for r in rows if r.name == "Buster Sword")

    assert buster_sword == ParsedWeaponRow(
        external_id="taiken:0003",
        name="Buster Sword",
        weapon_type="great_sword",
        rarity=1,
        slot_count=0,
        rank_type="HR",
        rank_value=1,
        is_tower=False,
        zenith_skill_name=None,
    )


def test_parses_a_tower_weapon() -> None:
    # CLASS-equivalent tag "天廊武器" (Tower Weapon) in the Name cell --
    # confirmed exact mirror of armor's Tower-origin tagging. No Zenith
    # skill (Tower and Zenith are separate systems, same as for armor).
    rows = parse_weapon_page("taiken", _fixture_html())

    hate_bleeder = next(r for r in rows if r.name == "Hate Bleeder")

    assert hate_bleeder == ParsedWeaponRow(
        external_id="taiken:318F",
        name="Hate Bleeder",
        weapon_type="great_sword",
        rarity=3,
        slot_count=2,
        rank_type="HR",
        rank_value=1,
        is_tower=True,
        zenith_skill_name=None,
    )


def test_parses_a_zenith_weapon() -> None:
    # CLASS-equivalent tag "辿異武器" (Zenith Weapon) -- carries a Zenith
    # skill given as a plain readable name ("Zenith Skill：Drug Knowledge
    # Up+"), unlike armor's numeric Teni->TENINAME indirection.
    rows = parse_weapon_page("taiken", _fixture_html())

    feather_sleeper = next(r for r in rows if r.name == "Feather Sleeper")

    assert feather_sleeper == ParsedWeaponRow(
        external_id="taiken:3B13",
        name="Feather Sleeper",
        weapon_type="great_sword",
        rarity=9,
        slot_count=3,
        rank_type="GR",
        rank_value=200,
        is_tower=False,
        zenith_skill_name="Drug Knowledge Up",
    )


def test_strips_the_decorative_trailing_plus_from_flat_zenith_skill_names() -> None:
    # Confirmed against the live site: weapon pages append a bare "+" to
    # *flat* Zenith skill names ("Dissolver Up+") that isn't part of the
    # canonical TENINAME string ("Dissolver Up"), but leave *tiered* names
    # ("Skill Slots Up+1", "Vampirism Up+1") untouched, since those already
    # end in a digit, not "+". The rule is simply "strip a trailing +".
    html = _fixture_html().replace("Drug Knowledge Up+", "Skill Slots Up+1")

    rows = parse_weapon_page("taiken", html)

    feather_sleeper = next(r for r in rows if r.name == "Feather Sleeper")
    assert feather_sleeper.zenith_skill_name == "Skill Slots Up+1"


def test_parse_weapon_page_covers_every_row() -> None:
    rows = parse_weapon_page("taiken", _fixture_html())

    assert [r.external_id for r in rows] == ["taiken:0003", "taiken:318F", "taiken:3B13"]


def test_tower_tag_implies_no_zenith_skill_and_vice_versa() -> None:
    rows = parse_weapon_page("taiken", _fixture_html())

    by_name = {r.name: r for r in rows}
    assert by_name["Hate Bleeder"].is_tower is True
    assert by_name["Hate Bleeder"].zenith_skill_name is None
    assert by_name["Feather Sleeper"].is_tower is False
    assert by_name["Feather Sleeper"].zenith_skill_name is not None


def test_parses_a_bow_using_its_own_column_layout() -> None:
    # Bows have an extra "Coatings" column, shifting Slots/Rank one index
    # later than melee weapons (5/6 instead of 4/5) -- confirmed against the
    # live site, not assumed from melee's layout. The Zenith Skill tag stays
    # in the same cell index as melee's Sharpness cell (3), though.
    rows = parse_weapon_page("yumi", _bow_fixture_html())

    hunter_bow = next(r for r in rows if r.name == "Hunter Bow III")
    assert hunter_bow == ParsedWeaponRow(
        external_id="yumi:004E",
        name="Hunter Bow III",
        weapon_type="bow",
        rarity=2,
        slot_count=3,
        rank_type="HR",
        rank_value=1,
        is_tower=False,
        zenith_skill_name=None,
    )

    by_name = {r.name: r for r in rows}
    assert by_name["670B・シェオル"].is_tower is True
    assert by_name["670B・シェオル"].zenith_skill_name is None
    assert by_name["Lightning Bow"].is_tower is False
    assert by_name["Lightning Bow"].zenith_skill_name == "Skill Slots Up+1"
    assert by_name["Lightning Bow"].slot_count == 3
    assert by_name["Lightning Bow"].rank_type == "GR"
    assert by_name["Lightning Bow"].rank_value == 200


def test_parses_a_light_bowgun_using_its_own_column_layout() -> None:
    # LBG/HBG share Bow's Slots/Rank shift, but the Zenith Skill tag lives
    # one cell further out (the Ammo cell, index 4) than Bow's -- confirmed
    # against the live site for both Light and Heavy Bowgun.
    rows = parse_weapon_page("right", _bowgun_fixture_html())

    cross_bowgun = next(r for r in rows if r.name == "Cross Bowgun")
    assert cross_bowgun == ParsedWeaponRow(
        external_id="right:0001",
        name="Cross Bowgun",
        weapon_type="light_bowgun",
        rarity=1,
        slot_count=3,
        rank_type="HR",
        rank_value=1,
        is_tower=False,
        zenith_skill_name=None,
    )

    by_name = {r.name: r for r in rows}
    assert by_name["660B・ノヴァエラ"].is_tower is True
    assert by_name["660B・ノヴァエラ"].zenith_skill_name is None
    assert by_name["Lightning Gun"].is_tower is False
    assert by_name["Lightning Gun"].zenith_skill_name == "Skill Slots Up+1"
    assert by_name["Lightning Gun"].slot_count == 3
    assert by_name["Lightning Gun"].rank_type == "GR"
    assert by_name["Lightning Gun"].rank_value == 200
