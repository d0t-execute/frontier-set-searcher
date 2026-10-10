import sqlite3
from pathlib import Path

import pytest

from etl.db import repository as repo
from etl.db.connection import connect


def _table_names(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    return {row["name"] for row in rows}


def test_schema_creates_expected_tables(conn: sqlite3.Connection) -> None:
    tables = _table_names(conn)
    assert {"equipment", "skill", "equipment_skill", "decoration", "decoration_skill"} <= tables


def test_foreign_keys_are_enforced(conn: sqlite3.Connection) -> None:
    (enabled,) = conn.execute("PRAGMA foreign_keys").fetchone()
    assert enabled == 1


def test_connect_is_idempotent_against_an_existing_database(tmp_path: Path) -> None:
    # Re-applying the schema (e.g. the next ETL run reusing the same file)
    # must not fail or wipe existing data.
    db_path = tmp_path / "existing.sqlite3"
    first = connect(db_path)
    repo.insert_skill(first, name="Attack Up (Small)")
    first.commit()
    first.close()

    second = connect(db_path)
    try:
        assert repo.get_skill_by_name(second, "Attack Up (Small)") is not None
    finally:
        second.close()


def test_equipment_skill_requires_an_existing_equipment(conn: sqlite3.Connection) -> None:
    skill = repo.insert_skill(conn, name="Attack Up (Small)")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO equipment_skill (equipment_id, skill_id, points) VALUES (?, ?, ?)",
            (999, skill.id, 3),
        )


def test_equipment_skill_requires_an_existing_skill(conn: sqlite3.Connection) -> None:
    equipment = repo.insert_equipment(
        conn, external_id="0001", name="Leather Helm", slot_type="head"
    )
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO equipment_skill (equipment_id, skill_id, points) VALUES (?, ?, ?)",
            (equipment.id, 999, 3),
        )


def test_equipment_rejects_an_unknown_slot_type(conn: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        repo.insert_equipment(
            conn,
            external_id="0001",
            name="Mystery Gear",
            slot_type="helmet",  # type: ignore[arg-type]
        )


def test_equipment_external_id_is_unique(conn: sqlite3.Connection) -> None:
    repo.insert_equipment(conn, external_id="0001", name="Leather Helm", slot_type="head")
    with pytest.raises(sqlite3.IntegrityError):
        repo.insert_equipment(conn, external_id="0001", name="Duplicate", slot_type="head")


def test_decoration_rejects_an_invalid_slot_size(conn: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        repo.insert_decoration(conn, external_id="D001", name="Weird Jewel", slot_size=4)
