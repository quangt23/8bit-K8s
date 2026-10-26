from fastapi.testclient import TestClient

from tests.conftest import ClientFactory


def test_fleet_snapshot_contains_simulated_workers_and_gpus(client: TestClient) -> None:
    body = client.get("/api/fleet").json()

    assert [w["id"] for w in body["workers"]] == ["sim-worker-a", "sim-worker-b"]
    assert [g["id"] for g in body["gpus"]] == [f"GPU-0{i}" for i in range(1, 7)]
    assert body["generated_at"]


def test_every_device_is_labelled_simulated(client: TestClient) -> None:
    gpus = client.get("/api/gpus").json()
    workers = client.get("/api/workers").json()

    assert {g["execution_mode"] for g in gpus} == {"simulated"}
    assert {w["execution_mode"] for w in workers} == {"simulated"}


def test_no_telemetry_is_reported_as_measured(client: TestClient) -> None:
    for gpu in client.get("/api/gpus").json():
        for metric in (gpu["memory_used"], gpu["utilization"]):
            assert metric["source"] in {"simulated", "unavailable"}
            if metric["source"] == "unavailable":
                assert metric["value"] is None
                assert metric["note"]


def test_utilization_is_unavailable_for_simulated_devices(client: TestClient) -> None:
    gpu = client.get("/api/gpus/GPU-01").json()

    assert gpu["utilization"] == {
        "value": None,
        "unit": "%",
        "source": "unavailable",
        "updated_at": None,
        "note": "Simulated workers do not model utilization.",
    }


def test_get_single_gpu(client: TestClient) -> None:
    gpu = client.get("/api/gpus/GPU-02").json()

    assert gpu["name"] == "PixelSim 24G"
    assert gpu["worker_id"] == "sim-worker-a"
    assert gpu["location"] == {"rack": "A", "slot": 2}
    assert gpu["memory_total_mb"] == 24 * 1024
    assert gpu["memory_used"]["value"] == 0
    assert gpu["memory_used"]["source"] == "simulated"
    assert gpu["health"] == "healthy"
    assert gpu["activity"] == "idle"
    assert gpu["current_task_id"] is None
    assert gpu["schedulable"] is True
    assert gpu["unschedulable_reason"] is None


def test_unknown_gpu_returns_404(client: TestClient) -> None:
    response = client.get("/api/gpus/GPU-99")

    assert response.status_code == 404
    assert response.json() == {
        "error": {"code": "not_found", "message": "GPU 'GPU-99' not found.", "details": []}
    }


def test_unhealthy_devices_explain_why_they_are_unschedulable(client: TestClient) -> None:
    errored = client.get("/api/gpus/GPU-04").json()
    offline = client.get("/api/gpus/GPU-06").json()

    assert errored["health"] == "error"
    assert errored["schedulable"] is False
    assert errored["unschedulable_reason"] == "Device is reporting an error."
    assert "self-test" in errored["health_reason"]

    assert offline["health"] == "offline"
    assert offline["schedulable"] is False
    assert offline["memory_used"]["source"] == "unavailable"


def test_worker_gpu_ids_match_devices(client: TestClient) -> None:
    gpus = {g["id"]: g for g in client.get("/api/gpus").json()}

    for worker in client.get("/api/workers").json():
        assert worker["last_heartbeat"] is None
        assert worker["supported_workloads"] == []
        for gpu_id in worker["gpu_ids"]:
            assert gpus[gpu_id]["worker_id"] == worker["id"]
            assert gpus[gpu_id]["location"]["rack"] == worker["rack"]


def test_fleet_can_be_disabled(make_client: ClientFactory) -> None:
    body = make_client(simulated_fleet=False).get("/api/fleet").json()

    assert body["workers"] == []
    assert body["gpus"] == []
