"""Query/repository layer over the ETL staging database (see docs/PLAN.md §7).

Writes here do not commit — a real load is tens of thousands of rows, and
committing per row (as an earlier version of this module did) turned a
sub-second load into one that didn't finish in 5 minutes. Callers control the
transaction boundary and commit when they're ready (once, at the end of a
bulk load; per-test, only if they need the data visible from a second
connection — reads on the same connection see your own uncommitted writes).
"""

from __future__ import annotations

import sqlite3

from etl.db.models import Cuff, Decoration, Equipment, EquipmentType, Skill, SkillPoints


def insert_skill(conn: sqlite3.Connection, *, name: str, category: str | None = None) -> Skill:
    """Get-or-create a skill by name.

    Unlike equipment, the same skill is referenced by thousands of pieces, so
    re-seeing one during an ETL run is normal, not a data error.
    """
    existing = get_skill_by_name(conn, name)
    if existing is not None:
        return existing

    cursor = conn.execute("INSERT INTO skill (name, category) VALUES (?, ?)", (name, category))
    row_id = cursor.lastrowid
    assert row_id is not None
    return Skill(id=row_id, name=name, category=category)


def get_skill_by_name(conn: sqlite3.Connection, name: str) -> Skill | None:
    row = conn.execute("SELECT id, name, category FROM skill WHERE name = ?", (name,)).fetchone()
    if row is None:
        return None
    return _skill_from_row(row)


def insert_equipment(
    conn: sqlite3.Connection,
    *,
    external_id: str,
    name: str,
    slot_type: EquipmentType,
    rarity: int | None = None,
    defense_base: int | None = None,
    defense_max: int | None = None,
    slot_count_base: int = 0,
    slot_count_max: int = 0,
    min_hr: int | None = None,
    min_gr: int | None = None,
    source_url: str | None = None,
) -> Equipment:
    """Insert a new equipment row.

    Unlike skills, a duplicate external_id indicates a genuine parser bug (the
    same source item parsed twice), so this intentionally fails loudly via the
    UNIQUE constraint rather than being idempotent.
    """
    cursor = conn.execute(
        """
        INSERT INTO equipment (
            external_id, name, slot_type, rarity, defense_base, defense_max,
            slot_count_base, slot_count_max, min_hr, min_gr, source_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            external_id,
            name,
            slot_type,
            rarity,
            defense_base,
            defense_max,
            slot_count_base,
            slot_count_max,
            min_hr,
            min_gr,
            source_url,
        ),
    )
    row_id = cursor.lastrowid
    assert row_id is not None
    return Equipment(
        id=row_id,
        external_id=external_id,
        name=name,
        slot_type=slot_type,
        rarity=rarity,
        defense_base=defense_base,
        defense_max=defense_max,
        slot_count_base=slot_count_base,
        slot_count_max=slot_count_max,
        min_hr=min_hr,
        min_gr=min_gr,
        source_url=source_url,
    )


def get_equipment_by_external_id(conn: sqlite3.Connection, external_id: str) -> Equipment | None:
    row = conn.execute("SELECT * FROM equipment WHERE external_id = ?", (external_id,)).fetchone()
    if row is None:
        return None
    return _equipment_from_row(row)


def list_equipment(
    conn: sqlite3.Connection, *, slot_type: EquipmentType | None = None
) -> list[Equipment]:
    if slot_type is None:
        rows = conn.execute("SELECT * FROM equipment ORDER BY id").fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM equipment WHERE slot_type = ? ORDER BY id", (slot_type,)
        ).fetchall()
    return [_equipment_from_row(row) for row in rows]


def add_equipment_skill(
    conn: sqlite3.Connection, *, equipment_id: int, skill_id: int, points: int
) -> None:
    conn.execute(
        "INSERT INTO equipment_skill (equipment_id, skill_id, points) VALUES (?, ?, ?)",
        (equipment_id, skill_id, points),
    )


def get_equipment_skills(conn: sqlite3.Connection, equipment_id: int) -> list[SkillPoints]:
    rows = conn.execute(
        """
        SELECT skill.id AS id, skill.name AS name, skill.category AS category,
               equipment_skill.points AS points
        FROM equipment_skill
        JOIN skill ON skill.id = equipment_skill.skill_id
        WHERE equipment_skill.equipment_id = ?
        ORDER BY skill.name
        """,
        (equipment_id,),
    ).fetchall()
    return [_skill_points_from_row(row) for row in rows]


def insert_decoration(
    conn: sqlite3.Connection,
    *,
    external_id: str,
    name: str,
    slot_size: int,
    source_url: str | None = None,
) -> Decoration:
    cursor = conn.execute(
        "INSERT INTO decoration (external_id, name, slot_size, source_url) VALUES (?, ?, ?, ?)",
        (external_id, name, slot_size, source_url),
    )
    row_id = cursor.lastrowid
    assert row_id is not None
    return Decoration(
        id=row_id, external_id=external_id, name=name, slot_size=slot_size, source_url=source_url
    )


def add_decoration_skill(
    conn: sqlite3.Connection, *, decoration_id: int, skill_id: int, points: int
) -> None:
    conn.execute(
        "INSERT INTO decoration_skill (decoration_id, skill_id, points) VALUES (?, ?, ?)",
        (decoration_id, skill_id, points),
    )


def get_decoration_skills(conn: sqlite3.Connection, decoration_id: int) -> list[SkillPoints]:
    rows = conn.execute(
        """
        SELECT skill.id AS id, skill.name AS name, skill.category AS category,
               decoration_skill.points AS points
        FROM decoration_skill
        JOIN skill ON skill.id = decoration_skill.skill_id
        WHERE decoration_skill.decoration_id = ?
        ORDER BY skill.name
        """,
        (decoration_id,),
    ).fetchall()
    return [_skill_points_from_row(row) for row in rows]


def insert_cuff(
    conn: sqlite3.Connection,
    *,
    external_id: str,
    name: str,
    slot_size: int,
    source_url: str | None = None,
) -> Cuff:
    cursor = conn.execute(
        "INSERT INTO cuff (external_id, name, slot_size, source_url) VALUES (?, ?, ?, ?)",
        (external_id, name, slot_size, source_url),
    )
    row_id = cursor.lastrowid
    assert row_id is not None
    return Cuff(
        id=row_id, external_id=external_id, name=name, slot_size=slot_size, source_url=source_url
    )


def get_cuff_by_external_id(conn: sqlite3.Connection, external_id: str) -> Cuff | None:
    row = conn.execute("SELECT * FROM cuff WHERE external_id = ?", (external_id,)).fetchone()
    if row is None:
        return None
    return _cuff_from_row(row)


def add_cuff_skill(conn: sqlite3.Connection, *, cuff_id: int, skill_id: int, points: int) -> None:
    conn.execute(
        "INSERT INTO cuff_skill (cuff_id, skill_id, points) VALUES (?, ?, ?)",
        (cuff_id, skill_id, points),
    )


def get_cuff_skills(conn: sqlite3.Connection, cuff_id: int) -> list[SkillPoints]:
    rows = conn.execute(
        """
        SELECT skill.id AS id, skill.name AS name, skill.category AS category,
               cuff_skill.points AS points
        FROM cuff_skill
        JOIN skill ON skill.id = cuff_skill.skill_id
        WHERE cuff_skill.cuff_id = ?
        ORDER BY skill.name
        """,
        (cuff_id,),
    ).fetchall()
    return [_skill_points_from_row(row) for row in rows]


def _cuff_from_row(row: sqlite3.Row) -> Cuff:
    return Cuff(
        id=row["id"],
        external_id=row["external_id"],
        name=row["name"],
        slot_size=row["slot_size"],
        source_url=row["source_url"],
    )


def _skill_from_row(row: sqlite3.Row) -> Skill:
    return Skill(id=row["id"], name=row["name"], category=row["category"])


def _equipment_from_row(row: sqlite3.Row) -> Equipment:
    return Equipment(
        id=row["id"],
        external_id=row["external_id"],
        name=row["name"],
        slot_type=row["slot_type"],
        rarity=row["rarity"],
        defense_base=row["defense_base"],
        defense_max=row["defense_max"],
        slot_count_base=row["slot_count_base"],
        slot_count_max=row["slot_count_max"],
        min_hr=row["min_hr"],
        min_gr=row["min_gr"],
        source_url=row["source_url"],
    )


def _skill_points_from_row(row: sqlite3.Row) -> SkillPoints:
    return SkillPoints(
        skill=Skill(id=row["id"], name=row["name"], category=row["category"]),
        points=row["points"],
    )
