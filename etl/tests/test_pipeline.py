import sqlite3
from pathlib import Path

from etl.db import repository as repo
from etl.db.connection import connect
from etl.pipeline import load_equipment

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
    # Brain (Zenith) = 13; 2 real decorations + Status Res Gem III (Tower
    # Gem) = 3; Attack II PA1/PA2 (regular) + SnS・Basic (Hiden) + Skill
    # Slots Up Sigil (Zenith) = 4 cuffs; 1 distinct Zenith skill (both
    # Espinas Z Brain and the Zenith Cuff grant "Skill Slots Up+1").
    assert summary.equipment_count == 13
    assert summary.decoration_count == 3
    assert summary.cuff_count == 4
    assert summary.zenith_skill_count == 1


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
    zenith_cuff = repo.get_cuff_by_external_id(conn, "cuff:3918")
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
