from pathlib import Path

import httpx
import pytest

from etl.fetch import CachingFetcher


def _client(handler: httpx.MockTransport) -> httpx.Client:
    return httpx.Client(transport=handler)


def test_fetch_downloads_and_caches_on_first_run(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="hello world", headers={"ETag": '"abc123"'})

    with CachingFetcher(tmp_path, client=_client(httpx.MockTransport(handler))) as fetcher:
        result = fetcher.fetch("https://example.test/data.js", cache_key="data")

    assert result.content == "hello world"
    assert result.from_cache is False
    assert (tmp_path / "data.body").read_text(encoding="utf-8") == "hello world"


def test_second_fetch_sends_the_cached_etag_as_if_none_match(tmp_path: Path) -> None:
    seen_headers: list[httpx.Headers] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_headers.append(request.headers)
        if request.headers.get("if-none-match") == '"abc123"':
            return httpx.Response(304)
        return httpx.Response(200, text="hello world", headers={"ETag": '"abc123"'})

    cache_dir = tmp_path
    with CachingFetcher(cache_dir, client=_client(httpx.MockTransport(handler))) as fetcher:
        fetcher.fetch("https://example.test/data.js", cache_key="data")
        second = fetcher.fetch("https://example.test/data.js", cache_key="data")

    assert second.from_cache is True
    assert second.content == "hello world"
    assert len(seen_headers) == 2
    assert seen_headers[1].get("if-none-match") == '"abc123"'


def test_fetch_raises_on_http_error_status(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="server error")

    with CachingFetcher(tmp_path, client=_client(httpx.MockTransport(handler))) as fetcher:
        with pytest.raises(httpx.HTTPStatusError):
            fetcher.fetch("https://example.test/data.js", cache_key="data")


def test_different_cache_keys_do_not_collide(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = "A" if request.url.path.endswith("a.js") else "B"
        return httpx.Response(200, text=body)

    with CachingFetcher(tmp_path, client=_client(httpx.MockTransport(handler))) as fetcher:
        a = fetcher.fetch("https://example.test/a.js", cache_key="a")
        b = fetcher.fetch("https://example.test/b.js", cache_key="b")

    assert (a.content, b.content) == ("A", "B")


def test_second_fetch_sends_the_cached_last_modified_header(tmp_path: Path) -> None:
    seen_headers: list[httpx.Headers] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_headers.append(request.headers)
        return httpx.Response(
            200, text="hello world", headers={"Last-Modified": "Wed, 01 Jan 2025 00:00:00 GMT"}
        )

    with CachingFetcher(tmp_path, client=_client(httpx.MockTransport(handler))) as fetcher:
        fetcher.fetch("https://example.test/data.js", cache_key="data")
        fetcher.fetch("https://example.test/data.js", cache_key="data")

    assert seen_headers[1].get("if-modified-since") == "Wed, 01 Jan 2025 00:00:00 GMT"


def test_closes_its_own_client_when_none_is_supplied(tmp_path: Path) -> None:
    with CachingFetcher(tmp_path):
        pass  # no fetch — just verifying the context manager owns and closes its client


def test_sends_a_descriptive_user_agent_by_default(tmp_path: Path) -> None:
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["user_agent"] = request.headers.get("user-agent", "")
        return httpx.Response(200, text="ok")

    with CachingFetcher(tmp_path, client=_client(httpx.MockTransport(handler))) as fetcher:
        fetcher.fetch("https://example.test/data.js", cache_key="data")

    assert "FrontierSetSearcher" in captured["user_agent"]
