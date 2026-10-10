"""Parse weapon rows out of the per-weapon-type HTML tables.

Unlike armor (`skill/equip.js`, a JSON bucket) and Decorations/Cuffs (same
bucket), weapons live as plain HTML `<table>`s under `buki/` — one page per
weapon type. Only the base tier is parsed; the `_g`/`_s`/`_n` variant pages
are different probabilistic/leveled crafting systems, out of scope (see
docs/weapon-data-format-notes.md).

Per the project owner: weapons never carry normal skills, only an optional
Zenith skill, and only `slot_count` and that Zenith skill actually matter
for this project — so this parser doesn't bother with Attack/Sharpness/
Element/Price/materials/Description at all.
"""

from __future__ import annotations

from dataclasses import dataclass

from bs4 import BeautifulSoup, Tag

from etl.db.models import RankType, WeaponType

WEAPON_PAGE_TO_TYPE: dict[str, WeaponType] = {
    "taiken": "great_sword",
    "tachi": "long_sword",
    "katate": "sword_and_shield",
    "souken": "dual_swords",
    "hammer": "hammer",
    "horn": "hunting_horn",
    "lance": "lance",
    "gunlance": "gunlance",
    "tonfa": "tonfa",
    "slaxe": "switch_axe_f",
    "magspike": "magnet_spike",
    "right": "light_bowgun",
    "heavy": "heavy_bowgun",
    "yumi": "bow",
}

# The CLASS-equivalent category tag for Tower weapons — see
# docs/weapon-data-format-notes.md "Category tags".
_TOWER_TAG = "天廊武器"

# Checked longest-first isn't actually necessary (none of these literally
# prefixes another — "GSR..." never starts with "GR" or "SR"), but keeping
# GSR first reads clearest.
_RANK_PREFIXES: tuple[RankType, ...] = ("GSR", "HR", "SR", "GR")


@dataclass(frozen=True, slots=True)
class _ColumnLayout:
    """Cell indices vary by weapon type -- confirmed against the live site,
    not assumed from the docs' column-name tables alone (see
    docs/weapon-data-format-notes.md "Ranged weapons have a different column
    layout entirely"):

    - Melee (10 cells): Name, Rarity, Attributes, Sharpness(+Zenith Skill),
      Slots, Rank, ...
    - Bow (11 cells): Name, Rarity, Attack Attribute, Charge Stage(+Zenith
      Skill), Coatings, Slots, Rank, ... -- Slots/Rank shift by one relative
      to melee, but the Zenith Skill tag stays in the same cell index (3).
    - LBG/HBG (11 cells): Name, Rarity, Attack, Reload/Recoil/Bullet Speed,
      Ammo(+Zenith Skill), Slots, Rank, ... -- Slots/Rank shift the same way
      as Bow, but the Zenith Skill tag is one cell further out (4, the Ammo
      cell) than Bow's.
    """

    slot_index: int
    rank_index: int
    zenith_skill_index: int


_MELEE_LAYOUT = _ColumnLayout(slot_index=4, rank_index=5, zenith_skill_index=3)
_BOW_LAYOUT = _ColumnLayout(slot_index=5, rank_index=6, zenith_skill_index=3)
_BOWGUN_LAYOUT = _ColumnLayout(slot_index=5, rank_index=6, zenith_skill_index=4)

_LAYOUT_BY_WEAPON_TYPE: dict[WeaponType, _ColumnLayout] = {
    "bow": _BOW_LAYOUT,
    "light_bowgun": _BOWGUN_LAYOUT,
    "heavy_bowgun": _BOWGUN_LAYOUT,
}


@dataclass(frozen=True, slots=True)
class ParsedWeaponRow:
    external_id: str
    name: str
    weapon_type: WeaponType
    rarity: int | None
    slot_count: int
    rank_type: RankType | None
    rank_value: int | None
    is_tower: bool
    zenith_skill_name: str | None


def _name_cell_text(name_cell: Tag) -> str:
    """The name is always the cell's first (bare text) child — whatever
    upgrade-chain links / category tag / level suffix follows is a sibling
    element, not part of the name.
    """
    first = name_cell.contents[0]
    return str(first).strip()


def _has_tower_tag(name_cell: Tag) -> bool:
    tag = name_cell.find("p")
    return tag is not None and tag.get_text(strip=True) == _TOWER_TAG


def _parse_rank(text: str) -> tuple[RankType | None, int | None]:
    for prefix in _RANK_PREFIXES:
        if text.startswith(prefix):
            rest = text[len(prefix) :].strip()
            return prefix, int(rest) if rest.isdigit() else None
    return None, None


def _parse_zenith_skill_name(cell: Tag) -> str | None:
    """The weapon-type-specific cell (see `_ColumnLayout`) optionally holds a
    `<q>Zenith Skill：<name></q>`.

    The site appends a bare "+" to *flat* skill names ("Dissolver Up+") that
    isn't part of the canonical TENINAME string ("Dissolver Up"), but
    leaves *tiered* names ("Skill Slots Up+1") alone, since those already
    end in a digit rather than "+" — so the rule is simply "strip a
    trailing +". Confirmed against the live site, not assumed.
    """
    q = cell.find("q")
    if q is None:
        return None
    text = q.get_text().split("：", 1)[-1].strip()
    return text[:-1] if text.endswith("+") else text


def parse_weapon_page(page: str, html: str) -> list[ParsedWeaponRow]:
    weapon_type = WEAPON_PAGE_TO_TYPE[page]
    layout = _LAYOUT_BY_WEAPON_TYPE.get(weapon_type, _MELEE_LAYOUT)
    soup = BeautifulSoup(html, "html.parser")
    tbody = soup.find("tbody")
    if tbody is None or not isinstance(tbody, Tag):
        return []

    parsed = []
    for row in tbody.find_all("tr"):
        cells = row.find_all("td")
        name_cell = cells[0]

        hex_id = str(name_cell.get("id") or "").removeprefix("l")
        rarity_text = cells[1].get_text(strip=True)
        slot_text = cells[layout.slot_index].get_text(strip=True)
        rank_type, rank_value = _parse_rank(cells[layout.rank_index].get_text(strip=True))

        parsed.append(
            ParsedWeaponRow(
                external_id=f"{page}:{hex_id}",
                name=_name_cell_text(name_cell),
                weapon_type=weapon_type,
                rarity=int(rarity_text) if rarity_text.isdigit() else None,
                slot_count=int(slot_text) if slot_text.isdigit() else 0,
                rank_type=rank_type,
                rank_value=rank_value,
                is_tower=_has_tower_tag(name_cell),
                zenith_skill_name=_parse_zenith_skill_name(cells[layout.zenith_skill_index]),
            )
        )
    return parsed
