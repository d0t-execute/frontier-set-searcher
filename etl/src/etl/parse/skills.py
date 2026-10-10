"""Parse skill ID -> name lookup tables out of skill/SkillForm.js.

`var MST_Skill = [...]` is a ~225-entry JS array literal, not valid JSON (it
uses array holes like `[,,]`), so it gets its own line-oriented extraction
rather than `json.loads`. See docs/data-format-notes.md.
"""

from __future__ import annotations

import json
import re

from etl.parse.js_extract import extract_balanced

_ENTRY_NAME_RE = re.compile(r'^\[\s*"((?:\\.|[^"\\])*)"')


def parse_skill_names(source: str) -> dict[int, str]:
    """Return {skill_id: name}, where skill_id is the entry's position in the array."""
    block = extract_balanced(source, "var MST_Skill = ")

    names: dict[int, str] = {}
    skill_id = 0
    for line in block.splitlines():
        match = _ENTRY_NAME_RE.match(line.strip())
        if match is None:
            continue
        names[skill_id] = match.group(1).lstrip("﻿").strip()
        skill_id += 1

    return names


def parse_zenith_skill_names(source: str) -> dict[int, str]:
    """Return {zenith_skill_id: name} from `var ... TENINAME = [...]`.

    Unlike MST_Skill, TENINAME is a plain JSON array (no holes), so this is
    just `json.loads` on the extracted block. See docs/data-format-notes.md
    "Zenith skills".
    """
    names: list[str] = json.loads(extract_balanced(source, "TENINAME = "))
    return dict(enumerate(names))
