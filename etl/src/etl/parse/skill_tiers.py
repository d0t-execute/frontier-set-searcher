"""Parse the normal-skill point-threshold tables from
https://mertna.github.io/MHFZ-Skills/tables/Base.html (see
docs/data-format-notes.md "Skill tiers").

The project's primary source (xl3lackout's `SkillForm.js`) only ever gives a
flat, fixed point value per equipment piece -- it has no concept of what
*effect* those points actually unlock, or that armor/decoration-granted
"points" accumulate into discrete tiers with thresholds (confirmed by the
project owner, who screenshotted this exact table). This second source fills
that gap: one `<table>` of skill *groups* (e.g. "Health"), each with one or
more *tiers* (e.g. "Health+50") naming the point threshold needed to activate
it -- thresholds can be negative (a penalty tier activated by over-negative
points, e.g. "Health-20" at -15).

The table's HTML has real irregularities, confirmed against the live site,
that this parser deliberately refuses to guess through rather than silently
mis-parsing:

- A group's opening row sometimes carries no real tier at all, just a
  baseline description (its points cell is empty except for a stray `<br>`,
  e.g. "Adrenaline"'s unbuffed state).
- A few tiers give two `<br>`-separated alternative values in one cell
  (e.g. "Adrenaline+2"'s "15<br>|<br>20") instead of one clean number --
  concatenating their text would silently produce a wrong single number.
- Hiden/Tech skills' top tier reads a non-numeric requirement ("Both Hiden")
  instead of a point threshold.
- A description cell can embed its own hidden, nested `<table>` (e.g.
  "Guard"'s per-weapon-type knockback table) whose rows must not be mistaken
  for sibling skill rows.

Any row whose points cell isn't a single clean integer is skipped (that tier
is simply not recorded), rather than the whole group or the whole parse
failing -- the rest of a group's genuinely numeric tiers are still valid and
worth keeping.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from bs4 import BeautifulSoup, Tag

_CLEAN_INTEGER = re.compile(r"^-?\d+$")


@dataclass(frozen=True, slots=True)
class ParsedSkillTier:
    label: str
    threshold: int
    description: str


@dataclass(frozen=True, slots=True)
class ParsedSkillGroup:
    name: str
    section: str
    tiers: tuple[ParsedSkillTier, ...]


def parse_skill_tier_table(html: str) -> list[ParsedSkillGroup]:
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table", id="skills_base")
    if table is None or not isinstance(table, Tag):
        return []
    tbody = table.find("tbody")
    if tbody is None or not isinstance(tbody, Tag):
        return []

    groups: list[ParsedSkillGroup] = []
    current_name: str | None = None
    current_section = ""
    current_tiers: list[ParsedSkillTier] = []

    def flush() -> None:
        if current_name is not None:
            groups.append(
                ParsedSkillGroup(
                    name=current_name, section=current_section, tiers=tuple(current_tiers)
                )
            )

    # recursive=False is essential: a description cell can embed its own
    # hidden <table> with its own <tr>s (see "Guard" in the module
    # docstring), which a recursive search would wrongly treat as siblings.
    for row in tbody.find_all("tr", recursive=False):
        title = row.find("th", class_="title")
        if title is not None:
            flush()
            current_name = None
            current_section = title.get_text(strip=True).strip("-").strip()
            continue

        group_cells = row.find_all("td", class_="g", recursive=False)
        if group_cells and group_cells[0].get_text(strip=True):
            flush()
            current_name = group_cells[0].get_text(strip=True)
            current_tiers = []

        tier = _parse_tier_row(row)
        if tier is not None and current_name is not None:
            current_tiers.append(tier)

    flush()
    return groups


def _parse_tier_row(row: Tag) -> ParsedSkillTier | None:
    label_cell = row.find("td", class_="t", recursive=False)
    points_cell = row.find("td", class_="n", recursive=False)
    if label_cell is None or points_cell is None:
        return None

    label = label_cell.get_text(strip=True)
    if not label:
        return None

    # A <br> means two (or more) distinct lines of text in this cell -- see
    # "Adrenaline" in the module docstring. Flattening that to one string
    # before the regex check would silently glue them into a single wrong
    # number, so it's rejected before that ever happens.
    if points_cell.find("br") is not None:
        return None

    points_text = points_cell.get_text(strip=True)
    if not _CLEAN_INTEGER.match(points_text):
        return None

    description_cell = row.find("td", class_="b", recursive=False)
    description = description_cell.get_text(strip=True) if description_cell is not None else ""

    return ParsedSkillTier(label=label, threshold=int(points_text), description=description)
