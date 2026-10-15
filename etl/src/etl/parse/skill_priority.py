"""Parse the skill activation-priority table from
https://mertna.github.io/MHFZ-Skills/tables/Priority.html (see
docs/skill-system-roadmap.md TODO #1 "Skill cap system + skill priority list").

The game caps how many *distinct normal skills* can be simultaneously active
on one build (confirmed by the project owner, citing this exact page): a
plain build gets 10, a build using >=3/>=5 G-Rank-or-later armor pieces gets
+1/+2 more, and each stacked level of the Zenith skill "Skill Slots Up" adds
another +1 (up to +7). Once a build's active-skill count would exceed that
cap, this table says which ones get force-disabled first: lower rank number
survives longer (SnS Tech, rank 1, is the most protected; a skill absent from
this table or never reached in-game would be the first to go). Scope is
normal skills only -- Zenith skills are a wholly separate pool unaffected by
this cap (the table's own row count, ~194, matches this catalog's normal-skill
count, not the ~26-family Zenith catalog).

The table's HTML is a flattened grid -- N repeating (rank, name) `<td>` pairs
per `<tr>`, not one skill per row -- with blank trailing cells once the last
row's column count stops dividing evenly, and at least one placeholder
("[Skill Removed]") marking a rank the source intentionally leaves vacant.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from bs4 import BeautifulSoup, Tag

_PLACEHOLDER_NAMES = {"[Skill Removed]", ""}


@dataclass(frozen=True, slots=True)
class ParsedSkillPriority:
    name: str
    rank: int


def parse_skill_priority_table(html: str) -> list[ParsedSkillPriority]:
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table", id="skills_priority")
    if table is None or not isinstance(table, Tag):
        return []
    tbody = table.find("tbody")
    if tbody is None or not isinstance(tbody, Tag):
        return []

    entries: list[ParsedSkillPriority] = []
    for row in tbody.find_all("tr", recursive=False):
        cells = row.find_all("td", recursive=False)
        # Each row is `(rank, name)` pairs -- walk two cells at a time rather
        # than assuming a fixed column count, since the last data row's
        # trailing pairs are empty placeholders, not a parse error.
        for i in range(0, len(cells) - 1, 2):
            rank_text = cells[i].get_text(strip=True)
            name = cells[i + 1].get_text(strip=True)
            if not _CLEAN_INTEGER.match(rank_text) or name in _PLACEHOLDER_NAMES:
                continue
            entries.append(ParsedSkillPriority(name=name, rank=int(rank_text)))

    return entries


_CLEAN_INTEGER = re.compile(r"^\d+$")
