from datetime import datetime

from fastapi.testclient import TestClient

from pixelgpu import __version__
from tests.conftest import ClientFactory


def test_health_returns_ok(client: TestClient) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "pixelgpu-backend"
    assert body["version"] == __version__
    assert body["environment"] == "test"
    assert datetime.fromisoformat(body["server_time"]).tzinfo is not None


def test_openapi_schema_is_served_under_api_prefix(client: TestClient) -> None:
    response = client.get("/api/openapi.json")

    assert response.status_code == 200
    assert "/api/health" in response.json()["paths"]


def test_unknown_route_returns_404(client: TestClient) -> None:
    assert client.get("/api/does-not-exist").status_code == 404


def test_cors_disabled_by_default(client: TestClient) -> None:
    response = client.get("/api/health", headers={"Origin": "http://evil.example"})

    assert "access-control-allow-origin" not in response.headers


def test_cors_allows_configured_origin(make_client: ClientFactory) -> None:
    client = make_client(cors_origins=["http://localhost:4173"])
    response = client.get("/api/health", headers={"Origin": "http://localhost:4173"})

    assert response.headers["access-control-allow-origin"] == "http://localhost:4173"
