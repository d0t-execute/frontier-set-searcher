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

WeaponType = Literal[
    "great_sword",
    "long_sword",
    "sword_and_shield",
    "dual_swords",
    "hammer",
    "hunting_horn",
    "lance",
    "gunlance",
    "tonfa",
    "switch_axe_f",
    "magnet_spike",
    "light_bowgun",
    "heavy_bowgun",
    "bow",
]

WEAPON_TYPES: tuple[WeaponType, ...] = (
    "great_sword",
    "long_sword",
    "sword_and_shield",
    "dual_swords",
    "hammer",
    "hunting_horn",
    "lance",
    "gunlance",
    "tonfa",
    "switch_axe_f",
    "magnet_spike",
    "light_bowgun",
    "heavy_bowgun",
    "bow",
)

RankType = Literal["HR", "SR", "GR", "GSR"]

# An armor piece's own TYPE field (index 2) -- a piece restricted to
# Blademaster or Gunner can't share a build with the opposite restriction
# (confirmed by the project owner). 'common' has no restriction either way.
HunterType = Literal["common", "blademaster", "gunner"]


@dataclass(frozen=True, slots=True)
class Skill:
    id: int
    name: str
    category: str | None = None
    priority_rank: int | None = None


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
    # The reference set-searcher's gear-level category leaf -- see
    # docs/gear-category-taxonomy.md.
    category: str = "standard_plain"
    # Whether this piece is "G Rank or later" for the active-skill-cap
    # piece-count bonus -- see etl.parse.gear_category.is_grank_or_later_equipment.
    # Independent of `category`: several display categories mix below-G-rank
    # and G-rank-or-later pieces and can't be used for this on their own.
    grank_or_later: bool = False
    # Which skill (if any) this piece's own Exotic-armor marker grants a
    # fixed bonus to -- see docs/data-format-notes.md "Exotic armor". Kept
    # separate from the merged points in `equipment_skill`/`skills` so the
    # active-skill-cap exemption can tell an Exotic grant apart from a
    # piece's normal skill contributions.
    exotic_skill_id: int | None = None
    # See `HunterType`'s own docstring.
    hunter_type: HunterType = "common"
    source_url: str | None = None


@dataclass(frozen=True, slots=True)
class Decoration:
    id: int
    external_id: str
    name: str
    slot_size: int
    # Tower Gem -- see the matching note on Equipment.is_tower.
    is_tower: bool = False
    # The reference set-searcher's decoration-tree category leaf -- see
    # docs/gear-category-taxonomy.md.
    category: str = "deco_standard"
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
    # The reference set-searcher's cuff-tree category leaf -- see
    # docs/gear-category-taxonomy.md.
    category: str = "cuff_standard_tier1"
    source_url: str | None = None


@dataclass(frozen=True, slots=True)
class Weapon:
    """Weapons generally don't matter to the set searcher except for
    slot_count (decos/sigils) and an optional Zenith skill -- confirmed by the
    project owner. There is no normal-skill relation: weapons never carry
    normal skills. See docs/weapon-data-format-notes.md.
    """

    id: int
    external_id: str
    name: str
    weapon_type: WeaponType
    rarity: int | None = None
    slot_count: int = 0
    rank_type: RankType | None = None
    rank_value: int | None = None
    # Tower weapon -- see the matching note on Equipment.is_tower.
    is_tower: bool = False
    zenith_skill_id: int | None = None
    source_url: str | None = None


@dataclass(frozen=True, slots=True)
class SkillPoints:
    skill: Skill
    points: int


@dataclass(frozen=True, slots=True)
class SkillTier:
    """One named, point-thresholded tier of a normal skill (e.g. "Health+50"
    at threshold 40) -- see docs/data-format-notes.md "Skill tiers".
    threshold can be negative (a penalty tier)."""

    label: str
    threshold: int
    description: str | None = None
