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
class Equipment:
    id: int
    external_id: str
    name: str
    slot_type: EquipmentType
    rarity: int | None = None
    defense: int | None = None
    slot_count: int = 0
    min_hr: int | None = None
    min_gr: int | None = None
    source_url: str | None = None


@dataclass(frozen=True, slots=True)
class Decoration:
    id: int
    external_id: str
    name: str
    slot_size: int
    source_url: str | None = None


@dataclass(frozen=True, slots=True)
class SkillPoints:
    skill: Skill
    points: int
