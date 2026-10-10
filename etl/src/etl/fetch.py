"""Thin, polite HTTP fetch layer with on-disk caching (docs/PLAN.md Phase 2).

We're fetching a handful of large static files from the source site, not
scraping thousands of pages — but we still cache the raw bytes to disk and
send conditional requests (If-None-Match / If-Modified-Since) using the
cached ETag/Last-Modified, so re-running the pipeline doesn't re-download
unchanged files.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from types import TracebackType

import httpx

DEFAULT_USER_AGENT = (
    "FrontierSetSearcher-ETL/0.1 (+https://github.com/d0t-execute/frontier-set-searcher)"
)


@dataclass(frozen=True, slots=True)
class FetchResult:
    content: str
    from_cache: bool


class CachingFetcher:
    """Fetches a URL to text, caching the body and revalidation headers on disk."""

    def __init__(self, cache_dir: Path, *, client: httpx.Client | None = None) -> None:
        self._cache_dir = cache_dir
        self._client = client if client is not None else httpx.Client()
        self._owns_client = client is None

    def __enter__(self) -> CachingFetcher:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.close()

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def fetch(self, url: str, *, cache_key: str) -> FetchResult:
        self._cache_dir.mkdir(parents=True, exist_ok=True)
        body_path = self._cache_dir / f"{cache_key}.body"
        meta_path = self._cache_dir / f"{cache_key}.meta.json"

        headers = {"User-Agent": DEFAULT_USER_AGENT}
        cached_meta = _read_meta(meta_path)
        if cached_meta.get("etag"):
            headers["If-None-Match"] = cached_meta["etag"]
        if cached_meta.get("last_modified"):
            headers["If-Modified-Since"] = cached_meta["last_modified"]

        response = self._client.get(url, headers=headers)

        if response.status_code == 304 and body_path.exists():
            return FetchResult(content=body_path.read_text(encoding="utf-8"), from_cache=True)

        response.raise_for_status()
        body_path.write_text(response.text, encoding="utf-8")
        _write_meta(
            meta_path,
            {
                "etag": response.headers.get("ETag", ""),
                "last_modified": response.headers.get("Last-Modified", ""),
            },
        )
        return FetchResult(content=response.text, from_cache=False)


def _read_meta(meta_path: Path) -> dict[str, str]:
    if not meta_path.exists():
        return {}
    data: dict[str, str] = json.loads(meta_path.read_text(encoding="utf-8"))
    return data


def _write_meta(meta_path: Path, meta: dict[str, str]) -> None:
    meta_path.write_text(json.dumps(meta), encoding="utf-8")
