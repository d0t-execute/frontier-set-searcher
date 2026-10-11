from pathlib import Path

from etl.parse.skill_tiers import ParsedSkillGroup, ParsedSkillTier, parse_skill_tier_table

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"


def _fixture_html() -> str:
    return (FIXTURES_DIR / "skill_tiers_base_sample.html").read_text(encoding="utf-8")


def _group(groups: list[ParsedSkillGroup], name: str) -> ParsedSkillGroup:
    return next(g for g in groups if g.name == name)


def test_parses_every_group_in_the_fixture() -> None:
    groups = parse_skill_tier_table(_fixture_html())

    assert [g.name for g in groups] == ["Health", "Lone Wolf", "Adrenaline", "Guard", "SnS Tech"]


def test_strips_the_decorative_dashes_from_section_headers() -> None:
    groups = parse_skill_tier_table(_fixture_html())

    assert _group(groups, "Health").section == "Health and Stamina"
    assert _group(groups, "Adrenaline").section == "Attack Skills"
    assert _group(groups, "SnS Tech").section == "Hiden/Tech Skills"


def test_parses_a_multi_tier_group_including_negative_thresholds() -> None:
    health = _group(parse_skill_tier_table(_fixture_html()), "Health")

    assert health.tiers == (
        ParsedSkillTier(label="Health+50", threshold=40, description="Maximum Health +50"),
        ParsedSkillTier(label="Health+40", threshold=30, description="Maximum Health +40"),
        ParsedSkillTier(label="Health-10", threshold=-10, description="Maximum Health -10"),
        ParsedSkillTier(label="Health-20", threshold=-15, description="Maximum Health -20"),
    )


def test_parses_a_single_tier_group() -> None:
    lone_wolf = _group(parse_skill_tier_table(_fixture_html()), "Lone Wolf")

    assert lone_wolf.tiers == (
        ParsedSkillTier(label="Lone Wolf", threshold=10, description="Solo buff."),
    )


def test_skips_a_baseline_row_with_no_real_tier() -> None:
    # Adrenaline's group-opening row has an empty (just <br>) points cell --
    # it describes the no-bonus baseline, not a tier, and must not become a
    # spurious zero-threshold tier.
    adrenaline = _group(parse_skill_tier_table(_fixture_html()), "Adrenaline")

    assert not any(t.label == "" for t in adrenaline.tiers)


def test_skips_tiers_whose_points_cell_has_an_ambiguous_br_separated_value() -> None:
    # "15<br>|<br>20" and "10<br>21" are two glued-together values, not one
    # number -- naive text extraction would wrongly read them as "15|20" or
    # "1021". Every tier row in this group has this problem, so none survive.
    adrenaline = _group(parse_skill_tier_table(_fixture_html()), "Adrenaline")

    assert adrenaline.tiers == ()


def test_does_not_leak_rows_from_a_nested_table_inside_a_description_cell() -> None:
    # Guard's baseline description embeds a hidden <table> (per-weapon-type
    # knockback info) with its own <tr>/<td class="t"> rows. Those must not
    # be picked up as sibling skill-group or tier rows.
    groups = parse_skill_tier_table(_fixture_html())

    assert not any(g.name in {"SnS", "Weapon type"} for g in groups)
    guard = _group(groups, "Guard")
    assert guard.tiers == (
        ParsedSkillTier(label="Guard+2", threshold=20, description="Large guard window."),
        ParsedSkillTier(label="Guard+1", threshold=10, description="Guard window."),
    )


def test_returns_an_empty_list_when_the_skills_base_table_is_missing() -> None:
    assert parse_skill_tier_table("<html><body>no table here</body></html>") == []


def test_returns_an_empty_list_when_the_table_has_no_tbody() -> None:
    assert parse_skill_tier_table('<table id="skills_base"></table>') == []


def test_skips_a_row_whose_label_cell_is_empty() -> None:
    html = """
    <table id="skills_base"><tbody id="skills_base">
      <tr class="l"><td class="g">Lone Wolf</td><td class="g"></td>
        <td class="t"></td><td class="n">10</td><td class="b">desc</td></tr>
    </tbody></table>
    """
    groups = parse_skill_tier_table(html)

    assert groups == [ParsedSkillGroup(name="Lone Wolf", section="", tiers=())]


def test_skips_a_row_missing_a_label_or_points_cell() -> None:
    # A separator row (`<tr class="sep"></tr>`) has neither -- it must be
    # silently ignored, not mistaken for a tier.
    html = """
    <table id="skills_base"><tbody id="skills_base">
      <tr class="l"><td class="g">Lone Wolf</td><td class="g"></td>
        <td class="t">Lone Wolf</td><td class="n">10</td><td class="b">desc</td></tr>
      <tr class="sep"></tr>
    </tbody></table>
    """
    groups = parse_skill_tier_table(html)

    assert len(groups) == 1
    assert groups[0].tiers == (
        ParsedSkillTier(label="Lone Wolf", threshold=10, description="desc"),
    )


def test_skips_a_tier_whose_points_cell_is_non_numeric_text() -> None:
    # "SnS Tech (Master)"'s points cell reads "Both Hiden" -- descriptive
    # text, not a point threshold -- while its sibling tiers are ordinary
    # numbers (including negative) and must still come through.
    sns_tech = _group(parse_skill_tier_table(_fixture_html()), "SnS Tech")

    assert sns_tech.tiers == (
        ParsedSkillTier(label="Sword Saint", threshold=30, description="Top numeric tier."),
        ParsedSkillTier(label="SnS Tech (Expert)", threshold=10, description="Mid tier."),
        ParsedSkillTier(label="SnS Tech (Novice)", threshold=-10, description="Penalty tier."),
    )
