from collections.abc import Callable, Iterator
from contextlib import ExitStack
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pixelgpu.config import Settings
from pixelgpu.main import create_app

ClientFactory = Callable[..., TestClient]


@pytest.fixture
def database_url(tmp_path: Path) -> str:
    return f"sqlite:///{tmp_path / 'test.db'}"


@pytest.fixture
def make_client(database_url: str) -> Iterator[ClientFactory]:
    """Build clients with their own settings. Each runs the app lifespan (migrations).

    The scheduler is off by default so API tests see tasks exactly as submitted;
    scheduler tests turn it on or drive it directly.
    """
    with ExitStack() as stack:

        def factory(**overrides: object) -> TestClient:
            fields: dict[str, object] = {
                "environment": "test",
                "database_url": database_url,
                "scheduler_enabled": False,
            }
            fields.update(overrides)
            app = create_app(Settings.model_validate(fields))
            return stack.enter_context(TestClient(app))

        yield factory


@pytest.fixture
def client(make_client: ClientFactory) -> TestClient:
    return make_client()
