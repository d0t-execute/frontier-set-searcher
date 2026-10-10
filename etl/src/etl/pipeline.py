"""Wires fetch -> parse -> repository together to load the full dataset.

`main()` is the network-touching entry point, meant to be run manually
against the real site (docs/PLAN.md Phase 2 exit criteria — this never runs
in CI). `load_equipment()` itself takes already-fetched source text and talks
only to the repository layer, so it's fully unit-testable against fixtures.
"""

from __future__ import annotations

import argparse
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from etl.db.connection import connect
from etl.db.repository import (
    add_cuff_skill,
    add_decoration_skill,
    add_equipment_skill,
    insert_cuff,
    insert_decoration,
    insert_equipment,
    insert_skill,
)
from etl.fetch import CachingFetcher
from etl.parse.equipment import parse_equip_js
from etl.parse.skills import parse_skill_names

EQUIP_JS_URL = "https://xl3lackout.github.io/MHFZ-Ferias-English-Project/skill/equip.js"
SKILLFORM_JS_URL = "https://xl3lackout.github.io/MHFZ-Ferias-English-Project/skill/SkillForm.js"


@dataclass(frozen=True, slots=True)
class LoadSummary:
    equipment_count: int
    decoration_count: int
    cuff_count: int
    skill_count: int


def load_equipment(
    conn: sqlite3.Connection, *, skillform_source: str, equip_source: str, source_url: str
) -> LoadSummary:
    skill_names = parse_skill_names(skillform_source)
    parsed = parse_equip_js(equip_source)

    resolved_skills: dict[int, int] = {}

    def resolve_skill(skill_id: int) -> int:
        if skill_id not in resolved_skills:
            name = skill_names.get(skill_id, f"Unknown Skill {skill_id}")
            resolved_skills[skill_id] = insert_skill(conn, name=name).id
        return resolved_skills[skill_id]

    for row in parsed.equipment:
        equipment = insert_equipment(
            conn,
            external_id=row.external_id,
            name=row.name,
            slot_type=row.slot_type,
            rarity=row.rarity,
            defense_base=row.defense_base,
            defense_max=row.defense_max,
            slot_count_base=row.slot_count_base,
            slot_count_max=row.slot_count_max,
            min_hr=row.min_hr,
            source_url=source_url,
        )
        for skill_id, points in row.skills:
            add_equipment_skill(
                conn, equipment_id=equipment.id, skill_id=resolve_skill(skill_id), points=points
            )

    for deco_row in parsed.decorations:
        decoration = insert_decoration(
            conn,
            external_id=deco_row.external_id,
            name=deco_row.name,
            slot_size=deco_row.slot_size,
            source_url=source_url,
        )
        for skill_id, points in deco_row.skills:
            add_decoration_skill(
                conn, decoration_id=decoration.id, skill_id=resolve_skill(skill_id), points=points
            )

    for cuff_row in parsed.cuffs:
        cuff = insert_cuff(
            conn,
            external_id=cuff_row.external_id,
            name=cuff_row.name,
            slot_size=cuff_row.slot_size,
            source_url=source_url,
        )
        for skill_id, points in cuff_row.skills:
            add_cuff_skill(conn, cuff_id=cuff.id, skill_id=resolve_skill(skill_id), points=points)

    conn.commit()
    return LoadSummary(
        equipment_count=len(parsed.equipment),
        decoration_count=len(parsed.decorations),
        cuff_count=len(parsed.cuffs),
        skill_count=len(resolved_skills),
    )


def main() -> None:  # pragma: no cover -- network-touching, run manually only
    parser = argparse.ArgumentParser(description="Fetch and load the Frontier equipment dataset.")
    parser.add_argument("--db", type=Path, required=True, help="Path to the SQLite database file")
    parser.add_argument(
        "--cache-dir", type=Path, required=True, help="Directory to cache fetched files in"
    )
    args = parser.parse_args()

    conn = connect(args.db)
    try:
        with CachingFetcher(args.cache_dir) as fetcher:
            skillform_source = fetcher.fetch(SKILLFORM_JS_URL, cache_key="SkillForm").content
            equip_source = fetcher.fetch(EQUIP_JS_URL, cache_key="equip").content
        summary = load_equipment(
            conn,
            skillform_source=skillform_source,
            equip_source=equip_source,
            source_url=EQUIP_JS_URL,
        )
    finally:
        conn.close()

    print(
        f"Loaded {summary.equipment_count} equipment, "
        f"{summary.decoration_count} decorations, "
        f"{summary.cuff_count} cuffs, "
        f"{summary.skill_count} distinct skills."
    )


if __name__ == "__main__":
    main()
