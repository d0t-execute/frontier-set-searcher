import json
import sqlite3
from pathlib import Path
from typing import Any

from etl.db import repository as repo
from etl.db.connection import connect
from etl.export import (
    EXPORT_FORMAT_VERSION,
    ZENITH_SKILL_ID_OFFSET,
    ZENITH_SKILL_MAX_LEVEL,
    export_bundle,
)


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
        defense_max=10,
        resistance_fire=4,
        resistance_water=-1,
        resistance_thunder=0,
        resistance_dragon=2,
        resistance_ice=3,
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
            "category": "standard_plain",
            "grankOrLater": False,
            "exoticSkillId": None,
            "hunterType": "common",
            "defenseMax": 10,
            "resistances": {"fire": 4, "water": -1, "thunder": 0, "ice": 3, "dragon": 2},
        }
    ]


def test_exports_a_grank_or_later_pieces_flag(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    repo.insert_equipment(
        conn,
        external_id="head:0002",
        name="Zinogre Helm",
        slot_type="head",
        category="grank_exotic",
        grank_or_later=True,
    )
    conn.commit()
    out_dir = tmp_path / "bundle"

    export_bundle(conn, out_dir)

    heads = _load(out_dir / "equipment" / "head.json")
    assert heads[0]["grankOrLater"] is True


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
            "isTower": False,
            "category": "deco_standard",
        }
    ]


def test_exports_a_tower_decoration_flag(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    repo.insert_decoration(
        conn, external_id="D002", name="Vampirism Gem II", slot_size=2, is_tower=True
    )
    conn.commit()
    out_dir = tmp_path / "bundle"

    export_bundle(conn, out_dir)

    decorations = _load(out_dir / "decorations.json")
    assert decorations[0]["isTower"] is True


def test_exports_cuffs_shaped_for_the_search_engine(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    sharpness = repo.insert_skill(conn, name="Sharpness")
    cuff = repo.insert_cuff(
        conn,
        external_id="cuff:C001",
        name="Sharpening PC1",
        slot_size=1,
        category="cuff_standard_tier1",
    )
    repo.add_cuff_skill(conn, cuff_id=cuff.id, skill_id=sharpness.id, points=2)
    conn.commit()
    out_dir = tmp_path / "bundle"

    export_bundle(conn, out_dir)

    assert _load(out_dir / "cuffs.json") == [
        {
            "id": "cuff:C001",
            "name": "Sharpening PC1",
            "slotSize": 1,
            "skills": [{"skillId": sharpness.id, "points": 2}],
            "category": "cuff_standard_tier1",
        }
    ]


def test_exports_a_zenith_only_cuffs_zenith_skill_as_an_ordinary_skill_contribution(
    tmp_path: Path,
) -> None:
    conn = _conn(tmp_path)
    zenith_skill = repo.insert_zenith_skill(conn, name="Skill Slots Up+1")
    repo.insert_cuff(
        conn,
        external_id="cuff:C002",
        name="Skill Slots Up SZ",
        slot_size=2,
        zenith_skill_id=zenith_skill.id,
        category="cuff_standard_zenith",
    )
    conn.commit()
    out_dir = tmp_path / "bundle"

    export_bundle(conn, out_dir)

    cuffs = _load(out_dir / "cuffs.json")
    assert cuffs == [
        {
            "id": "cuff:C002",
            "name": "Skill Slots Up SZ",
            "slotSize": 2,
            "skills": [{"skillId": ZENITH_SKILL_ID_OFFSET + zenith_skill.id, "points": 1}],
            "category": "cuff_standard_zenith",
        }
    ]


def test_exports_an_armor_pieces_zenith_skill_alongside_its_normal_skills(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    attack = repo.insert_skill(conn, name="Attack Up (Small)")
    zenith_skill = repo.insert_zenith_skill(conn, name="Vampirism Up+1")
    equipment = repo.insert_equipment(
        conn,
        external_id="head:0002",
        name="Zenith Helm",
        slot_type="head",
        slot_count_base=0,
        slot_count_max=0,
        zenith_skill_id=zenith_skill.id,
    )
    repo.add_equipment_skill(conn, equipment_id=equipment.id, skill_id=attack.id, points=3)
    conn.commit()
    out_dir = tmp_path / "bundle"

    export_bundle(conn, out_dir)

    heads = _load(out_dir / "equipment" / "head.json")
    assert heads[0]["skills"] == [
        {"skillId": attack.id, "points": 3},
        {"skillId": ZENITH_SKILL_ID_OFFSET + zenith_skill.id, "points": 1},
    ]


def test_zenith_skills_json_groups_same_family_names_under_one_shared_id(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    tier1 = repo.insert_zenith_skill(conn, name="Vampirism Up+1")
    tier2 = repo.insert_zenith_skill(conn, name="Vampirism Up+2")
    single = repo.insert_zenith_skill(conn, name="Dissolver Up")
    # Only pieces that actually grant these (see
    # list_zenith_skill_ids_used_by_equipment_or_cuffs) are eligible to appear
    # in the exported catalog at all.
    repo.insert_cuff(
        conn, external_id="cuff:C101", name="Vampirism SZ", slot_size=0, zenith_skill_id=tier1.id
    )
    repo.insert_cuff(
        conn, external_id="cuff:C102", name="Vampirism SZ2", slot_size=0, zenith_skill_id=tier2.id
    )
    repo.insert_cuff(
        conn, external_id="cuff:C103", name="Dissolver SZ", slot_size=0, zenith_skill_id=single.id
    )
    conn.commit()
    out_dir = tmp_path / "bundle"

    export_bundle(conn, out_dir)

    zenith_skills = _load(out_dir / "zenith-skills.json")
    assert zenith_skills == [
        {
            "id": ZENITH_SKILL_ID_OFFSET + tier1.id,
            "name": "Vampirism Up",
            "category": None,
            # "Vampirism Up" is single-level per ZENITH_SKILL_MAX_LEVEL --
            # the synthetic "Vampirism Up+2" row (tier2) in this test only
            # proves family grouping, not that the family itself has two
            # real levels.
            "tiers": [{"label": "+1", "minPoints": 1, "description": None}],
        },
        {
            "id": ZENITH_SKILL_ID_OFFSET + single.id,
            "name": "Dissolver Up",
            "category": None,
            "tiers": [{"label": "+1", "minPoints": 1, "description": None}],
        },
    ]
    # "Vampirism Up+2" (tier2) shares its family's id with "Vampirism Up+1"
    # rather than appearing as a second catalog entry -- the exact-length,
    # exact-content assertion above already proves this.
    assert tier2.id != tier1.id


def test_zenith_skills_json_builds_a_descending_tier_ladder_for_a_multi_level_family(
    tmp_path: Path,
) -> None:
    conn = _conn(tmp_path)
    guard_up = repo.insert_zenith_skill(conn, name="Guard Up+1")
    repo.insert_cuff(
        conn, external_id="cuff:C104", name="Guard SZ", slot_size=0, zenith_skill_id=guard_up.id
    )
    conn.commit()
    out_dir = tmp_path / "bundle"

    export_bundle(conn, out_dir)

    assert ZENITH_SKILL_MAX_LEVEL["Guard Up"] == 2
    assert _load(out_dir / "zenith-skills.json") == [
        {
            "id": ZENITH_SKILL_ID_OFFSET + guard_up.id,
            "name": "Guard Up",
            "category": None,
            "tiers": [
                {"label": "+2", "minPoints": 2, "description": None},
                {"label": "+1", "minPoints": 1, "description": None},
            ],
        }
    ]


def test_zenith_skills_json_includes_families_only_referenced_by_weapons(tmp_path: Path) -> None:
    # Weapons aren't exported as a full candidate catalog (see export.py's
    # module docstring), but a Zenith skill only a weapon grants is still a
    # satisfiable requirement through the virtual weapon slot -- so it must
    # still appear in the catalog, unlike a genuinely unreferenced row.
    conn = _conn(tmp_path)
    weapon_only = repo.insert_zenith_skill(conn, name="Earplugs Up+1")
    repo.insert_weapon(
        conn,
        external_id="weapon:W001",
        name="Some Great Sword",
        weapon_type="great_sword",
        zenith_skill_id=weapon_only.id,
    )
    conn.commit()
    out_dir = tmp_path / "bundle"

    export_bundle(conn, out_dir)

    zenith_skills = _load(out_dir / "zenith-skills.json")
    assert zenith_skills == [
        {
            "id": ZENITH_SKILL_ID_OFFSET + weapon_only.id,
            "name": "Earplugs Up",
            "category": None,
            "tiers": [{"label": "+1", "minPoints": 1, "description": None}],
        }
    ]


def test_weapon_zenith_skills_json_lists_the_exported_family_ids_weapons_can_carry(
    tmp_path: Path,
) -> None:
    conn = _conn(tmp_path)
    # Also granted by a cuff -- proves the weapon-zenith-skills list uses the
    # same exported family id as everything else, not a separate numbering.
    vampirism = repo.insert_zenith_skill(conn, name="Vampirism Up+1")
    repo.insert_cuff(
        conn,
        external_id="cuff:C201",
        name="Vampirism SZ",
        slot_size=0,
        zenith_skill_id=vampirism.id,
    )
    weapon_only = repo.insert_zenith_skill(conn, name="Earplugs Up+1")
    repo.insert_weapon(
        conn,
        external_id="weapon:W002",
        name="Some Great Sword",
        weapon_type="great_sword",
        zenith_skill_id=vampirism.id,
    )
    repo.insert_weapon(
        conn,
        external_id="weapon:W003",
        name="Another Great Sword",
        weapon_type="great_sword",
        zenith_skill_id=weapon_only.id,
    )
    conn.commit()
    out_dir = tmp_path / "bundle"

    export_bundle(conn, out_dir)

    assert _load(out_dir / "weapon-zenith-skills.json") == sorted(
        [ZENITH_SKILL_ID_OFFSET + vampirism.id, ZENITH_SKILL_ID_OFFSET + weapon_only.id]
    )


def test_writes_an_empty_weapon_zenith_skills_file_when_no_weapon_grants_one(
    tmp_path: Path,
) -> None:
    conn = _conn(tmp_path)
    out_dir = tmp_path / "bundle"

    export_bundle(conn, out_dir)

    assert _load(out_dir / "weapon-zenith-skills.json") == []


def test_writes_an_empty_zenith_skills_file_when_there_are_none(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    out_dir = tmp_path / "bundle"

    export_bundle(conn, out_dir)

    assert _load(out_dir / "zenith-skills.json") == []


def test_writes_an_empty_cuffs_file_when_there_are_none(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    out_dir = tmp_path / "bundle"

    export_bundle(conn, out_dir)

    assert _load(out_dir / "cuffs.json") == []


def test_exports_a_skill_lookup_table(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    attack = repo.insert_skill(conn, name="Attack Up (Small)", category="offense")
    conn.commit()
    out_dir = tmp_path / "bundle"

    export_bundle(conn, out_dir)

    assert _load(out_dir / "skills.json") == [
        {
            "id": attack.id,
            "name": "Attack Up (Small)",
            "category": "offense",
            "priorityRank": None,
            "tiers": [],
        }
    ]


def test_exports_a_skills_priority_rank_when_set(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    attack = repo.insert_skill(conn, name="Attack Up (Small)", category="offense")
    repo.set_skill_priority_rank(conn, skill_id=attack.id, rank=16)
    conn.commit()
    out_dir = tmp_path / "bundle"

    export_bundle(conn, out_dir)

    assert _load(out_dir / "skills.json") == [
        {
            "id": attack.id,
            "name": "Attack Up (Small)",
            "category": "offense",
            "priorityRank": 16,
            "tiers": [],
        }
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
            "priorityRank": None,
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
