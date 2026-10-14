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
    get_skill_by_name,
    insert_cuff,
    insert_decoration,
    insert_equipment,
    insert_skill,
    insert_skill_tier,
    insert_weapon,
    insert_zenith_skill,
    list_skills,
    set_skill_category,
)
from etl.fetch import CachingFetcher
from etl.parse.equipment import parse_equip_js
from etl.parse.skill_tiers import parse_skill_tier_table
from etl.parse.skills import parse_skill_names, parse_zenith_skill_names
from etl.parse.weapon import WEAPON_PAGE_TO_TYPE, parse_weapon_page

EQUIP_JS_URL = "https://xl3lackout.github.io/MHFZ-Ferias-English-Project/skill/equip.js"
SKILLFORM_JS_URL = "https://xl3lackout.github.io/MHFZ-Ferias-English-Project/skill/SkillForm.js"
WEAPON_BASE_URL = "https://xl3lackout.github.io/MHFZ-Ferias-English-Project/buki/"
SKILL_TIERS_URL = "https://mertna.github.io/MHFZ-Skills/tables/Base.html"


@dataclass(frozen=True, slots=True)
class LoadSummary:
    equipment_count: int
    decoration_count: int
    cuff_count: int
    skill_count: int
    zenith_skill_count: int


def load_equipment(
    conn: sqlite3.Connection, *, skillform_source: str, equip_source: str, source_url: str
) -> LoadSummary:
    skill_names = parse_skill_names(skillform_source)
    zenith_skill_names = parse_zenith_skill_names(skillform_source)
    parsed = parse_equip_js(equip_source)

    resolved_skills: dict[int, int] = {}
    resolved_zenith_skills: dict[int, int] = {}

    def resolve_skill(skill_id: int) -> int:
        if skill_id not in resolved_skills:
            name = skill_names.get(skill_id, f"Unknown Skill {skill_id}")
            resolved_skills[skill_id] = insert_skill(conn, name=name).id
        return resolved_skills[skill_id]

    def resolve_zenith_skill(zenith_skill_id: int) -> int:
        if zenith_skill_id not in resolved_zenith_skills:
            fallback = f"Unknown Zenith Skill {zenith_skill_id}"
            name = zenith_skill_names.get(zenith_skill_id, fallback)
            resolved_zenith_skills[zenith_skill_id] = insert_zenith_skill(conn, name=name).id
        return resolved_zenith_skills[zenith_skill_id]

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
            is_tower=row.is_tower,
            zenith_skill_id=(
                resolve_zenith_skill(row.zenith_skill_id)
                if row.zenith_skill_id is not None
                else None
            ),
            category=row.category,
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
            is_tower=deco_row.is_tower,
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
            zenith_skill_id=(
                resolve_zenith_skill(cuff_row.zenith_skill_id)
                if cuff_row.zenith_skill_id is not None
                else None
            ),
            category=cuff_row.category,
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
        zenith_skill_count=len(resolved_zenith_skills),
    )


@dataclass(frozen=True, slots=True)
class WeaponLoadSummary:
    weapon_count: int
    zenith_skill_count: int


def load_weapons(conn: sqlite3.Connection, *, page_sources: dict[str, str]) -> WeaponLoadSummary:
    """Load the base-tier weapon catalog (see docs/weapon-data-format-notes.md).

    Only the base tier is in scope -- the `_g`/`_s`/`_n` variant pages are
    different probabilistic/leveled crafting systems, deferred like the
    regular weapon Sigil catalog. `page_sources` maps a page key (e.g.
    "taiken") to its already-fetched HTML.
    """
    resolved_zenith_skills: dict[str, int] = {}

    def resolve_zenith_skill(name: str) -> int:
        if name not in resolved_zenith_skills:
            resolved_zenith_skills[name] = insert_zenith_skill(conn, name=name).id
        return resolved_zenith_skills[name]

    weapon_count = 0
    for page, html in page_sources.items():
        source_url = f"{WEAPON_BASE_URL}{page}.htm"
        for row in parse_weapon_page(page, html):
            insert_weapon(
                conn,
                external_id=row.external_id,
                name=row.name,
                weapon_type=row.weapon_type,
                rarity=row.rarity,
                slot_count=row.slot_count,
                rank_type=row.rank_type,
                rank_value=row.rank_value,
                is_tower=row.is_tower,
                zenith_skill_id=(
                    resolve_zenith_skill(row.zenith_skill_name)
                    if row.zenith_skill_name is not None
                    else None
                ),
                source_url=source_url,
            )
            weapon_count += 1

    conn.commit()
    return WeaponLoadSummary(
        weapon_count=weapon_count, zenith_skill_count=len(resolved_zenith_skills)
    )


# Known exact-name mismatches between the two independently fan-translated
# sites -- confirmed by running against the live tier site, not guessed:
# every entry here was one of its unmatched groups, and the game-knowledge
# correspondence is unambiguous (e.g. "DB Tech"/"DS Tech" are both "Dual
# Blades/Swords Technique", "Para"/"Paralysis" the same status skill).
# Maps a tier-site group name to the catalog's name for the same skill.
SKILL_TIER_NAME_ALIASES: dict[str, str] = {
    "Critical Conversion": "Crit Conversion",
    "Martial Arts": "Taijutsu",
    "Para": "Paralysis",
    "Hearing Res": "Hearing Protection",
    "Fishing": "Fish",
    "Gathering": "Gather",
    "DB Tech": "DS Tech",
    "SAF Tech": "Switch Axe tech",
}


@dataclass(frozen=True, slots=True)
class SkillTierLoadSummary:
    matched_group_count: int
    # Groups on the tier site with no same-named skill in our catalog, and
    # catalog skills with no matching group on the tier site -- surfaced
    # rather than silently dropped, since the two sites are independently
    # maintained fan translations and a name can legitimately drift between
    # them (e.g. the catalog's "DS Tech" vs. the tier site's "DB Tech").
    # Neither list implies the other skill doesn't exist; it just didn't get
    # tier data this run, and the UI falls back to a raw points input for it.
    unmatched_group_names: tuple[str, ...]
    unmatched_skill_names: tuple[str, ...]


def load_skill_tiers(conn: sqlite3.Connection, *, html: str) -> SkillTierLoadSummary:
    """Attach point-threshold tiers (and a display category) to skills
    already in the catalog, from a second source the primary one doesn't
    have (see docs/data-format-notes.md "Skill tiers" and
    `parse_skill_tiers`'s module docstring). Matches purely by exact skill
    name -- see `SkillTierLoadSummary` for why mismatches are reported
    rather than guessed at.

    Safe to re-run: an already-matched skill's tiers are replaced wholesale,
    not appended to, so re-running against a re-crawled page can't violate
    `skill_tier`'s (skill_id, tier_order) uniqueness constraint.
    """
    groups = parse_skill_tier_table(html)
    matched_names: set[str] = set()
    unmatched_group_names: list[str] = []

    for group in groups:
        catalog_name = SKILL_TIER_NAME_ALIASES.get(group.name, group.name)
        skill = get_skill_by_name(conn, catalog_name)
        if skill is None:
            unmatched_group_names.append(group.name)
            continue

        matched_names.add(skill.name)
        set_skill_category(conn, skill_id=skill.id, category=group.section)
        conn.execute("DELETE FROM skill_tier WHERE skill_id = ?", (skill.id,))
        for order, tier in enumerate(group.tiers):
            insert_skill_tier(
                conn,
                skill_id=skill.id,
                tier_order=order,
                label=tier.label,
                threshold=tier.threshold,
                description=tier.description,
            )

    all_skill_names = {skill.name for skill in list_skills(conn)}
    unmatched_skill_names = sorted(all_skill_names - matched_names)

    conn.commit()
    return SkillTierLoadSummary(
        matched_group_count=len(matched_names),
        unmatched_group_names=tuple(unmatched_group_names),
        unmatched_skill_names=tuple(unmatched_skill_names),
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
            weapon_page_sources = {
                page: fetcher.fetch(
                    f"{WEAPON_BASE_URL}{page}.htm", cache_key=f"buki_{page}"
                ).content
                for page in WEAPON_PAGE_TO_TYPE
            }
            skill_tiers_source = fetcher.fetch(
                SKILL_TIERS_URL, cache_key="skill_tiers_base"
            ).content
        summary = load_equipment(
            conn,
            skillform_source=skillform_source,
            equip_source=equip_source,
            source_url=EQUIP_JS_URL,
        )
        weapon_summary = load_weapons(conn, page_sources=weapon_page_sources)
        tier_summary = load_skill_tiers(conn, html=skill_tiers_source)
    finally:
        conn.close()

    print(
        f"Loaded {summary.equipment_count} equipment, "
        f"{summary.decoration_count} decorations, "
        f"{summary.cuff_count} cuffs, "
        f"{summary.skill_count} distinct skills, "
        f"{summary.zenith_skill_count} distinct Zenith skills, "
        f"{weapon_summary.weapon_count} weapons."
    )
    print(
        f"Attached tiers to {tier_summary.matched_group_count} skills. "
        f"{len(tier_summary.unmatched_group_names)} tier-site groups had no matching catalog "
        f"skill, {len(tier_summary.unmatched_skill_names)} catalog skills got no tier data."
    )
    if tier_summary.unmatched_group_names:
        print(f"  Unmatched tier-site groups: {', '.join(tier_summary.unmatched_group_names)}")
    if tier_summary.unmatched_skill_names:
        print(f"  Catalog skills with no tiers: {', '.join(tier_summary.unmatched_skill_names)}")


if __name__ == "__main__":
    main()
