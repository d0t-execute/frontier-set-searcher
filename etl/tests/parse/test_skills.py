from pathlib import Path

from etl.parse.skills import parse_skill_names, parse_zenith_skill_names

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"


def test_parses_skill_names_keyed_by_array_position() -> None:
    source = (FIXTURES_DIR / "skill_names_sample.js").read_text(encoding="utf-8")

    names = parse_skill_names(source)

    assert len(names) == 20
    assert names[0] == "None"  # BOM-prefixed in the source; must be stripped
    assert names[1] == "Passive"
    assert names[2] == "Fate"
    assert names[18] == "Expert"
    assert names[19] == "広域回復"  # untranslated entries pass through as-is


def test_parses_zenith_skill_names_keyed_by_array_position() -> None:
    source = (FIXTURES_DIR / "zenith_skill_names_sample.js").read_text(encoding="utf-8")

    names = parse_zenith_skill_names(source)

    assert len(names) == 11
    assert names[0] == "なし"
    assert names[1] == "Skill Slots Up+1"
    assert names[7] == "Skill Slots Up+7"
    assert names[10] == "Stylish Assault Up+1"
