import pytest

from etl.parse.js_extract import extract_balanced


def test_extracts_a_balanced_object() -> None:
    source = 'noise before foo("x", {"a":1,"b":2}) noise after'
    assert extract_balanced(source, 'foo("x", ') == '{"a":1,"b":2}'


def test_extracts_a_balanced_array() -> None:
    source = 'foo("x", [1,2,[3,4],5]) trailing'
    assert extract_balanced(source, 'foo("x", ') == "[1,2,[3,4],5]"


def test_ignores_brackets_inside_string_literals() -> None:
    source = 'foo({"a":"} not a close {","b":2})'
    assert extract_balanced(source, "foo(") == '{"a":"} not a close {","b":2}'


def test_handles_escaped_quotes_inside_strings() -> None:
    source = r'foo({"a":"she said \"hi\""})'
    assert extract_balanced(source, "foo(") == r'{"a":"she said \"hi\""}'


def test_raises_when_marker_is_missing() -> None:
    with pytest.raises(ValueError, match="marker not found"):
        extract_balanced("no marker here", "missing(")


def test_raises_when_brackets_never_close() -> None:
    with pytest.raises(ValueError, match="unbalanced"):
        extract_balanced('foo({"a":1', "foo(")


def test_raises_when_no_opening_bracket_follows_the_marker() -> None:
    with pytest.raises(ValueError, match="no opening brace/bracket"):
        extract_balanced("foo(no brackets here", "foo(")
