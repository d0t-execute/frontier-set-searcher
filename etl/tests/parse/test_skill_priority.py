from pathlib import Path

from etl.parse.skill_priority import ParsedSkillPriority, parse_skill_priority_table

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"


def _fixture_html() -> str:
    return (FIXTURES_DIR / "skill_priority_sample.html").read_text(encoding="utf-8")


def test_parses_every_rank_name_pair_across_the_flattened_grid() -> None:
    entries = parse_skill_priority_table(_fixture_html())

    assert entries == [
        ParsedSkillPriority(name="SnS Tech", rank=1),
        ParsedSkillPriority(name="Furious", rank=18),
        ParsedSkillPriority(name="DB Tech", rank=2),
        ParsedSkillPriority(name="Strong Attack", rank=16),
    ]


def test_skips_the_skill_removed_placeholder_rank() -> None:
    entries = parse_skill_priority_table(_fixture_html())

    assert all(e.rank != 78 for e in entries)
    assert "[Skill Removed]" not in [e.name for e in entries]


def test_skips_trailing_empty_column_pairs() -> None:
    # The fixture's third row has a real first pair (16, Strong Attack) and
    # an empty trailing pair -- only the real one should parse.
    entries = parse_skill_priority_table(_fixture_html())

    assert len([e for e in entries if e.rank == 16]) == 1


def test_returns_empty_list_for_html_with_no_matching_table() -> None:
    assert parse_skill_priority_table("<html><body>nothing here</body></html>") == []
