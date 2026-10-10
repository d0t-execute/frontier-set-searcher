import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest

from etl.db.connection import connect


@pytest.fixture
def conn(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    connection = connect(tmp_path / "test.sqlite3")
    try:
        yield connection
    finally:
        connection.close()
