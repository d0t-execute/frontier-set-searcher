import sqlite3

from etl.db import repository as repo
from etl.db.models import SkillPoints


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
