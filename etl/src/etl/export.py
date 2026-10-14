"""Exports the ETL staging database into the static data bundle the frontend
loads (see docs/PLAN.md §4 "the only artifact that crosses from offline to
online" and Phase 4's "ETL -> static-bundle export step"). Plain JSON, one
file per piece type so the initial page load stays small, shaped to match the
search engine's own types directly (frontend/src/search-engine/types.ts) --
no further transformation should be needed on the frontend side beyond
parsing JSON.

Only the five skill-bearing armor slot types, plus decorations and cuffs, are
exported; weapons/charms/Zenith skills/Tower compatibility are out of scope
for this groundwork pass (see docs/PLAN.md Phase 3's "search engine spike"
scope and docs/data-format-notes.md's taxonomy notes for what's deferred).
The `Cuff` model carries a `zenith_skill_id`, but it isn't exported yet --
the Zenith skill pool is a separate, not-yet-modeled system (see the
skill-system-roadmap TODO), so exporting it now would be a dead field with
nothing downstream to consume it.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path
from typing import Any

from etl.db.connection import connect
from etl.db.models import EquipmentType
from etl.db.repository import (
    get_cuff_skills,
    get_decoration_skills,
    get_equipment_skills,
    get_skill_tiers,
    list_cuffs,
    list_decorations,
    list_equipment,
    list_skills,
)

EXPORT_FORMAT_VERSION = 1

ARMOR_SLOT_TYPES: tuple[EquipmentType, ...] = ("head", "chest", "arms", "waist", "legs")


def export_bundle(conn: sqlite3.Connection, output_dir: Path) -> None:
    """Write the full static bundle to `output_dir`, creating it if needed.

    Safe to re-run against the same directory -- every file is overwritten
    wholesale, never appended to or patched.
    """
    equipment_dir = output_dir / "equipment"
    equipment_dir.mkdir(parents=True, exist_ok=True)

    _write_json(output_dir / "skills.json", _export_skills(conn))
    _write_json(output_dir / "decorations.json", _export_decorations(conn))
    _write_json(output_dir / "cuffs.json", _export_cuffs(conn))
    for slot_type in ARMOR_SLOT_TYPES:
        _write_json(equipment_dir / f"{slot_type}.json", _export_equipment(conn, slot_type))
    _write_json(
        output_dir / "manifest.json",
        {"formatVersion": EXPORT_FORMAT_VERSION, "slotTypes": list(ARMOR_SLOT_TYPES)},
    )


def _export_skills(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    return [
        {
            "id": s.id,
            "name": s.name,
            "category": s.category,
            "tiers": [
                {"label": t.label, "minPoints": t.threshold, "description": t.description}
                for t in get_skill_tiers(conn, s.id)
            ],
        }
        for s in list_skills(conn)
    ]


def _export_decorations(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    return [
        {
            "id": decoration.external_id,
            "name": decoration.name,
            "slotSize": decoration.slot_size,
            "skills": _skills_payload(get_decoration_skills(conn, decoration.id)),
        }
        for decoration in list_decorations(conn)
    ]


def _export_cuffs(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    return [
        {
            "id": cuff.external_id,
            "name": cuff.name,
            "slotSize": cuff.slot_size,
            "skills": _skills_payload(get_cuff_skills(conn, cuff.id)),
            "category": cuff.category,
        }
        for cuff in list_cuffs(conn)
    ]


def _export_equipment(conn: sqlite3.Connection, slot_type: EquipmentType) -> list[dict[str, Any]]:
    return [
        {
            "id": equipment.external_id,
            "name": equipment.name,
            "skills": _skills_payload(get_equipment_skills(conn, equipment.id)),
            "openSlotCount": equipment.slot_count_max,
            "category": equipment.category,
        }
        for equipment in list_equipment(conn, slot_type=slot_type)
    ]


def _skills_payload(skill_points: list[Any]) -> list[dict[str, int]]:
    return [{"skillId": sp.skill.id, "points": sp.points} for sp in skill_points]


def _write_json(path: Path, data: object) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:  # pragma: no cover -- run manually only, see etl.pipeline.main
    parser = argparse.ArgumentParser(
        description="Export the ETL staging database to the static data bundle."
    )
    parser.add_argument("--db", type=Path, required=True, help="Path to the SQLite database file")
    parser.add_argument(
        "--out", type=Path, required=True, help="Directory to write the bundle into"
    )
    args = parser.parse_args()

    conn = connect(args.db)
    try:
        export_bundle(conn, args.out)
    finally:
        conn.close()
    print(f"Exported data bundle to {args.out}")


if __name__ == "__main__":
    main()
