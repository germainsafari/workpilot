import asyncio
import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ["WORKPILOT_DATABASE_URL"] = "sqlite+aiosqlite:///./test-workpilot.db"
os.environ["WORKPILOT_AUTO_CREATE_SCHEMA"] = "true"
os.environ["WORKPILOT_SEED_DEMO_DATA"] = "true"
os.environ["WORKPILOT_EXECUTE_RUNS_INLINE"] = "true"
os.environ["WORKPILOT_LOCAL_AUTH_ENABLED"] = "true"

from app.db import engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    database = Path("test-workpilot.db")
    database.unlink(missing_ok=True)
    with TestClient(app) as test_client:
        yield test_client
    asyncio.run(engine.dispose())
    database.unlink(missing_ok=True)
