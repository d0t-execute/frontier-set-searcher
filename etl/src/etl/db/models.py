"""Typed records returned by the repository layer (see docs/PLAN.md §7)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

EquipmentType = Literal["head", "chest", "arms", "waist", "legs", "weapon", "charm"]

EQUIPMENT_TYPES: tuple[EquipmentType, ...] = (
    "head",
    "chest",
    "arms",
    "waist",
    "legs",
    "weapon",
    "charm",
)


@dataclass(frozen=True, slots=True)
class Skill:
    id: int
    name: str
    category: str | None = None


@dataclass(frozen=True, slots=True)
class ZenithSkill:
    """A skill system separate from `Skill` (resolved through TENINAME, not
    MST_Skill), carried by Zenith/Tan'i equipment (CLASS "P"/"Q") in addition
    to its normal skills. See docs/data-format-notes.md "Zenith skills".
    """

    id: int
    name: str


@dataclass(frozen=True, slots=True)
class Equipment:
    id: int
    external_id: str
    name: str
    slot_type: EquipmentType
    rarity: int | None = None
    defense_base: int | None = None
    defense_max: int | None = None
    slot_count_base: int = 0
    slot_count_max: int = 0
    min_hr: int | None = None
    min_gr: int | None = None
    # Tower armor can only take Tower Gems in its slots, and Tower Gems can
    # only go into Tower armor -- an exclusive-both-ways compatibility rule.
    # See docs/data-format-notes.md "Tower Armor".
    is_tower: bool = False
    zenith_skill_id: int | None = None
    source_url: str | None = None


@dataclass(frozen=True, slots=True)
class Decoration:
    id: int
    external_id: str
    name: str
    slot_size: int
    # Tower Gem -- see the matching note on Equipment.is_tower.
    is_tower: bool = False
    source_url: str | None = None


@dataclass(frozen=True, slots=True)
class Cuff:
    """A separate equipment category from Decoration (see docs/data-format-notes.md):
    cuffs occupy their own "Poogie slot" pool, not armor decoration sockets.
    """

    id: int
    external_id: str
    name: str
    slot_size: int
    # Zenith Cuffs carry only a Zenith skill, no normal skills.
    zenith_skill_id: int | None = None
    source_url: str | None = None


@dataclass(frozen=True, slots=True)
class SkillPoints:
    skill: Skill
    points: int
