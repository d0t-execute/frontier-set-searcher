"""Exports the ETL staging database into the static data bundle the frontend
loads (see docs/PLAN.md §4 "the only artifact that crosses from offline to
online" and Phase 4's "ETL -> static-bundle export step"). Plain JSON, one
file per piece type so the initial page load stays small, shaped to match the
search engine's own types directly (frontend/src/search-engine/types.ts) --
no further transformation should be needed on the frontend side beyond
parsing JSON.

Only the five skill-bearing armor slot types, plus decorations and cuffs, are
exported as full candidate catalogs; weapons/charms/Tower compatibility stay
out of scope for that (see docs/PLAN.md Phase 3's "search engine spike" scope
and docs/data-format-notes.md's taxonomy notes for what's deferred). A
weapon's *identity* (name, rarity, base stats) never matters to this tool --
confirmed by the project owner, see `etl/src/etl/db/schema.sql`'s comment on
the `weapon` table -- only which Zenith skill (if any) it can carry, since the
frontend models the weapon slot as a virtual, nameless choice (any allowed
Zenith skill, or none) rather than picking a specific real weapon. So instead
of a full `weapons.json` candidate list, `weapon-zenith-skills.json` exports
just the *set* of Zenith skill ids a weapon can carry, for the UI's
include/exclude filter -- see `_export_weapon_zenith_skill_ids`.

Zenith skills (docs/data-format-notes.md's "Zenith skills" section) ride the
exact same `SkillContribution`/`SkillRequirement` machinery normal skills do
-- confirmed with the project owner that they stack additively exactly like
normal skills (e.g. two "Vampirism Up+1" pieces reach the same total as one
hypothetical "+2" piece), not a flat one-shot grant. `zenith-skills.json`
exports one entry per Zenith skill *family* (`_zenith_family` strips a raw
name's "+<N>" tier suffix, e.g. "Vampirism Up+2" -> family "Vampirism Up",
level 2; a name with no suffix, e.g. "Dissolver Up", is its own single-tier
family at level 1). Every real equipment/cuff row only ever grants level 1 of
a family (verified against the real dataset) -- reaching a family's higher
levels means equipping multiple level-1 pieces, so the scraped game data
itself has no record of each family's *maximum* stackable level. That cap is
real game-mechanic knowledge (each level is a discrete, designed buff to a
specific normal skill, e.g. "Guard Up+2" being a stronger upgrade than "+1",
not an unbounded grind) that only exists in community references, so
`ZENITH_SKILL_MAX_LEVEL` hardcodes it from
https://mertna.github.io/MHFZ-Skills/?skills=Zenith. `tiers` is built from
that cap (`[1, 2, ..., max]`, descending, same convention `get_skill_tiers`
already uses for normal skills) so the UI (`SkillPicker.tsx`) renders the
same bounded-dropdown picker it uses for any normal skill with known tiers,
instead of a free-entry number input that would let a build "require" a level
no family can ever reach. The catalog is also filtered down to families
actually reachable through an exported equipment/cuff row or the virtual
weapon slot (`list_zenith_skill_ids_used_by_equipment_cuffs_or_weapons`), so a
stray `zenith_skill` row nothing can actually grant never adds an
unsatisfiable requirement to the UI. Each equipment/cuff row with a
`zenith_skill_id` gets its Zenith contribution appended directly into its
ordinary `skills` array
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
    list_zenith_skill_ids_used_by_equipment_cuffs_or_weapons,
    list_zenith_skill_ids_used_by_weapons,
    list_zenith_skills,
)

EXPORT_FORMAT_VERSION = 1

ARMOR_SLOT_TYPES: tuple[EquipmentType, ...] = ("head", "chest", "arms", "waist", "legs")

ZENITH_SKILL_ID_OFFSET = 1_000_000

# Per-family maximum stackable level, sourced from the community skill
# reference at https://mertna.github.io/MHFZ-Skills/?skills=Zenith -- there is
# no equivalent cap anywhere in the scraped game data itself (see the module
# docstring). Keyed by the family name exactly as `_zenith_family` produces it
# from this project's own `zenith_skill.name` values, which in a few cases
# differs cosmetically from the reference site's own wording (e.g. this
# project's "Crit Conversion Up" is the site's "Critical Conversion Up", and
# "Para Res Up" is "Paralysis Res Up"). A family absent here (shouldn't happen
# for any family actually reachable through equipment/cuffs, but kept
# defensive) is treated as single-level.
ZENITH_SKILL_MAX_LEVEL: dict[str, int] = {
    "Adaptation Up": 2,
    "Assistance Up": 1,
    "Bullet Saver Up": 2,
    "Ceaseless Up": 1,
    "Crit Conversion Up": 2,
    "Dissolver Up": 1,
    "Drug Knowledge Up": 1,
    "Encourage Up": 2,
    "Guard Up": 2,
    "Hearing Protection Up": 3,
    "Ice Age Up": 1,
    "Obscurity Up": 1,
    "Para Res Up": 2,
    "Poison Res Up": 2,
    "Quake Res Up": 2,
    "Reflect Up": 3,
    "Rush Up": 1,
    "Skill Slots Up": 7,
    "Sleep Res Up": 2,
    "Soul Up": 1,
    "Stylish Assault Up": 2,
    "Stylish Up": 1,
    "Thunder Clad Up": 2,
    "Vampirism Up": 1,
    "Vigorous Up": 1,
    "Wind Res Up": 4,
}

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
    used_zenith_ids = list_zenith_skill_ids_used_by_equipment_cuffs_or_weapons(conn)
    weapon_zenith_ids = list_zenith_skill_ids_used_by_weapons(conn)

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
        output_dir / "weapon-zenith-skills.json",
        _export_weapon_zenith_skill_ids(zenith_index, weapon_zenith_ids),
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
        {
            "id": skill_id,
            "name": name,
            "category": None,
            "tiers": [
                {"label": f"+{level}", "minPoints": level, "description": None}
                for level in range(ZENITH_SKILL_MAX_LEVEL.get(name, 1), 0, -1)
            ],
        }
        for skill_id, name in sorted(seen.items())
    ]


def _export_weapon_zenith_skill_ids(
    zenith_index: _ZenithIndex, weapon_zenith_ids: set[int]
) -> list[int]:
    """The exported (family-level) Zenith skill ids a weapon can carry --
    see this module's own docstring. Deduplicated and sorted since multiple
    raw per-tier `zenith_skill` rows can map to the same exported family id
    (see `_ZenithIndex`), though in practice every weapon-carried skill is
    already its family's own level-1 id.
    """
    return sorted({zenith_index.exported_id[raw_id] for raw_id in weapon_zenith_ids})


def _export_skills(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    return [
        {
            "id": s.id,
            "name": s.name,
            "category": s.category,
            "priorityRank": s.priority_rank,
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
            # Tower Gems are strictly exclusive with regular decorations in
            # both directions (docs/data-format-notes.md's "Decorations"
            # section) -- not yet enforced per-slot by the search engine, but
            # this flag at least lets it exclude Tower Gems from the general
            # pool outright (see frontend's build-query.ts).
            "isTower": decoration.is_tower,
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
            "grankOrLater": equipment.grank_or_later,
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
