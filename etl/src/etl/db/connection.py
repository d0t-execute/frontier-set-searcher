"""Connection management for the ETL staging database."""

from __future__ import annotations

import sqlite3
from pathlib import Path

_SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"


def connect(path: str | Path) -> sqlite3.Connection:
    """Open a SQLite connection with foreign keys enforced and the schema applied.

    Safe to call against an existing database file — every statement in
    schema.sql is idempotent, so this never wipes existing data.
    """
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(_SCHEMA_PATH.read_text(encoding="utf-8"))
    conn.commit()
    return conn
