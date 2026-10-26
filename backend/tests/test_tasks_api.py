from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import ClientFactory

SUMMARY = {"type": "text_summary", "text": "PixelGPU schedules work across GPUs. " * 3}


def submit(client: TestClient, workload: dict[str, Any], **extra: Any) -> Any:
    response = client.post("/api/tasks", json={"workload": workload, **extra})
    assert response.status_code == 201, response.text
    return response.json()


def test_create_returns_the_queued_task(client: TestClient) -> None:
    task = submit(client, SUMMARY, prompt="Summarize our intro")

    assert task["id"].startswith("task_")
    assert task["status"] == "queued"
    assert task["queue_position"] == 1
    assert task["prompt"] == "Summarize our intro"
    assert task["workload"] == {**SUMMARY, "max_sentences": 3}
    assert task["min_memory_mb"] == 2048
    assert task["assigned_gpu_id"] is None
    assert task["scheduler_decision"] is None


def test_tasks_survive_an_app_restart(make_client: ClientFactory) -> None:
    created = submit(make_client(), {"type": "echo", "message": "still here"})

    restarted = make_client()  # new app, same database file
    listed = restarted.get("/api/tasks").json()

    assert [t["id"] for t in listed["tasks"]] == [created["id"]]
    assert restarted.get(f"/api/tasks/{created['id']}").json()["status"] == "queued"


def test_detail_includes_lifecycle_events(client: TestClient) -> None:
    task = submit(client, {"type": "echo", "message": "hi"})

    detail = client.get(f"/api/tasks/{task['id']}").json()

    assert detail["events"] == [
        {
            "id": detail["events"][0]["id"],
            "timestamp": detail["events"][0]["timestamp"],
            "kind": "status",
            "level": "info",
            "message": "Task accepted and queued.",
            "from_status": None,
            "to_status": "queued",
            "data": {"workload_type": "echo", "min_memory_mb": 512},
        }
    ]


def test_list_newest_first_with_queue_positions_and_filter(client: TestClient) -> None:
    ids = [submit(client, {"type": "echo", "message": str(i)})["id"] for i in range(3)]
    client.post(f"/api/tasks/{ids[1]}/cancel")

    listed = client.get("/api/tasks").json()
    assert [t["id"] for t in listed["tasks"]] == ids[::-1]
    assert [t["queue_position"] for t in listed["tasks"]] == [2, None, 1]
    assert listed["total"] == 3

    queued = client.get("/api/tasks", params={"status": "queued", "limit": 1}).json()
    assert [t["id"] for t in queued["tasks"]] == [ids[2]]
    assert queued["total"] == 2


def test_unsupported_workload_is_rejected_clearly(client: TestClient) -> None:
    response = client.post("/api/tasks", json={"workload": {"type": "shell", "cmd": "ls"}})

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "unsupported_workload"
    assert error["message"] == (
        "Workload type 'shell' is not supported. "
        "Supported types: echo, text_summary, sample_inference, benchmark."
    )


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"workload": {"type": "echo", "message": ""}}, "workload.message"),
        ({"workload": {"type": "echo", "message": "hi", "gpu": "GPU-01"}}, "workload.gpu"),
        ({"workload": {"type": "text_summary", "text": "short"}}, "workload.text"),
        ({"workload": {"type": "benchmark", "matrix_size": 3}}, "workload.matrix_size"),
        ({"workload": {"type": "echo", "message": "hi"}, "prompt": "x" * 2001}, "prompt"),
        (
            {"workload": {"type": "echo", "message": "hi"}, "resources": {"min_memory_mb": 10**9}},
            "resources.min_memory_mb",
        ),
        ({"workload": {"type": "echo", "message": "hi"}, "status": "succeeded"}, "status"),
        (
            {"workload": {"type": "echo", "message": "hi"}, "assigned_gpu_id": "GPU-01"},
            "assigned_gpu_id",
        ),
        ({}, "workload"),
    ],
)
def test_invalid_requests_name_the_bad_field(
    client: TestClient, body: dict[str, Any], field: str
) -> None:
    response = client.post("/api/tasks", json=body)

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert field in [d["field"] for d in error["details"]]
    assert client.get("/api/tasks").json()["total"] == 0


def test_cancel_queued_task(client: TestClient) -> None:
    task = submit(client, {"type": "benchmark"})

    response = client.post(f"/api/tasks/{task['id']}/cancel")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "cancelled"
    assert body["queue_position"] is None
    assert body["error"] == {"code": "cancelled", "message": "Cancelled by user."}


def test_cancelling_twice_is_a_conflict(client: TestClient) -> None:
    task = submit(client, {"type": "benchmark"})
    client.post(f"/api/tasks/{task['id']}/cancel")

    response = client.post(f"/api/tasks/{task['id']}/cancel")

    assert response.status_code == 409
    assert response.json()["error"] == {
        "code": "invalid_transition",
        "message": "Task is already cancelled and cannot be cancelled.",
        "details": [],
    }


def test_unknown_task_is_404(client: TestClient) -> None:
    for response in (
        client.get("/api/tasks/task_nope"),
        client.post("/api/tasks/task_nope/cancel"),
    ):
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"


def test_active_task_limit_returns_429(make_client: ClientFactory) -> None:
    client = make_client(max_active_tasks=2)
    submit(client, {"type": "benchmark"})
    submit(client, {"type": "benchmark"})

    response = client.post("/api/tasks", json={"workload": {"type": "benchmark"}})

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "too_many_active_tasks"


def test_there_is_no_endpoint_to_set_status(client: TestClient) -> None:
    task = submit(client, {"type": "echo", "message": "hi"})

    for method in ("put", "patch"):
        response = client.request(method, f"/api/tasks/{task['id']}", json={"status": "running"})
        assert response.status_code == 405
    assert client.get(f"/api/tasks/{task['id']}").json()["status"] == "queued"


def test_workload_catalog(client: TestClient) -> None:
    catalog = client.get("/api/workloads").json()

    assert [w["type"] for w in catalog] == ["echo", "text_summary", "sample_inference", "benchmark"]
    assert all(w["label"] and w["config_schema"] for w in catalog)
