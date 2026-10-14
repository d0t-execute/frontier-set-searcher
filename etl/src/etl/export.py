"""Exports the ETL staging database into the static data bundle the frontend
loads (see docs/PLAN.md §4 "the only artifact that crosses from offline to
online" and Phase 4's "ETL -> static-bundle export step"). Plain JSON, one
file per piece type so the initial page load stays small, shaped to match the
search engine's own types directly (frontend/src/search-engine/types.ts) --
no further transformation should be needed on the frontend side beyond
parsing JSON.

Only the five skill-bearing armor slot types, plus decorations and cuffs, are
exported; weapons/charms/Tower compatibility are out of scope for this
groundwork pass (see docs/PLAN.md Phase 3's "search engine spike" scope and
docs/data-format-notes.md's taxonomy notes for what's deferred).

Zenith skills (docs/data-format-notes.md's "Zenith skills" section) ride the
exact same `SkillContribution`/`SkillRequirement` machinery normal skills do
-- confirmed with the project owner that they stack additively exactly like
normal skills (e.g. two "Vampirism Up+1" pieces reach the same total as one
hypothetical "+2" piece), not a flat one-shot grant. `zenith-skills.json`
exports one entry per Zenith skill *family* (`_zenith_family` strips a raw
name's "+<N>" tier suffix, e.g. "Vampirism Up+2" -> family "Vampirism Up",
level 2; a name with no suffix, e.g. "Dissolver Up", is its own single-tier
family at level 1) with `tiers: []` -- deliberately empty, not a ladder of
discrete thresholds like normal skills have, since no single real item is
ever seen granting more than level 1 of a family (verified against the real
dataset: every `zenith_skill` row actually referenced by equipment/cuffs is
a "+1" or suffix-less name) and an empty tier list renders as a free-entry
number input in the UI (`SkillPicker.tsx`) rather than a constrained
dropdown -- appropriate since the real achievable total is open-ended,
bounded only by how many same-family pieces a build equips, not by anything
the data itself caps. The catalog is also filtered down to families actually
reachable through an exported equipment/cuff row
(`list_zenith_skill_ids_used_by_equipment_or_cuffs`) -- the raw `zenith_skill`
table also carries ids referenced only by `weapon` rows (weapons aren't
exported at all), and including those would add unsatisfiable requirements
to the UI. Each equipment/cuff row with a `zenith_skill_id` gets its Zenith
contribution appended directly into its ordinary `skills` array
(see `_zenith_contribution`), using `ZENITH_SKILL_ID_OFFSET` to keep every
Zenith family id clear of the normal skill id space (`skill.id` tops out in
the low hundreds) -- once offset, the search engine needs no changes at all
to support Zenith skill requirements; they're just more entries in the same
`skills: SkillContribution[]` list normal skills already use.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
from pathlib import Path
from typing import Any

from etl.db.connection import connect
from etl.db.models import EquipmentType, ZenithSkill
from etl.db.repository import (
    get_cuff_skills,
    get_decoration_skills,
    get_equipment_skills,
    get_skill_tiers,
    list_cuffs,
    list_decorations,
    list_equipment,
    list_skills,
    list_zenith_skill_ids_used_by_equipment_or_cuffs,
    list_zenith_skills,
)

EXPORT_FORMAT_VERSION = 1

ARMOR_SLOT_TYPES: tuple[EquipmentType, ...] = ("head", "chest", "arms", "waist", "legs")

ZENITH_SKILL_ID_OFFSET = 1_000_000

_ZENITH_TIER_SUFFIX = re.compile(r"^(.*)\+(\d+)$")


def _zenith_family(name: str) -> tuple[str, int]:
    match = _ZENITH_TIER_SUFFIX.match(name)
    if match:
        return match.group(1), int(match.group(2))
    return name, 1


class _ZenithIndex:
    """Precomputed per-raw-`ZenithSkill.id` lookups, built once per export run
    and shared by `_export_zenith_skills`/`_export_equipment`/`_export_cuffs`
    so every piece and the catalog agree on the exact same family groupings.
    """

    def __init__(self, zenith_skills: list[ZenithSkill]) -> None:
        self.exported_id: dict[int, int] = {}
        self.points: dict[int, int] = {}
        self.family_name: dict[int, str] = {}
        first_id_of_family: dict[str, int] = {}
        for zs in zenith_skills:
            family, level = _zenith_family(zs.name)
            first_id_of_family.setdefault(family, zs.id)
            self.exported_id[zs.id] = ZENITH_SKILL_ID_OFFSET + first_id_of_family[family]
            self.points[zs.id] = level
            self.family_name[zs.id] = family

    def contribution(self, zenith_skill_id: int | None) -> dict[str, int] | None:
        if zenith_skill_id is None:
            return None
        return {
            "skillId": self.exported_id[zenith_skill_id],
            "points": self.points[zenith_skill_id],
        }


def export_bundle(conn: sqlite3.Connection, output_dir: Path) -> None:
    """Write the full static bundle to `output_dir`, creating it if needed.

    Safe to re-run against the same directory -- every file is overwritten
    wholesale, never appended to or patched.
    """
    equipment_dir = output_dir / "equipment"
    equipment_dir.mkdir(parents=True, exist_ok=True)

    zenith_index = _ZenithIndex(list_zenith_skills(conn))
    used_zenith_ids = list_zenith_skill_ids_used_by_equipment_or_cuffs(conn)

    _write_json(output_dir / "skills.json", _export_skills(conn))
    _write_json(
        output_dir / "zenith-skills.json", _export_zenith_skills(zenith_index, used_zenith_ids)
    )
    _write_json(output_dir / "decorations.json", _export_decorations(conn))
    _write_json(output_dir / "cuffs.json", _export_cuffs(conn, zenith_index))
    for slot_type in ARMOR_SLOT_TYPES:
        _write_json(
            equipment_dir / f"{slot_type}.json", _export_equipment(conn, slot_type, zenith_index)
        )
    _write_json(
        output_dir / "manifest.json",
        {"formatVersion": EXPORT_FORMAT_VERSION, "slotTypes": list(ARMOR_SLOT_TYPES)},
    )


def _export_zenith_skills(zenith_index: _ZenithIndex, used_ids: set[int]) -> list[dict[str, Any]]:
    seen: dict[int, str] = {}
    for raw_id, family in zenith_index.family_name.items():
        if raw_id not in used_ids:
            continue
        seen.setdefault(zenith_index.exported_id[raw_id], family)
    return [
        {"id": skill_id, "name": name, "category": None, "tiers": []}
        for skill_id, name in sorted(seen.items())
    ]


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


def _export_cuffs(conn: sqlite3.Connection, zenith_index: _ZenithIndex) -> list[dict[str, Any]]:
    return [
        {
            "id": cuff.external_id,
            "name": cuff.name,
            "slotSize": cuff.slot_size,
            "skills": _skills_payload(
                get_cuff_skills(conn, cuff.id), zenith_index.contribution(cuff.zenith_skill_id)
            ),
            "category": cuff.category,
        }
        for cuff in list_cuffs(conn)
    ]


def _export_equipment(
    conn: sqlite3.Connection, slot_type: EquipmentType, zenith_index: _ZenithIndex
) -> list[dict[str, Any]]:
    return [
        {
            "id": equipment.external_id,
            "name": equipment.name,
            "skills": _skills_payload(
                get_equipment_skills(conn, equipment.id),
                zenith_index.contribution(equipment.zenith_skill_id),
            ),
            "openSlotCount": equipment.slot_count_max,
            "category": equipment.category,
        }
        for equipment in list_equipment(conn, slot_type=slot_type)
    ]


def _skills_payload(
    skill_points: list[Any], zenith_contribution: dict[str, int] | None = None
) -> list[dict[str, int]]:
    payload = [{"skillId": sp.skill.id, "points": sp.points} for sp in skill_points]
    if zenith_contribution is not None:
        payload.append(zenith_contribution)
    return payload


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
