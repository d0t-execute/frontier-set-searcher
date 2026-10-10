"""Parse armor/decoration rows out of skill/equip.js.

Column layout, the defense-progression formula, and the bucket->slot_type
mapping are all reverse-engineered from the site's own skill/SkillForm.js —
see docs/data-format-notes.md for the full writeup this module implements.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass
from enum import IntEnum

from etl.db.models import EquipmentType
from etl.parse.js_extract import extract_balanced

BUCKET_TO_SLOT_TYPE: dict[str, EquipmentType] = {
    "head": "head",
    "body": "chest",
    "arm": "arms",
    "wst": "waist",
    "leg": "legs",
}


class Field(IntEnum):
    """Positional column indices, named after SkillForm.js's I_b* constants."""

    NAME = 0
    RARE = 3
    SN1 = 10
    SP1 = 11
    SN2 = 12
    SP2 = 13
    SN3 = 14
    SP3 = 15
    SN4 = 16
    SP4 = 17
    SN5 = 18
    SP5 = 19
    HR1 = 22
    LVMAX = 24
    DEF = 26
    SLOT1 = 27
    SLOT7 = 28
    DEFPTN = 30


_SKILL_FIELD_PAIRS = (
    (Field.SN1, Field.SP1),
    (Field.SN2, Field.SP2),
    (Field.SN3, Field.SP3),
    (Field.SN4, Field.SP4),
    (Field.SN5, Field.SP5),
)


@dataclass(frozen=True, slots=True)
class ParsedEquipmentRow:
    external_id: str
    name: str
    slot_type: EquipmentType
    rarity: int | None
    min_hr: int | None
    defense_base: int | None
    defense_max: int | None
    slot_count_base: int
    slot_count_max: int
    skills: tuple[tuple[int, int], ...]


@dataclass(frozen=True, slots=True)
class ParsedDecorationRow:
    external_id: str
    name: str
    slot_size: int
    skills: tuple[tuple[int, int], ...]


@dataclass(frozen=True, slots=True)
class ParsedEquipData:
    equipment: list[ParsedEquipmentRow]
    decorations: list[ParsedDecorationRow]


def compute_defense_progression(
    *, def_base: int, defptn_hex: str, def_patterns: Sequence[str]
) -> list[int]:
    """Port of SkillForm.js's getDef(): defense at each of the 7 forge levels.

    The three conditions below (ptn[i] == "100", the ptncd "05"/pct
    102/current 51 special case, and the two numeric exclusions) are a
    literal port of the source's own special-cased rounding rules, not a
    simplification — see docs/data-format-notes.md.
    """
    pattern = def_patterns[int(defptn_hex, 16)].split(",")
    progression = [def_base]
    current = def_base
    for i in range(1, 7):
        pct = pattern[i]
        no_round_up = (
            pct == "100"
            or (defptn_hex == "05" and pct == "102" and current == 51)
            or (
                (int(pct) * current) % 100 == 0
                and not (pct == "120" and current in (25, 45, 50, 90, 100))
                and not (pct == "108" and current == 25)
            )
        )
        scaled = int(current * int(pct) / 100)
        current = scaled if no_round_up else scaled + 1
        progression.append(current)
    return progression


def _field(fields: list[str], index: Field) -> str:
    return fields[index] if index < len(fields) else ""


def _int_or_none(value: str) -> int | None:
    return int(value) if value != "" else None


def _extract_skills(fields: list[str]) -> tuple[tuple[int, int], ...]:
    """Collect (skill_id, points) across the 5 SN/SP slots, summing duplicates.

    A handful of real rows list the same skill ID in more than one slot (e.g.
    "Endre F Guard" grants skill 143 from both slot 3 and slot 5). The site's
    own point-totaling code sums contributions by skill ID unconditionally —
    see docs/data-format-notes.md — so we do too, rather than keeping two
    separate entries (which also wouldn't fit the DB's (equipment_id,
    skill_id) primary key).
    """
    totals: dict[int, int] = {}
    for name_field, points_field in _SKILL_FIELD_PAIRS:
        skill_id = _field(fields, name_field)
        points = _field(fields, points_field)
        if skill_id != "" and points != "":
            totals[int(skill_id)] = totals.get(int(skill_id), 0) + int(points)
    return tuple(totals.items())


def parse_equipment_bucket(
    bucket: str, bucket_json: str, def_patterns: Sequence[str]
) -> list[ParsedEquipmentRow]:
    slot_type = BUCKET_TO_SLOT_TYPE[bucket]
    rows: dict[str, str] = json.loads(bucket_json)

    parsed = []
    for hex_id, raw in rows.items():
        fields = raw.split(",")
        def_base = _int_or_none(_field(fields, Field.DEF))
        defptn = _field(fields, Field.DEFPTN)
        lvmax = _int_or_none(_field(fields, Field.LVMAX)) or 1

        defense_max = def_base
        if def_base is not None and defptn != "":
            progression = compute_defense_progression(
                def_base=def_base, defptn_hex=defptn, def_patterns=def_patterns
            )
            defense_max = progression[min(max(lvmax, 1), 7) - 1]

        parsed.append(
            ParsedEquipmentRow(
                external_id=f"{bucket}:{hex_id}",
                name=_field(fields, Field.NAME),
                slot_type=slot_type,
                rarity=_int_or_none(_field(fields, Field.RARE)),
                min_hr=_int_or_none(_field(fields, Field.HR1)),
                defense_base=def_base,
                defense_max=defense_max,
                slot_count_base=_int_or_none(_field(fields, Field.SLOT1)) or 0,
                slot_count_max=_int_or_none(_field(fields, Field.SLOT7)) or 0,
                skills=_extract_skills(fields),
            )
        )
    return parsed


def parse_decoration_bucket(bucket_json: str) -> list[ParsedDecorationRow]:
    rows: dict[str, str] = json.loads(bucket_json)

    parsed = []
    for hex_id, raw in rows.items():
        fields = raw.split(",")
        parsed.append(
            ParsedDecorationRow(
                external_id=f"deco:{hex_id}",
                name=_field(fields, Field.NAME),
                slot_size=_int_or_none(_field(fields, Field.SLOT7)) or 0,
                skills=_extract_skills(fields),
            )
        )
    return parsed


def _extract_bucket_json(source: str, bucket: str) -> str:
    return extract_balanced(source, f'SkillForm.setEquip("{bucket}"')


def parse_equip_js(source: str) -> ParsedEquipData:
    """Parse a full equip.js source (or a fixture containing the buckets we use)."""
    def_patterns: list[str] = json.loads(_extract_bucket_json(source, "def"))

    equipment = []
    for bucket in BUCKET_TO_SLOT_TYPE:
        bucket_json = _extract_bucket_json(source, bucket)
        equipment.extend(parse_equipment_bucket(bucket, bucket_json, def_patterns))

    decorations = parse_decoration_bucket(_extract_bucket_json(source, "deco"))

    return ParsedEquipData(equipment=equipment, decorations=decorations)
