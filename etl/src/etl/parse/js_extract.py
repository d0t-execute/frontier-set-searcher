"""Extract a balanced JSON-ish value out of a larger blob of hand-written JS.

The source site embeds its data as calls like `SkillForm.setEquip("head", {
... })` inside an otherwise non-JSON JS file. Rather than writing a JS parser,
we find the call by its distinctive marker text and scan forward for a
balanced `{...}`/`[...]` — which turns out to be valid JSON on its own (see
docs/data-format-notes.md).
"""

from __future__ import annotations


def extract_balanced(source: str, marker: str) -> str:
    """Return the balanced ``{...}``/``[...]`` substring following ``marker``.

    Scans forward from the end of ``marker`` for the first ``{`` or ``[``,
    then returns everything up to its matching close, ignoring brackets that
    appear inside string literals (including escaped quotes).
    """
    start = source.find(marker)
    if start == -1:
        raise ValueError(f"marker not found: {marker!r}")

    i = start + len(marker)
    while i < len(source) and source[i] not in "{[":
        i += 1
    if i >= len(source):
        raise ValueError(f"no opening brace/bracket found after marker: {marker!r}")

    open_char = source[i]
    close_char = "}" if open_char == "{" else "]"
    open_start = i
    depth = 0
    in_string = False
    escaped = False

    for j in range(open_start, len(source)):
        c = source[j]
        if in_string:
            if escaped:
                escaped = False
            elif c == "\\":
                escaped = True
            elif c == '"':
                in_string = False
        else:
            if c == '"':
                in_string = True
            elif c == open_char:
                depth += 1
            elif c == close_char:
                depth -= 1
                if depth == 0:
                    return source[open_start : j + 1]

    raise ValueError(f"unbalanced brackets after marker: {marker!r}")
