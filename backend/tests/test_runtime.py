"""End-to-end through the API with the real scheduler loop and worker threads."""

import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from pixelgpu.db import create_db_engine, create_session_factory
from pixelgpu.scheduling.models import GpuReservation
from pixelgpu.tasks.lifecycle import TaskStatus
from pixelgpu.tasks.service import TaskService
from tests.conftest import ClientFactory

TERMINAL = {"succeeded", "failed", "cancelled"}


def wait_for(predicate: Callable[[], bool], timeout: float = 10.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.02)
    raise AssertionError("condition not met in time")


@pytest.fixture
def live(make_client: ClientFactory) -> TestClient:
    return make_client(
        scheduler_enabled=True, simulation_speed=200, scheduler_interval_seconds=0.05
    )


def submit(client: TestClient, workload: dict[str, Any], **extra: Any) -> str:
    response = client.post("/api/tasks", json={"workload": workload, **extra})
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


def get(client: TestClient, task_id: str) -> Any:
    return client.get(f"/api/tasks/{task_id}").json()


def test_tasks_run_to_completion_and_free_their_gpus(live: TestClient) -> None:
    ids = [submit(live, {"type": "echo", "message": f"job {i}"}) for i in range(6)]

    wait_for(lambda: all(get(live, i)["status"] in TERMINAL for i in ids))

    for task_id in ids:
        task = get(live, task_id)
        assert task["status"] == "succeeded"
        assert task["result"]["execution_mode"] == "simulated"
        assert task["progress"] == 1.0
        assert task["assigned_gpu_id"] in {"GPU-01", "GPU-02", "GPU-03", "GPU-05"}
        statuses = [e["to_status"] for e in task["events"] if e["kind"] == "status"]
        assert statuses == ["queued", "scheduled", "running", "succeeded"]
    gpus = live.get("/api/gpus").json()
    assert {g["id"]: g["activity"] for g in gpus} == {f"GPU-0{i}": "idle" for i in range(1, 7)}
    assert all(g["current_task_id"] is None for g in gpus)


def test_a_running_task_shows_on_its_gpu(live: TestClient) -> None:
    task_id = submit(live, {"type": "benchmark", "duration_seconds": 120})

    wait_for(lambda: get(live, task_id)["status"] == "running")
    gpu_id = get(live, task_id)["assigned_gpu_id"]
    gpu = live.get(f"/api/gpus/{gpu_id}").json()

    assert gpu["activity"] == "running"
    assert gpu["current_task_id"] == task_id
    assert gpu["schedulable"] is False
    assert gpu["memory_used"] == {
        "value": 4096,
        "unit": "MiB",
        "source": "simulated",
        "updated_at": None,
        "note": "Simulated: equal to the reserved task's memory requirement.",
    }
    history = live.get("/api/tasks", params={"gpu_id": gpu_id}).json()
    assert [t["id"] for t in history["tasks"]] == [task_id]

    live.post(f"/api/tasks/{task_id}/cancel")
    wait_for(lambda: get(live, task_id)["status"] == "cancelled")
    assert live.get(f"/api/gpus/{gpu_id}").json()["activity"] == "idle"


def test_failures_and_impossible_requests_are_explained(live: TestClient) -> None:
    failing = submit(live, {"type": "echo", "message": "fail: simulated crash"})
    impossible = submit(live, {"type": "echo", "message": "hi"}, resources={"min_memory_mb": 65536})

    wait_for(lambda: get(live, failing)["status"] in TERMINAL)
    wait_for(lambda: get(live, impossible)["status"] in TERMINAL)

    assert get(live, failing)["error"] == {"code": "workload_failed", "message": "simulated crash"}
    rejected = get(live, impossible)
    assert rejected["status"] == "failed"
    assert rejected["error"]["code"] == "unschedulable"
    assert rejected["error"]["message"].startswith(
        "No GPU satisfies the 64 GiB memory requirement."
    )
    assert rejected["scheduler_decision"]["outcome"] == "unschedulable"


def test_the_queue_drains_as_gpus_free_up(live: TestClient) -> None:
    ids = [submit(live, {"type": "echo", "message": str(i)}) for i in range(10)]

    wait_for(lambda: all(get(live, i)["status"] == "succeeded" for i in ids), timeout=20)

    used = {get(live, i)["assigned_gpu_id"] for i in ids}
    assert used <= {"GPU-01", "GPU-02", "GPU-03", "GPU-05"}


def test_startup_fails_tasks_left_running_by_a_previous_process(
    make_client: ClientFactory, database_url: str
) -> None:
    before = make_client()  # scheduler off: we place the task by hand
    task_id = submit(before, {"type": "echo", "message": "orphaned"})
    engine = create_db_engine(database_url)
    with create_session_factory(engine)() as session:
        session.add(
            GpuReservation(
                gpu_id="GPU-01",
                task_id=task_id,
                worker_id="sim-worker-a",
                reserved_at=datetime.now(UTC),
            )
        )
        session.commit()
        service = TaskService(session, max_active_tasks=0)
        service.transition(task_id, TaskStatus.SCHEDULED, message="s", assigned_gpu_id="GPU-01")
        service.transition(task_id, TaskStatus.RUNNING, message="r")
    engine.dispose()

    after = make_client(scheduler_enabled=True)  # a new process starting up

    task = get(after, task_id)
    assert task["status"] == "failed"
    assert task["error"]["code"] == "worker_lost"
    assert after.get("/api/gpus/GPU-01").json()["activity"] == "idle"
