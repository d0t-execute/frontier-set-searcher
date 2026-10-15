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

from etl.db.models import (
    Cuff,
    Decoration,
    Equipment,
    EquipmentType,
    HunterType,
    RankType,
    Skill,
    SkillPoints,
    SkillTier,
    Weapon,
    WeaponType,
    ZenithSkill,
)


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
    row = conn.execute(
        "SELECT id, name, category, priority_rank FROM skill WHERE name = ?", (name,)
    ).fetchone()
    if row is None:
        return None
    return _skill_from_row(row)


def insert_zenith_skill(conn: sqlite3.Connection, *, name: str) -> ZenithSkill:
    """Get-or-create a Zenith skill by name (see docs/data-format-notes.md "Zenith skills").

    Get-or-create for the same reason as `insert_skill`: the same Zenith
    skill is granted by many equipment pieces and Zenith Cuffs.
    """
    existing = get_zenith_skill_by_name(conn, name)
    if existing is not None:
        return existing

    cursor = conn.execute("INSERT INTO zenith_skill (name) VALUES (?)", (name,))
    row_id = cursor.lastrowid
    assert row_id is not None
    return ZenithSkill(id=row_id, name=name)


def list_skills(conn: sqlite3.Connection) -> list[Skill]:
    rows = conn.execute(
        "SELECT id, name, category, priority_rank FROM skill ORDER BY id"
    ).fetchall()
    return [_skill_from_row(row) for row in rows]


def set_skill_category(conn: sqlite3.Connection, *, skill_id: int, category: str) -> None:
    conn.execute("UPDATE skill SET category = ? WHERE id = ?", (category, skill_id))


def set_skill_priority_rank(conn: sqlite3.Connection, *, skill_id: int, rank: int) -> None:
    conn.execute("UPDATE skill SET priority_rank = ? WHERE id = ?", (rank, skill_id))


def insert_skill_tier(
    conn: sqlite3.Connection,
    *,
    skill_id: int,
    tier_order: int,
    label: str,
    threshold: int,
    description: str | None = None,
) -> None:
    conn.execute(
        """
        INSERT INTO skill_tier (skill_id, tier_order, label, threshold, description)
        VALUES (?, ?, ?, ?, ?)
        """,
        (skill_id, tier_order, label, threshold, description),
    )


def get_skill_tiers(conn: sqlite3.Connection, skill_id: int) -> list[SkillTier]:
    rows = conn.execute(
        """
        SELECT label, threshold, description FROM skill_tier
        WHERE skill_id = ? ORDER BY tier_order
        """,
        (skill_id,),
    ).fetchall()
    return [
        SkillTier(label=row["label"], threshold=row["threshold"], description=row["description"])
        for row in rows
    ]


def get_zenith_skill_by_name(conn: sqlite3.Connection, name: str) -> ZenithSkill | None:
    row = conn.execute("SELECT id, name FROM zenith_skill WHERE name = ?", (name,)).fetchone()
    if row is None:
        return None
    return ZenithSkill(id=row["id"], name=row["name"])


def list_zenith_skills(conn: sqlite3.Connection) -> list[ZenithSkill]:
    rows = conn.execute("SELECT id, name FROM zenith_skill ORDER BY id").fetchall()
    return [ZenithSkill(id=row["id"], name=row["name"]) for row in rows]


def list_zenith_skill_ids_used_by_equipment_cuffs_or_weapons(conn: sqlite3.Connection) -> set[int]:
    """Zenith skill ids actually reachable through an exported entity.

    `zenith_skill` can in principle carry ids no exported row ever grants
    (shouldn't happen today -- every family is reachable through at least one
    of equipment, cuffs, or weapons -- but kept defensive rather than assumed),
    so a naive `list_zenith_skills` export would risk including an
    unsatisfiable catalog entry.
    """
    rows = conn.execute(
        "SELECT zenith_skill_id FROM equipment WHERE zenith_skill_id IS NOT NULL "
        "UNION SELECT zenith_skill_id FROM cuff WHERE zenith_skill_id IS NOT NULL "
        "UNION SELECT zenith_skill_id FROM weapon WHERE zenith_skill_id IS NOT NULL"
    ).fetchall()
    return {row["zenith_skill_id"] for row in rows}


def list_zenith_skill_ids_used_by_weapons(conn: sqlite3.Connection) -> set[int]:
    """Zenith skill ids a weapon can carry -- see `export.py`'s
    `_export_weapon_zenith_skill_ids` (the weapon slot's include/exclude
    filter needs to know which Zenith skills are weapon-eligible at all)."""
    rows = conn.execute(
        "SELECT DISTINCT zenith_skill_id FROM weapon WHERE zenith_skill_id IS NOT NULL"
    ).fetchall()
    return {row["zenith_skill_id"] for row in rows}


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
    is_tower: bool = False,
    zenith_skill_id: int | None = None,
    category: str = "standard_plain",
    grank_or_later: bool = False,
    exotic_skill_id: int | None = None,
    hunter_type: HunterType = "common",
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
            slot_count_base, slot_count_max, min_hr, min_gr, is_tower,
            zenith_skill_id, category, grank_or_later, exotic_skill_id,
            hunter_type, source_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            is_tower,
            zenith_skill_id,
            category,
            grank_or_later,
            exotic_skill_id,
            hunter_type,
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
        is_tower=is_tower,
        zenith_skill_id=zenith_skill_id,
        category=category,
        grank_or_later=grank_or_later,
        exotic_skill_id=exotic_skill_id,
        hunter_type=hunter_type,
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
    is_tower: bool = False,
    category: str = "deco_standard",
    source_url: str | None = None,
) -> Decoration:
    cursor = conn.execute(
        """
        INSERT INTO decoration (external_id, name, slot_size, is_tower, category, source_url)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (external_id, name, slot_size, is_tower, category, source_url),
    )
    row_id = cursor.lastrowid
    assert row_id is not None
    return Decoration(
        id=row_id,
        external_id=external_id,
        name=name,
        slot_size=slot_size,
        is_tower=is_tower,
        category=category,
        source_url=source_url,
    )


def list_decorations(conn: sqlite3.Connection) -> list[Decoration]:
    rows = conn.execute("SELECT * FROM decoration ORDER BY id").fetchall()
    return [_decoration_from_row(row) for row in rows]


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
    zenith_skill_id: int | None = None,
    category: str = "cuff_standard_tier1",
    source_url: str | None = None,
) -> Cuff:
    cursor = conn.execute(
        """
        INSERT INTO cuff (external_id, name, slot_size, zenith_skill_id, category, source_url)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (external_id, name, slot_size, zenith_skill_id, category, source_url),
    )
    row_id = cursor.lastrowid
    assert row_id is not None
    return Cuff(
        id=row_id,
        external_id=external_id,
        name=name,
        slot_size=slot_size,
        zenith_skill_id=zenith_skill_id,
        category=category,
        source_url=source_url,
    )


def get_cuff_by_external_id(conn: sqlite3.Connection, external_id: str) -> Cuff | None:
    row = conn.execute("SELECT * FROM cuff WHERE external_id = ?", (external_id,)).fetchone()
    if row is None:
        return None
    return _cuff_from_row(row)


def list_cuffs(conn: sqlite3.Connection) -> list[Cuff]:
    rows = conn.execute("SELECT * FROM cuff ORDER BY id").fetchall()
    return [_cuff_from_row(row) for row in rows]


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


def insert_weapon(
    conn: sqlite3.Connection,
    *,
    external_id: str,
    name: str,
    weapon_type: WeaponType,
    rarity: int | None = None,
    slot_count: int = 0,
    rank_type: RankType | None = None,
    rank_value: int | None = None,
    is_tower: bool = False,
    zenith_skill_id: int | None = None,
    source_url: str | None = None,
) -> Weapon:
    cursor = conn.execute(
        """
        INSERT INTO weapon (
            external_id, name, weapon_type, rarity, slot_count,
            rank_type, rank_value, is_tower, zenith_skill_id, source_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            external_id,
            name,
            weapon_type,
            rarity,
            slot_count,
            rank_type,
            rank_value,
            is_tower,
            zenith_skill_id,
            source_url,
        ),
    )
    row_id = cursor.lastrowid
    assert row_id is not None
    return Weapon(
        id=row_id,
        external_id=external_id,
        name=name,
        weapon_type=weapon_type,
        rarity=rarity,
        slot_count=slot_count,
        rank_type=rank_type,
        rank_value=rank_value,
        is_tower=is_tower,
        zenith_skill_id=zenith_skill_id,
        source_url=source_url,
    )


def get_weapon_by_external_id(conn: sqlite3.Connection, external_id: str) -> Weapon | None:
    row = conn.execute("SELECT * FROM weapon WHERE external_id = ?", (external_id,)).fetchone()
    if row is None:
        return None
    return _weapon_from_row(row)


def _weapon_from_row(row: sqlite3.Row) -> Weapon:
    return Weapon(
        id=row["id"],
        external_id=row["external_id"],
        name=row["name"],
        weapon_type=row["weapon_type"],
        rarity=row["rarity"],
        slot_count=row["slot_count"],
        rank_type=row["rank_type"],
        rank_value=row["rank_value"],
        is_tower=bool(row["is_tower"]),
        zenith_skill_id=row["zenith_skill_id"],
        source_url=row["source_url"],
    )


def _decoration_from_row(row: sqlite3.Row) -> Decoration:
    return Decoration(
        id=row["id"],
        external_id=row["external_id"],
        name=row["name"],
        slot_size=row["slot_size"],
        is_tower=bool(row["is_tower"]),
        category=row["category"],
        source_url=row["source_url"],
    )


def _cuff_from_row(row: sqlite3.Row) -> Cuff:
    return Cuff(
        id=row["id"],
        external_id=row["external_id"],
        name=row["name"],
        slot_size=row["slot_size"],
        zenith_skill_id=row["zenith_skill_id"],
        category=row["category"],
        source_url=row["source_url"],
    )


def _skill_from_row(row: sqlite3.Row) -> Skill:
    return Skill(
        id=row["id"],
        name=row["name"],
        category=row["category"],
        priority_rank=row["priority_rank"],
    )


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
        is_tower=bool(row["is_tower"]),
        zenith_skill_id=row["zenith_skill_id"],
        category=row["category"],
        grank_or_later=bool(row["grank_or_later"]),
        exotic_skill_id=row["exotic_skill_id"],
        hunter_type=row["hunter_type"],
        source_url=row["source_url"],
    )


def _skill_points_from_row(row: sqlite3.Row) -> SkillPoints:
    return SkillPoints(
        skill=Skill(id=row["id"], name=row["name"], category=row["category"]),
        points=row["points"],
    )
