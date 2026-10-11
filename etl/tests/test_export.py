import json
import sqlite3
from pathlib import Path
from typing import Any

from etl.db import repository as repo
from etl.db.connection import connect
from etl.export import EXPORT_FORMAT_VERSION, export_bundle


def _conn(tmp_path: Path) -> sqlite3.Connection:
    return connect(tmp_path / "export.sqlite3")


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def test_writes_a_manifest_naming_the_format_version_and_slot_types(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    out_dir = tmp_path / "bundle"

    export_bundle(conn, out_dir)

    manifest = _load(out_dir / "manifest.json")
    assert manifest["formatVersion"] == EXPORT_FORMAT_VERSION
    assert manifest["slotTypes"] == ["head", "chest", "arms", "waist", "legs"]


def test_writes_one_equipment_file_per_armor_slot_type_even_when_empty(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    out_dir = tmp_path / "bundle"

    export_bundle(conn, out_dir)

    for slot_type in ("head", "chest", "arms", "waist", "legs"):
        assert _load(out_dir / "equipment" / f"{slot_type}.json") == []


def test_exports_equipment_shaped_for_the_search_engine(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    attack = repo.insert_skill(conn, name="Attack Up (Small)")
    equipment = repo.insert_equipment(
        conn,
        external_id="head:0001",
        name="Leather Helm",
        slot_type="head",
        slot_count_base=0,
        slot_count_max=2,
    )
    repo.add_equipment_skill(conn, equipment_id=equipment.id, skill_id=attack.id, points=3)
    conn.commit()
    out_dir = tmp_path / "bundle"

    export_bundle(conn, out_dir)

    heads = _load(out_dir / "equipment" / "head.json")
    assert heads == [
        {
            "id": "head:0001",
            "name": "Leather Helm",
            "skills": [{"skillId": attack.id, "points": 3}],
            "openSlotCount": 2,
        }
    ]


def test_exports_equipment_under_its_own_slot_type_only(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    repo.insert_equipment(conn, external_id="head:0001", name="Leather Helm", slot_type="head")
    repo.insert_equipment(conn, external_id="body:0001", name="Leather Vest", slot_type="chest")
    conn.commit()
    out_dir = tmp_path / "bundle"

    export_bundle(conn, out_dir)

    assert [e["id"] for e in _load(out_dir / "equipment" / "head.json")] == ["head:0001"]
    assert [e["id"] for e in _load(out_dir / "equipment" / "chest.json")] == ["body:0001"]


def test_exports_decorations_shaped_for_the_search_engine(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    attack = repo.insert_skill(conn, name="Attack Up (Small)")
    decoration = repo.insert_decoration(conn, external_id="D001", name="Attack Jewel", slot_size=2)
    repo.add_decoration_skill(conn, decoration_id=decoration.id, skill_id=attack.id, points=3)
    conn.commit()
    out_dir = tmp_path / "bundle"

    export_bundle(conn, out_dir)

    assert _load(out_dir / "decorations.json") == [
        {
            "id": "D001",
            "name": "Attack Jewel",
            "slotSize": 2,
            "skills": [{"skillId": attack.id, "points": 3}],
        }
    ]


def test_exports_a_skill_lookup_table(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    attack = repo.insert_skill(conn, name="Attack Up (Small)", category="offense")
    conn.commit()
    out_dir = tmp_path / "bundle"

    export_bundle(conn, out_dir)

    assert _load(out_dir / "skills.json") == [
        {"id": attack.id, "name": "Attack Up (Small)", "category": "offense", "tiers": []}
    ]


def test_exports_a_skills_tiers_in_order(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    health = repo.insert_skill(conn, name="Health", category="Health and Stamina")
    repo.insert_skill_tier(
        conn,
        skill_id=health.id,
        tier_order=0,
        label="Health+50",
        threshold=40,
        description="Maximum Health +50",
    )
    repo.insert_skill_tier(
        conn, skill_id=health.id, tier_order=1, label="Health-10", threshold=-10, description=None
    )
    conn.commit()
    out_dir = tmp_path / "bundle"

    export_bundle(conn, out_dir)

    assert _load(out_dir / "skills.json") == [
        {
            "id": health.id,
            "name": "Health",
            "category": "Health and Stamina",
            "tiers": [
                {"label": "Health+50", "minPoints": 40, "description": "Maximum Health +50"},
                {"label": "Health-10", "minPoints": -10, "description": None},
            ],
        }
    ]


def test_is_safe_to_run_twice_into_the_same_directory(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    repo.insert_equipment(conn, external_id="head:0001", name="Leather Helm", slot_type="head")
    conn.commit()
    out_dir = tmp_path / "bundle"

    export_bundle(conn, out_dir)
    export_bundle(conn, out_dir)

    assert [e["id"] for e in _load(out_dir / "equipment" / "head.json")] == ["head:0001"]
