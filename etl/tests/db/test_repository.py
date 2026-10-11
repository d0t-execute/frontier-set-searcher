import sqlite3

from etl.db import repository as repo
from etl.db.models import SkillPoints, SkillTier


def test_insert_and_fetch_equipment_by_external_id(conn: sqlite3.Connection) -> None:
    created = repo.insert_equipment(
        conn,
        external_id="0001",
        name="Leather Helm",
        slot_type="head",
        rarity=1,
        defense_base=2,
        defense_max=10,
        slot_count_base=0,
        slot_count_max=1,
    )

    fetched = repo.get_equipment_by_external_id(conn, "0001")

    assert fetched == created


def test_get_equipment_by_external_id_returns_none_when_missing(conn: sqlite3.Connection) -> None:
    assert repo.get_equipment_by_external_id(conn, "does-not-exist") is None


def test_list_equipment_filters_by_slot_type(conn: sqlite3.Connection) -> None:
    repo.insert_equipment(conn, external_id="0001", name="Leather Helm", slot_type="head")
    repo.insert_equipment(conn, external_id="0002", name="Leather Vest", slot_type="chest")

    heads = repo.list_equipment(conn, slot_type="head")

    assert [e.external_id for e in heads] == ["0001"]


def test_list_equipment_without_filter_returns_everything(conn: sqlite3.Connection) -> None:
    repo.insert_equipment(conn, external_id="0001", name="Leather Helm", slot_type="head")
    repo.insert_equipment(conn, external_id="0002", name="Leather Vest", slot_type="chest")

    all_equipment = repo.list_equipment(conn)

    assert {e.external_id for e in all_equipment} == {"0001", "0002"}


def test_insert_skill_is_idempotent_by_name(conn: sqlite3.Connection) -> None:
    first = repo.insert_skill(conn, name="Attack Up (Small)", category="offense")
    second = repo.insert_skill(conn, name="Attack Up (Small)", category="offense")

    assert first == second


def test_equipment_skills_round_trip(conn: sqlite3.Connection) -> None:
    equipment = repo.insert_equipment(
        conn, external_id="0001", name="Leather Helm", slot_type="head"
    )
    skill = repo.insert_skill(conn, name="Attack Up (Small)", category="offense")

    repo.add_equipment_skill(conn, equipment_id=equipment.id, skill_id=skill.id, points=3)

    assert repo.get_equipment_skills(conn, equipment.id) == [SkillPoints(skill=skill, points=3)]


def test_equipment_with_no_skills_returns_empty_list(conn: sqlite3.Connection) -> None:
    equipment = repo.insert_equipment(
        conn, external_id="0001", name="Leather Helm", slot_type="head"
    )

    assert repo.get_equipment_skills(conn, equipment.id) == []


def test_decoration_skills_round_trip(conn: sqlite3.Connection) -> None:
    decoration = repo.insert_decoration(conn, external_id="D001", name="Attack Jewel", slot_size=1)
    skill = repo.insert_skill(conn, name="Attack Up (Small)")

    repo.add_decoration_skill(conn, decoration_id=decoration.id, skill_id=skill.id, points=3)

    assert repo.get_decoration_skills(conn, decoration.id) == [SkillPoints(skill=skill, points=3)]


def test_insert_and_fetch_cuff_by_external_id(conn: sqlite3.Connection) -> None:
    created = repo.insert_cuff(conn, external_id="3F20", name="SnS・Basic", slot_size=0)

    fetched = repo.get_cuff_by_external_id(conn, "3F20")

    assert fetched == created


def test_get_cuff_by_external_id_returns_none_when_missing(conn: sqlite3.Connection) -> None:
    assert repo.get_cuff_by_external_id(conn, "does-not-exist") is None


def test_cuff_skills_round_trip(conn: sqlite3.Connection) -> None:
    cuff = repo.insert_cuff(conn, external_id="C001", name="Sharpening PC1", slot_size=1)
    skill = repo.insert_skill(conn, name="Sharpness")

    repo.add_cuff_skill(conn, cuff_id=cuff.id, skill_id=skill.id, points=2)

    assert repo.get_cuff_skills(conn, cuff.id) == [SkillPoints(skill=skill, points=2)]


def test_cuff_with_no_skills_returns_empty_list(conn: sqlite3.Connection) -> None:
    cuff = repo.insert_cuff(conn, external_id="C001", name="Empty Cuff", slot_size=1)

    assert repo.get_cuff_skills(conn, cuff.id) == []


def test_insert_zenith_skill_is_idempotent_by_name(conn: sqlite3.Connection) -> None:
    first = repo.insert_zenith_skill(conn, name="Skill Slots Up+1")
    second = repo.insert_zenith_skill(conn, name="Skill Slots Up+1")

    assert first == second


def test_get_zenith_skill_by_name_returns_none_when_missing(conn: sqlite3.Connection) -> None:
    assert repo.get_zenith_skill_by_name(conn, "does-not-exist") is None


def test_equipment_round_trips_is_tower_and_zenith_skill(conn: sqlite3.Connection) -> None:
    zenith_skill = repo.insert_zenith_skill(conn, name="Skill Slots Up+1")

    created = repo.insert_equipment(
        conn,
        external_id="2B8D",
        name="Espinas Z Brain",
        slot_type="head",
        is_tower=False,
        zenith_skill_id=zenith_skill.id,
    )
    fetched = repo.get_equipment_by_external_id(conn, "2B8D")

    assert fetched == created
    assert fetched is not None
    assert fetched.zenith_skill_id == zenith_skill.id
    assert fetched.is_tower is False


def test_equipment_defaults_to_not_tower_and_no_zenith_skill(conn: sqlite3.Connection) -> None:
    created = repo.insert_equipment(conn, external_id="0001", name="Leather Helm", slot_type="head")

    assert created.is_tower is False
    assert created.zenith_skill_id is None


def test_tower_equipment_round_trips(conn: sqlite3.Connection) -> None:
    created = repo.insert_equipment(
        conn, external_id="2543", name="Ranvuo Helm", slot_type="head", is_tower=True
    )
    fetched = repo.get_equipment_by_external_id(conn, "2543")

    assert fetched == created
    assert fetched is not None
    assert fetched.is_tower is True


def test_tower_decoration_defaults_and_overrides(conn: sqlite3.Connection) -> None:
    normal = repo.insert_decoration(conn, external_id="D001", name="Paralysis 1 Deco", slot_size=1)
    tower_gem = repo.insert_decoration(
        conn, external_id="D002", name="Status Res Gem Ⅲ", slot_size=1, is_tower=True
    )

    assert normal.is_tower is False
    assert tower_gem.is_tower is True


def test_cuff_round_trips_zenith_skill(conn: sqlite3.Connection) -> None:
    zenith_skill = repo.insert_zenith_skill(conn, name="Skill Slots Up+1")

    created = repo.insert_cuff(
        conn,
        external_id="3918",
        name="Skill Slots Up Sigil",
        slot_size=1,
        zenith_skill_id=zenith_skill.id,
    )
    fetched = repo.get_cuff_by_external_id(conn, "3918")

    assert fetched == created
    assert fetched is not None
    assert fetched.zenith_skill_id == zenith_skill.id


def test_cuff_defaults_to_no_zenith_skill(conn: sqlite3.Connection) -> None:
    created = repo.insert_cuff(conn, external_id="C001", name="Sharpening PC1", slot_size=1)

    assert created.zenith_skill_id is None


def test_insert_and_fetch_weapon_by_external_id(conn: sqlite3.Connection) -> None:
    created = repo.insert_weapon(
        conn,
        external_id="taiken:0003",
        name="Buster Sword",
        weapon_type="great_sword",
        rarity=1,
        slot_count=0,
        rank_type="HR",
        rank_value=1,
    )

    fetched = repo.get_weapon_by_external_id(conn, "taiken:0003")

    assert fetched == created


def test_get_weapon_by_external_id_returns_none_when_missing(conn: sqlite3.Connection) -> None:
    assert repo.get_weapon_by_external_id(conn, "does-not-exist") is None


def test_weapon_defaults_to_not_tower_and_no_zenith_skill(conn: sqlite3.Connection) -> None:
    created = repo.insert_weapon(
        conn, external_id="taiken:0003", name="Buster Sword", weapon_type="great_sword"
    )

    assert created.is_tower is False
    assert created.zenith_skill_id is None


def test_tower_weapon_round_trips(conn: sqlite3.Connection) -> None:
    created = repo.insert_weapon(
        conn,
        external_id="taiken:318F",
        name="Hate Bleeder",
        weapon_type="great_sword",
        is_tower=True,
    )
    fetched = repo.get_weapon_by_external_id(conn, "taiken:318F")

    assert fetched == created
    assert fetched is not None
    assert fetched.is_tower is True


def test_list_skills_returns_everything_inserted(conn: sqlite3.Connection) -> None:
    repo.insert_skill(conn, name="Attack Up (Small)", category="offense")
    repo.insert_skill(conn, name="Defense Up (Small)", category="defense")

    assert {s.name for s in repo.list_skills(conn)} == {"Attack Up (Small)", "Defense Up (Small)"}


def test_list_skills_on_empty_db_returns_empty_list(conn: sqlite3.Connection) -> None:
    assert repo.list_skills(conn) == []


def test_list_decorations_returns_everything_inserted(conn: sqlite3.Connection) -> None:
    repo.insert_decoration(conn, external_id="D001", name="Attack Jewel", slot_size=1)
    repo.insert_decoration(conn, external_id="D002", name="Defense Jewel", slot_size=2)

    assert {d.external_id for d in repo.list_decorations(conn)} == {"D001", "D002"}


def test_list_decorations_on_empty_db_returns_empty_list(conn: sqlite3.Connection) -> None:
    assert repo.list_decorations(conn) == []


def test_zenith_weapon_round_trips_zenith_skill(conn: sqlite3.Connection) -> None:
    zenith_skill = repo.insert_zenith_skill(conn, name="Drug Knowledge Up")

    created = repo.insert_weapon(
        conn,
        external_id="taiken:3B13",
        name="Feather Sleeper",
        weapon_type="great_sword",
        rank_type="GR",
        rank_value=200,
        zenith_skill_id=zenith_skill.id,
    )
    fetched = repo.get_weapon_by_external_id(conn, "taiken:3B13")

    assert fetched == created
    assert fetched is not None
    assert fetched.zenith_skill_id == zenith_skill.id


def test_skill_tiers_round_trip_in_order_including_negative_thresholds(
    conn: sqlite3.Connection,
) -> None:
    skill = repo.insert_skill(conn, name="Health")

    repo.insert_skill_tier(
        conn,
        skill_id=skill.id,
        tier_order=0,
        label="Health+50",
        threshold=40,
        description="Maximum Health +50",
    )
    repo.insert_skill_tier(
        conn,
        skill_id=skill.id,
        tier_order=1,
        label="Health-20",
        threshold=-15,
        description="Maximum Health -20",
    )

    assert repo.get_skill_tiers(conn, skill.id) == [
        SkillTier(label="Health+50", threshold=40, description="Maximum Health +50"),
        SkillTier(label="Health-20", threshold=-15, description="Maximum Health -20"),
    ]


def test_get_skill_tiers_returns_empty_list_for_a_skill_with_no_tiers(
    conn: sqlite3.Connection,
) -> None:
    skill = repo.insert_skill(conn, name="Gather")

    assert repo.get_skill_tiers(conn, skill.id) == []


def test_set_skill_category_updates_an_existing_skill(conn: sqlite3.Connection) -> None:
    skill = repo.insert_skill(conn, name="Health")

    repo.set_skill_category(conn, skill_id=skill.id, category="Health and Stamina")

    fetched_skill = repo.get_skill_by_name(conn, "Health")
    assert fetched_skill is not None
    assert fetched_skill.category == "Health and Stamina"
