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
    set_skill_priority_rank,
)
from etl.fetch import CachingFetcher
from etl.parse.equipment import parse_equip_js
from etl.parse.skill_priority import parse_skill_priority_table
from etl.parse.skill_tiers import ParsedSkillGroup, ParsedSkillTier, parse_skill_tier_table
from etl.parse.skills import parse_skill_names, parse_zenith_skill_names
from etl.parse.weapon import WEAPON_PAGE_TO_TYPE, parse_weapon_page

# The weapon pages (buki/*.htm) print each Zenith-infused weapon's skill as
# its own abbreviated label, independent of the TENINAME-driven naming
# equip.js/SkillForm.js use for equipment/cuffs (see pipeline.py's
# `resolve_zenith_skill` in `load_equipment`) -- confirmed against the raw
# cached weapon pages (e.g. "Zenith Skill：Earplugs Up+1" in buki_taiken.body)
# and cross-checked against the exact same abbreviation already appearing in
# real cuff names for the same family (e.g. "Earplugs Up SZ" is one of
# "Hearing Protection Up+1"'s own cuffs). Without this, `load_weapons` would
# insert a second, duplicate `zenith_skill` row for the same real effect
# instead of reusing the family's one true id. Maps a weapon page's label to
# the catalog's canonical name for the same Zenith skill family.
ZENITH_SKILL_WEAPON_NAME_ALIASES: dict[str, str] = {
    "Earplugs Up+1": "Hearing Protection Up+1",
    "S. Assault Up+1": "Stylish Assault Up+1",
    "C. Conversion Up+1": "Crit Conversion Up+1",
}

# "Exotic" equipment (CLASS "O") grants a fixed bonus to one normal skill
# just by being equipped, in addition to its own listed skills -- see
# etl/src/etl/parse/equipment.py's `_extract_exotic_skill_marker` and
# docs/data-format-notes.md "Exotic armor". Maps a raw marker string (the
# text already embedded in the item's own flavor text, e.g. "Ice Attack
# 【Large】") to the catalog skill name/points it resolves to. Confirmed
# against the real dataset: every one of these 17 distinct markers is the
# full real set (etl/.data/cache/equip.body, 688/688 CLASS "O" rows), and
# each (skill name, points) pair was cross-checked against that skill's own
# tier-threshold data already in skills.json (e.g. "Ice Attack 【Large】" is
# the "Ice Attack" skill's "Ice Attack (Large)" tier, 20 points). Resolved as
# a fixed dict rather than dynamically against `skill_tier` at load time,
# since tier data isn't loaded until *after* `load_equipment` runs (see
# `load_skill_tiers`, called later in `main()`) -- same reasoning as
# `ZENITH_SKILL_WEAPON_NAME_ALIASES` above for why this can't just be a
# runtime lookup against data this function doesn't have yet.
EXOTIC_ARMOR_SKILL_GRANTS: dict[str, tuple[str, int]] = {
    "Bomber": ("Bomb Boost", 10),
    "Critical Eye +5": ("Expert", 50),
    "Dragon Attack 【Large】": ("Dragon Attack", 20),
    "Evade+2": ("Evasion", 20),
    "Focus+2": ("Focus", 20),
    "Great Luck": ("Fate", 20),
    "Guard+2": ("Guard", 20),
    "Ice Attack 【Large】": ("Ice Attack", 20),
    "Maximum Bullets": ("Ammo Combiner", 10),
    "Pierce/Pierce Up": ("Pierce Shot Up", 10),
    "S. Immunity (Myriad)": ("Status Res", 30),
    "Sharpening Artisan": ("Sharpening", 20),
    "Starving Wolf+2": ("Fasting", 20),
    "Status Attack Up": ("Status Attack", 10),
    "Thunder Attack 【Large】": ("Thunder Attack", 20),
    "Water Attack 【Large】": ("Water Attack", 20),
    "Wide-Area+3": ("Wide-Area", 30),
}

EQUIP_JS_URL = "https://xl3lackout.github.io/MHFZ-Ferias-English-Project/skill/equip.js"
SKILLFORM_JS_URL = "https://xl3lackout.github.io/MHFZ-Ferias-English-Project/skill/SkillForm.js"
WEAPON_BASE_URL = "https://xl3lackout.github.io/MHFZ-Ferias-English-Project/buki/"
SKILL_TIERS_URL = "https://mertna.github.io/MHFZ-Skills/tables/Base.html"
SKILL_PRIORITY_URL = "https://mertna.github.io/MHFZ-Skills/tables/Priority.html"


@dataclass(frozen=True, slots=True)
class LoadSummary:
    equipment_count: int
    decoration_count: int
    cuff_count: int
    skill_count: int
    zenith_skill_count: int
    # How many Exotic equipment rows got their bonus skill grant applied, and
    # any raw marker text seen that `EXOTIC_ARMOR_SKILL_GRANTS` doesn't cover
    # (surfaced rather than silently dropped, same "report, don't guess"
    # convention as SkillTierLoadSummary/SkillPriorityLoadSummary -- a future
    # re-scrape could expose a new Exotic monster family this dict hasn't
    # been taught about yet).
    exotic_grant_count: int
    unmatched_exotic_markers: tuple[str, ...]


def load_equipment(
    conn: sqlite3.Connection, *, skillform_source: str, equip_source: str, source_url: str
) -> LoadSummary:
    skill_names = parse_skill_names(skillform_source)
    zenith_skill_names = parse_zenith_skill_names(skillform_source)
    parsed = parse_equip_js(equip_source)

    resolved_skills: dict[int, int] = {}
    resolved_zenith_skills: dict[int, int] = {}
    resolved_exotic_skills: dict[str, int] = {}
    unmatched_exotic_markers: set[str] = set()
    exotic_grant_count = 0

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

    def resolve_exotic_grant(marker: str) -> tuple[int, int] | None:
        mapping = EXOTIC_ARMOR_SKILL_GRANTS.get(marker)
        if mapping is None:
            unmatched_exotic_markers.add(marker)
            return None
        name, points = mapping
        if name not in resolved_exotic_skills:
            resolved_exotic_skills[name] = insert_skill(conn, name=name).id
        return resolved_exotic_skills[name], points

    for row in parsed.equipment:
        exotic_grant = (
            resolve_exotic_grant(row.exotic_skill_marker)
            if row.exotic_skill_marker is not None
            else None
        )
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
            resistance_fire=row.resistance_fire,
            resistance_water=row.resistance_water,
            resistance_thunder=row.resistance_thunder,
            resistance_dragon=row.resistance_dragon,
            resistance_ice=row.resistance_ice,
            min_hr=row.min_hr,
            is_tower=row.is_tower,
            zenith_skill_id=(
                resolve_zenith_skill(row.zenith_skill_id)
                if row.zenith_skill_id is not None
                else None
            ),
            category=row.category,
            grank_or_later=row.grank_or_later,
            exotic_skill_id=exotic_grant[0] if exotic_grant is not None else None,
            hunter_type=row.hunter_type,
            source_url=source_url,
        )
        # Summed into one dict (keyed by the already-resolved skill id) rather
        # than inserted straight off `row.skills` -- an Exotic grant lands on
        # the same (equipment_id, skill_id) primary key as a piece's own
        # listed skills whenever they happen to coincide, which would
        # otherwise violate it (same reasoning `_extract_skills` already
        # documents for duplicate SN/SP slots within one row).
        skill_totals: dict[int, int] = {}
        for skill_id, points in row.skills:
            resolved_id = resolve_skill(skill_id)
            skill_totals[resolved_id] = skill_totals.get(resolved_id, 0) + points
        if exotic_grant is not None:
            exotic_skill_id, exotic_points = exotic_grant
            skill_totals[exotic_skill_id] = skill_totals.get(exotic_skill_id, 0) + exotic_points
            exotic_grant_count += 1
        for skill_id, points in skill_totals.items():
            add_equipment_skill(conn, equipment_id=equipment.id, skill_id=skill_id, points=points)

    for deco_row in parsed.decorations:
        decoration = insert_decoration(
            conn,
            external_id=deco_row.external_id,
            name=deco_row.name,
            slot_size=deco_row.slot_size,
            is_tower=deco_row.is_tower,
            category=deco_row.category,
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
        exotic_grant_count=exotic_grant_count,
        unmatched_exotic_markers=tuple(sorted(unmatched_exotic_markers)),
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
        name = ZENITH_SKILL_WEAPON_NAME_ALIASES.get(name, name)
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
    # Priority-page-only casing/abbreviation variants (Base.html and
    # Priority.html are independently maintained and don't always agree).
    "SAF tech": "Switch Axe tech",
    "P. Breakthrough": "Point Breakthrough",
}


# Known parser gap, not a name mismatch like `SKILL_TIER_NAME_ALIASES` above:
# the tier site renders every one of "Adrenaline"'s rows (including its
# un-tiered baseline) as a <br>-separated pair of alternative values (e.g.
# "15<br>∥<br>20"), which `parse_skill_tier_table` deliberately refuses to
# pick between (see its own module docstring) -- so the group comes back with
# no tiers at all. Filled in by hand from the project owner's own knowledge of
# the skill instead of guessing at the ambiguous pair (2026-10-16).
MANUAL_SKILL_TIER_OVERRIDES: dict[str, tuple[ParsedSkillTier, ...]] = {
    "Adrenaline": (
        ParsedSkillTier(label="Adrenaline+2", threshold=15, description=""),
        ParsedSkillTier(label="Adrenaline+1", threshold=10, description=""),
        ParsedSkillTier(label="Worry", threshold=-15, description=""),
    ),
}


def _apply_skill_tier_override(group: ParsedSkillGroup) -> ParsedSkillGroup:
    override = MANUAL_SKILL_TIER_OVERRIDES.get(group.name)
    if override is None:
        return group
    return ParsedSkillGroup(name=group.name, section=group.section, tiers=override)


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
    groups = [_apply_skill_tier_override(g) for g in parse_skill_tier_table(html)]
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


@dataclass(frozen=True, slots=True)
class SkillPriorityLoadSummary:
    matched_rank_count: int
    # Same "report, don't guess" shape as SkillTierLoadSummary -- a priority-
    # page entry with no matching catalog skill, and a catalog skill the
    # priority page never ranked, are each surfaced rather than silently
    # dropped (the fan-translated source can legitimately drift from the
    # catalog's own naming, same as the tier site does -- see
    # SKILL_TIER_NAME_ALIASES, reused here since it's the exact same site).
    unmatched_entry_names: tuple[str, ...]
    unmatched_skill_names: tuple[str, ...]


def load_skill_priority(conn: sqlite3.Connection, *, html: str) -> SkillPriorityLoadSummary:
    """Attach each normal skill's activation-priority rank (see
    `parse_skill_priority_table`'s module docstring and
    docs/skill-system-roadmap.md TODO #1) from a third source, independent of
    `skill_tier`'s own tier-threshold source -- matches purely by exact name
    (aliased the same way `load_skill_tiers` is, since both sources are the
    same mertna.github.io site).

    Safe to re-run: `priority_rank` is overwritten per matched skill, not
    accumulated.
    """
    entries = parse_skill_priority_table(html)
    matched_names: set[str] = set()
    unmatched_entry_names: list[str] = []

    for entry in entries:
        catalog_name = SKILL_TIER_NAME_ALIASES.get(entry.name, entry.name)
        skill = get_skill_by_name(conn, catalog_name)
        if skill is None:
            unmatched_entry_names.append(entry.name)
            continue

        matched_names.add(skill.name)
        set_skill_priority_rank(conn, skill_id=skill.id, rank=entry.rank)

    all_skill_names = {skill.name for skill in list_skills(conn)}
    unmatched_skill_names = sorted(all_skill_names - matched_names)

    conn.commit()
    return SkillPriorityLoadSummary(
        matched_rank_count=len(matched_names),
        unmatched_entry_names=tuple(unmatched_entry_names),
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
            skill_priority_source = fetcher.fetch(
                SKILL_PRIORITY_URL, cache_key="skill_priority"
            ).content
        summary = load_equipment(
            conn,
            skillform_source=skillform_source,
            equip_source=equip_source,
            source_url=EQUIP_JS_URL,
        )
        weapon_summary = load_weapons(conn, page_sources=weapon_page_sources)
        tier_summary = load_skill_tiers(conn, html=skill_tiers_source)
        priority_summary = load_skill_priority(conn, html=skill_priority_source)
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
    print(f"Applied {summary.exotic_grant_count} Exotic-armor bonus-skill grants.")
    if summary.unmatched_exotic_markers:
        print(
            "  Unmatched Exotic Armor markers (EXOTIC_ARMOR_SKILL_GRANTS needs a new entry): "
            f"{', '.join(summary.unmatched_exotic_markers)}"
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
    print(
        f"Attached priority ranks to {priority_summary.matched_rank_count} skills. "
        f"{len(priority_summary.unmatched_entry_names)} priority-page entries had no matching "
        f"catalog skill, {len(priority_summary.unmatched_skill_names)} catalog skills got no rank."
    )
    if priority_summary.unmatched_entry_names:
        print(
            f"  Unmatched priority-page entries: "
            f"{', '.join(priority_summary.unmatched_entry_names)}"
        )
    if priority_summary.unmatched_skill_names:
        print(f"  Catalog skills with no rank: {', '.join(priority_summary.unmatched_skill_names)}")


if __name__ == "__main__":
    main()
