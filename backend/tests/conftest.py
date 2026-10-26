from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from pixelgpu.config import Settings
from pixelgpu.main import create_app

ClientFactory = Callable[..., TestClient]


@pytest.fixture
def make_client() -> ClientFactory:
    def factory(**overrides: object) -> TestClient:
        return TestClient(create_app(Settings(environment="test", **overrides)))  # type: ignore[arg-type]

    return factory


@pytest.fixture
def client(make_client: ClientFactory) -> TestClient:
    return make_client()
