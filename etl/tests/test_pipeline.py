import sqlite3
from pathlib import Path

from etl.db import repository as repo
from etl.db.connection import connect
from etl.pipeline import load_equipment, load_skill_priority, load_skill_tiers, load_weapons

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


def _combined_equip_source() -> str:
    equip = (FIXTURES_DIR / "equip_sample.js").read_text(encoding="utf-8")
    defs = (FIXTURES_DIR / "def_patterns.js").read_text(encoding="utf-8")
    return equip + "\n" + defs


def _skillform_source() -> str:
    skills = (FIXTURES_DIR / "skill_names_sample.js").read_text(encoding="utf-8")
    zenith_skills = (FIXTURES_DIR / "zenith_skill_names_sample.js").read_text(encoding="utf-8")
    return skills + "\n" + zenith_skills


def _conn(tmp_path: Path) -> sqlite3.Connection:
    return connect(tmp_path / "pipeline.sqlite3")


def test_load_equipment_reports_accurate_counts(tmp_path: Path) -> None:
    conn = _conn(tmp_path)

    summary = load_equipment(
        conn,
        skillform_source=_skillform_source(),
        equip_source=_combined_equip_source(),
        source_url="https://example.test/equip.js",
    )

    # 3 head + 2 each of body/arm/wst/leg + Ranvuo Helm (Tower) + Espinas Z
    # Brain (Zenith) + Barioth Helm (Exotic) = 14; 2 real decorations +
    # Status Res Gem III (Tower Gem) = 3; Attack II PA1/PA2 (regular) +
    # SnS・Basic (Hiden) + Skill Slots Up Sigil (Zenith) = 4 cuffs; 1 distinct
    # Zenith skill (both Espinas Z Brain and the Zenith Cuff grant "Skill
    # Slots Up+1").
    assert summary.equipment_count == 14
    assert summary.decoration_count == 3
    assert summary.cuff_count == 4
    assert summary.zenith_skill_count == 1
    assert summary.exotic_grant_count == 1
    assert summary.unmatched_exotic_markers == ()


def test_load_equipment_applies_an_exotic_armors_bonus_skill_grant(tmp_path: Path) -> None:
    # Real "Barioth Helm" row (CLASS "O") -- its own listed skills (64, 21,
    # 18, 191, 148, all 5 points) plus a bonus "Ice Attack" grant from its
    # Exotic Armor marker, resolved via EXOTIC_ARMOR_SKILL_GRANTS to 20
    # points ("Ice Attack (Large)"'s own tier threshold).
    conn = _conn(tmp_path)

    load_equipment(
        conn,
        skillform_source=_skillform_source(),
        equip_source=_combined_equip_source(),
        source_url="https://example.test/equip.js",
    )

    equipment = repo.get_equipment_by_external_id(conn, "head:2821")
    assert equipment is not None
    skills = repo.get_equipment_skills(conn, equipment.id)
    skill_points = {sp.skill.name: sp.points for sp in skills}
    assert skill_points["Ice Attack"] == 20


def test_load_equipment_reports_an_exotic_marker_not_in_the_grants_dict(tmp_path: Path) -> None:
    # Same "report, don't guess" convention as SkillTierLoadSummary/
    # SkillPriorityLoadSummary -- a future re-scrape could expose a new
    # Exotic monster family EXOTIC_ARMOR_SKILL_GRANTS hasn't been taught
    # about yet; it should be surfaced, not silently dropped.
    conn = _conn(tmp_path)
    defs = (FIXTURES_DIR / "def_patterns.js").read_text(encoding="utf-8")
    equip_source = (
        'SkillForm.setEquip("head", {"9999":"Fake Exotic,0,0,1,,,,,,,,,,,,,,,,,,,,,,,7,0,0,,00,,,'
        '1-,,O,,,fake flavor text≪Exotic Armor：Totally Unknown Skill≫"})\n'
        'SkillForm.setEquip("body", {})\n'
        'SkillForm.setEquip("arm", {})\n'
        'SkillForm.setEquip("wst", {})\n'
        'SkillForm.setEquip("leg", {})\n'
        'SkillForm.setEquip("deco", {})\n'
    ) + defs

    summary = load_equipment(
        conn,
        skillform_source=_skillform_source(),
        equip_source=equip_source,
        source_url="https://example.test/equip.js",
    )

    assert summary.exotic_grant_count == 0
    assert summary.unmatched_exotic_markers == ("Totally Unknown Skill",)


def test_load_equipment_resolves_real_skill_names_when_known(tmp_path: Path) -> None:
    conn = _conn(tmp_path)

    load_equipment(
        conn,
        skillform_source=_skillform_source(),
        equip_source=_combined_equip_source(),
        source_url="https://example.test/equip.js",
    )

    equipment = repo.get_equipment_by_external_id(conn, "head:1000")
    assert equipment is not None

    skills = repo.get_equipment_skills(conn, equipment.id)
    skill_names = {sp.skill.name: sp.points for sp in skills}
    assert skill_names["Protection"] == 5  # skill id 9, within the sample's known range


def test_load_equipment_falls_back_to_a_placeholder_name_for_unknown_skills(
    tmp_path: Path,
) -> None:
    conn = _conn(tmp_path)

    load_equipment(
        conn,
        skillform_source=_skillform_source(),
        equip_source=_combined_equip_source(),
        source_url="https://example.test/equip.js",
    )

    # Leather Helm's skill 22 is outside the trimmed skill-name fixture's range.
    equipment = repo.get_equipment_by_external_id(conn, "head:0001")
    assert equipment is not None
    skills = repo.get_equipment_skills(conn, equipment.id)
    assert any(sp.skill.name == "Unknown Skill 22" for sp in skills)


def test_load_equipment_persists_equipment_and_decoration_fields(tmp_path: Path) -> None:
    conn = _conn(tmp_path)

    load_equipment(
        conn,
        skillform_source=_skillform_source(),
        equip_source=_combined_equip_source(),
        source_url="https://example.test/equip.js",
    )

    helm = repo.get_equipment_by_external_id(conn, "head:0001")
    assert helm is not None
    assert helm.name == "Leather Helm"
    assert helm.defense_base == 2
    assert helm.defense_max == 10
    assert helm.source_url == "https://example.test/equip.js"

    decoration_row = conn.execute(
        "SELECT name, slot_size FROM decoration WHERE external_id = ?", ("deco:031F",)
    ).fetchone()
    assert decoration_row["name"] == "Paralysis 1 Deco"
    assert decoration_row["slot_size"] == 1

    cuff_row = conn.execute(
        "SELECT name, slot_size FROM cuff WHERE external_id = ?", ("cuff:1016",)
    ).fetchone()
    assert cuff_row["name"] == "Attack II PA1"
    assert cuff_row["slot_size"] == 2

    hiden_cuff_row = conn.execute(
        "SELECT name, slot_size FROM cuff WHERE external_id = ?", ("cuff:3F20",)
    ).fetchone()
    assert hiden_cuff_row["name"] == "SnS・Basic"
    assert hiden_cuff_row["slot_size"] == 0

    tower_helm = repo.get_equipment_by_external_id(conn, "head:2543")
    assert tower_helm is not None
    assert tower_helm.name == "Ranvuo Helm"
    assert tower_helm.is_tower is True
    assert tower_helm.zenith_skill_id is None

    tower_gem = conn.execute(
        "SELECT name, is_tower FROM decoration WHERE external_id = ?", ("deco:287F",)
    ).fetchone()
    assert tower_gem["name"] == "Status Res Gem III"
    assert bool(tower_gem["is_tower"]) is True


def test_load_equipment_resolves_zenith_skills(tmp_path: Path) -> None:
    conn = _conn(tmp_path)

    load_equipment(
        conn,
        skillform_source=_skillform_source(),
        equip_source=_combined_equip_source(),
        source_url="https://example.test/equip.js",
    )

    zenith_armor = repo.get_equipment_by_external_id(conn, "head:2B8D")
    assert zenith_armor is not None
    assert zenith_armor.name == "Espinas Z Brain"
    assert zenith_armor.is_tower is False
    assert zenith_armor.zenith_skill_id is not None

    zenith_skill = repo.get_zenith_skill_by_name(conn, "Skill Slots Up+1")
    assert zenith_skill is not None
    assert zenith_armor.zenith_skill_id == zenith_skill.id

    # The Zenith Cuff grants the *same* Zenith skill -- confirms it's shared
    # (get-or-create), not duplicated, the same way normal skills are shared.
    zenith_cuff = repo.get_cuff_by_external_id(conn, "cuff:3637")
    assert zenith_cuff is not None
    assert zenith_cuff.zenith_skill_id == zenith_skill.id

    (zenith_skill_row_count,) = conn.execute("SELECT COUNT(*) FROM zenith_skill").fetchone()
    assert zenith_skill_row_count == 1


def test_load_equipment_shares_one_skill_row_across_multiple_pieces(tmp_path: Path) -> None:
    conn = _conn(tmp_path)

    load_equipment(
        conn,
        skillform_source=_skillform_source(),
        equip_source=_combined_equip_source(),
        source_url="https://example.test/equip.js",
    )

    # Skill 102 is granted by body:1000, arm:1000, and leg:1000 in the fixture.
    (skill_row_count,) = conn.execute(
        "SELECT COUNT(*) FROM skill WHERE name = 'Unknown Skill 102'"
    ).fetchone()
    assert skill_row_count == 1


def _weapon_sample_html() -> str:
    return (FIXTURES_DIR / "weapon_sample.htm").read_text(encoding="utf-8")


def test_load_weapons_reports_accurate_counts(tmp_path: Path) -> None:
    conn = _conn(tmp_path)

    summary = load_weapons(conn, page_sources={"taiken": _weapon_sample_html()})

    assert summary.weapon_count == 3
    assert summary.zenith_skill_count == 1


def test_load_weapons_persists_fields_and_source_url(tmp_path: Path) -> None:
    conn = _conn(tmp_path)

    load_weapons(conn, page_sources={"taiken": _weapon_sample_html()})

    buster_sword = repo.get_weapon_by_external_id(conn, "taiken:0003")
    assert buster_sword is not None
    assert buster_sword.name == "Buster Sword"
    assert buster_sword.weapon_type == "great_sword"
    assert buster_sword.rarity == 1
    assert buster_sword.slot_count == 0
    assert buster_sword.rank_type == "HR"
    assert buster_sword.rank_value == 1
    assert buster_sword.is_tower is False
    assert buster_sword.zenith_skill_id is None
    assert (
        buster_sword.source_url
        == "https://xl3lackout.github.io/MHFZ-Ferias-English-Project/buki/taiken.htm"
    )


def test_load_weapons_marks_tower_weapons(tmp_path: Path) -> None:
    conn = _conn(tmp_path)

    load_weapons(conn, page_sources={"taiken": _weapon_sample_html()})

    hate_bleeder = repo.get_weapon_by_external_id(conn, "taiken:318F")
    assert hate_bleeder is not None
    assert hate_bleeder.is_tower is True
    assert hate_bleeder.zenith_skill_id is None


def test_load_weapons_resolves_zenith_skill_by_name(tmp_path: Path) -> None:
    conn = _conn(tmp_path)

    load_weapons(conn, page_sources={"taiken": _weapon_sample_html()})

    feather_sleeper = repo.get_weapon_by_external_id(conn, "taiken:3B13")
    assert feather_sleeper is not None
    assert feather_sleeper.zenith_skill_id is not None

    zenith_skill = repo.get_zenith_skill_by_name(conn, "Drug Knowledge Up")
    assert zenith_skill is not None
    assert feather_sleeper.zenith_skill_id == zenith_skill.id


def test_load_weapons_shares_one_zenith_skill_row_across_multiple_weapons(
    tmp_path: Path,
) -> None:
    # Two independent, minimal rows granting the same Zenith skill text --
    # confirms get-or-create sharing, mirroring
    # test_load_equipment_shares_one_skill_row_across_multiple_pieces.
    html = """
    <table><tbody>
    <tr><td id="l0001">Weapon A</td><td>1</td><td></td>
        <td><q>Zenith Skill：Drug Knowledge Up+</q></td><td>0</td><td>HR<br>1</td></tr>
    <tr><td id="l0002">Weapon B</td><td>1</td><td></td>
        <td><q>Zenith Skill：Drug Knowledge Up+</q></td><td>0</td><td>HR<br>1</td></tr>
    </tbody></table>
    """
    conn = _conn(tmp_path)

    load_weapons(conn, page_sources={"taiken": html})

    (zenith_skill_row_count,) = conn.execute("SELECT COUNT(*) FROM zenith_skill").fetchone()
    assert zenith_skill_row_count == 1


def test_load_weapons_aliases_abbreviated_zenith_skill_names_to_the_canonical_family(
    tmp_path: Path,
) -> None:
    # The weapon pages label this family "Earplugs Up+1" (confirmed against
    # the raw cached buki_taiken.body: "Zenith Skill：Earplugs Up+1"), but
    # equip.js/SkillForm.js -- and this family's own real cuffs, e.g.
    # "Earplugs Up SZ" -- call it "Hearing Protection Up+1" (see
    # ZENITH_SKILL_WEAPON_NAME_ALIASES). Without the alias, `load_weapons`
    # would insert a second, duplicate `zenith_skill` row for the same real
    # effect instead of reusing the family's one true id.
    conn = _conn(tmp_path)
    canonical = repo.insert_zenith_skill(conn, name="Hearing Protection Up+1")

    html = """
    <table><tbody>
    <tr><td id="l0001">Weapon A</td><td>1</td><td></td>
        <td><q>Zenith Skill：Earplugs Up+1</q></td><td>0</td><td>HR<br>1</td></tr>
    </tbody></table>
    """
    load_weapons(conn, page_sources={"taiken": html})

    (zenith_skill_row_count,) = conn.execute("SELECT COUNT(*) FROM zenith_skill").fetchone()
    assert zenith_skill_row_count == 1

    weapon_a = repo.get_weapon_by_external_id(conn, "taiken:0001")
    assert weapon_a is not None
    assert weapon_a.zenith_skill_id == canonical.id


_TIER_HTML = """
<table id="skills_base"><tbody id="skills_base">
<tr onclick="x"><th colspan="5" class="title">-Health and Stamina-</th></tr>
<tr class="l"><td class="g" rowspan="2">Health</td><td class="g" rowspan="2">o</td>
    <td class="t">Health+50</td><td class="n">40</td><td class="b">+50 max health</td></tr>
<tr><td class="t">Health-10</td><td class="n">-10</td><td class="b">-10 max health</td></tr>
<tr class="l"><td class="g">Not In Catalog</td><td class="g"></td>
    <td class="t">Not In Catalog</td><td class="n">10</td><td class="b">desc</td></tr>
</tbody></table>
"""


def test_load_skill_tiers_attaches_tiers_and_category_to_a_matching_skill(
    tmp_path: Path,
) -> None:
    conn = _conn(tmp_path)
    health = repo.insert_skill(conn, name="Health")

    load_skill_tiers(conn, html=_TIER_HTML)

    tiers = repo.get_skill_tiers(conn, health.id)
    assert [t.label for t in tiers] == ["Health+50", "Health-10"]
    assert [t.threshold for t in tiers] == [40, -10]

    updated = repo.get_skill_by_name(conn, "Health")
    assert updated is not None
    assert updated.category == "Health and Stamina"


def test_load_skill_tiers_reports_groups_with_no_matching_catalog_skill(
    tmp_path: Path,
) -> None:
    conn = _conn(tmp_path)
    repo.insert_skill(conn, name="Health")

    summary = load_skill_tiers(conn, html=_TIER_HTML)

    assert summary.matched_group_count == 1
    assert summary.unmatched_group_names == ("Not In Catalog",)


def test_load_skill_tiers_reports_catalog_skills_with_no_tier_data(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    repo.insert_skill(conn, name="Health")
    repo.insert_skill(conn, name="Gather")  # not present in _TIER_HTML at all

    summary = load_skill_tiers(conn, html=_TIER_HTML)

    assert summary.unmatched_skill_names == ("Gather",)


def test_load_skill_tiers_is_safe_to_run_twice(tmp_path: Path) -> None:
    # Re-running the pipeline against the same DB (e.g. after a re-crawl)
    # must not hit the (skill_id, tier_order) uniqueness constraint.
    conn = _conn(tmp_path)
    repo.insert_skill(conn, name="Health")

    load_skill_tiers(conn, html=_TIER_HTML)
    load_skill_tiers(conn, html=_TIER_HTML)

    health = repo.get_skill_by_name(conn, "Health")
    assert health is not None
    assert len(repo.get_skill_tiers(conn, health.id)) == 2


def test_load_skill_tiers_matches_a_known_alias_when_the_exact_name_differs(
    tmp_path: Path,
) -> None:
    # The two sites are independently-maintained fan translations -- e.g. the
    # tier site's "Para" is this project's catalog's "Paralysis". Confirmed
    # against the live site's full run (see pipeline.SKILL_TIER_NAME_ALIASES).
    conn = _conn(tmp_path)
    repo.insert_skill(conn, name="Paralysis")
    html = """
    <table id="skills_base"><tbody id="skills_base">
    <tr class="l"><td class="g">Para</td><td class="g"></td>
        <td class="t">Negate Para</td><td class="n">20</td><td class="b">desc</td></tr>
    </tbody></table>
    """

    summary = load_skill_tiers(conn, html=html)

    assert summary.matched_group_count == 1
    assert summary.unmatched_group_names == ()
    skill = repo.get_skill_by_name(conn, "Paralysis")
    assert skill is not None
    assert len(repo.get_skill_tiers(conn, skill.id)) == 1


_PRIORITY_HTML = """
<table id="skills_priority"><tbody>
<tr><td class="npr">1</td><td class="i">SnS Tech</td><td class="npr">78</td>
<td class="i">[Skill Removed]</td></tr>
<tr><td class="npr">16</td><td class="i">Strong Attack</td><td class="npr">200</td>
<td class="i">Not In Catalog</td></tr>
</tbody></table>
"""


def test_load_skill_priority_attaches_a_rank_to_a_matching_skill(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    repo.insert_skill(conn, name="SnS Tech")

    load_skill_priority(conn, html=_PRIORITY_HTML)

    skill = repo.get_skill_by_name(conn, "SnS Tech")
    assert skill is not None
    assert skill.priority_rank == 1


def test_load_skill_priority_skips_the_skill_removed_placeholder(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    repo.insert_skill(conn, name="SnS Tech")

    summary = load_skill_priority(conn, html=_PRIORITY_HTML)

    assert "[Skill Removed]" not in summary.unmatched_entry_names


def test_load_skill_priority_reports_entries_with_no_matching_catalog_skill(
    tmp_path: Path,
) -> None:
    conn = _conn(tmp_path)
    repo.insert_skill(conn, name="SnS Tech")
    repo.insert_skill(conn, name="Strong Attack")

    summary = load_skill_priority(conn, html=_PRIORITY_HTML)

    assert summary.matched_rank_count == 2
    assert summary.unmatched_entry_names == ("Not In Catalog",)


def test_load_skill_priority_reports_catalog_skills_with_no_rank(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    repo.insert_skill(conn, name="SnS Tech")
    repo.insert_skill(conn, name="Gather")  # not present in _PRIORITY_HTML at all

    summary = load_skill_priority(conn, html=_PRIORITY_HTML)

    assert summary.unmatched_skill_names == ("Gather",)


def test_load_skill_priority_is_safe_to_run_twice(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    repo.insert_skill(conn, name="SnS Tech")

    load_skill_priority(conn, html=_PRIORITY_HTML)
    load_skill_priority(conn, html=_PRIORITY_HTML)

    skill = repo.get_skill_by_name(conn, "SnS Tech")
    assert skill is not None
    assert skill.priority_rank == 1


def test_load_skill_priority_matches_a_known_alias_when_the_exact_name_differs(
    tmp_path: Path,
) -> None:
    # Same site as load_skill_tiers, same alias map (SKILL_TIER_NAME_ALIASES)
    # -- e.g. the priority page's "DB Tech" is this project's catalog's
    # "DS Tech".
    conn = _conn(tmp_path)
    repo.insert_skill(conn, name="DS Tech")
    html = """
    <table id="skills_priority"><tbody>
    <tr><td class="npr">2</td><td class="i">DB Tech</td></tr>
    </tbody></table>
    """

    summary = load_skill_priority(conn, html=html)

    assert summary.matched_rank_count == 1
    assert summary.unmatched_entry_names == ()
    skill = repo.get_skill_by_name(conn, "DS Tech")
    assert skill is not None
    assert skill.priority_rank == 2
