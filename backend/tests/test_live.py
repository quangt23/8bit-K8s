import asyncio
import time
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from pixelgpu.db import create_db_engine, create_session_factory
from pixelgpu.fleet.registry import FleetRegistry
from pixelgpu.fleet.simulated import build_simulated_fleet
from pixelgpu.live.broadcaster import CLIENT_QUEUE_SIZE, DISCONNECT, LiveBroadcaster
from pixelgpu.live.metrics import compute_metrics
from pixelgpu.tasks.lifecycle import TaskStatus
from pixelgpu.tasks.schemas import TaskCreate
from pixelgpu.tasks.service import TaskService
from tests.conftest import ClientFactory

ECHO = {"workload": {"type": "echo", "message": "hi"}}


def submit(client: TestClient, body: dict[str, Any] = ECHO) -> str:
    response = client.post("/api/tasks", json=body)
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


# ----- snapshot -----


def test_snapshot_has_everything_the_control_room_shows(client: TestClient) -> None:
    task_id = submit(client)

    snap = client.get("/api/live/snapshot").json()

    assert [g["id"] for g in snap["fleet"]["gpus"]] == [f"GPU-0{i}" for i in range(1, 7)]
    assert [t["id"] for t in snap["tasks"]] == [task_id]
    assert snap["tasks"][0]["queue_position"] == 1
    assert snap["total_tasks"] == 1
    assert snap["metrics"]["tasks_by_status"]["queued"] == 1
    assert [e["task_id"] for e in snap["events"]] == [task_id]
    assert snap["latest_event_id"] == snap["events"][-1]["id"]
    assert snap["events_truncated"] is False
    assert snap["revision"] >= 0


def test_snapshot_always_includes_active_tasks(make_client: ClientFactory) -> None:
    client = make_client(max_active_tasks=500)
    old_active = submit(client)
    for _ in range(60):
        client.post(f"/api/tasks/{submit(client)}/cancel")

    snap = client.get("/api/live/snapshot").json()

    ids = [t["id"] for t in snap["tasks"]]
    assert old_active in ids  # older than the 50 most recent, but still queued
    assert len(ids) == 51
    assert snap["total_tasks"] == 61


def test_snapshot_feed_only_returns_events_after_the_cursor(client: TestClient) -> None:
    first = submit(client)
    cursor = client.get("/api/live/snapshot").json()["latest_event_id"]
    second = submit(client)

    snap = client.get("/api/live/snapshot", params={"events_after": cursor}).json()

    assert [e["task_id"] for e in snap["events"]] == [second]
    assert first != second


# ----- feed -----


def test_feed_pages_cover_every_event_exactly_once(client: TestClient) -> None:
    ids = [submit(client) for _ in range(4)]
    client.post(f"/api/tasks/{ids[0]}/cancel")

    seen: list[int] = []
    after = 0
    while True:
        page = client.get("/api/events", params={"after": after, "limit": 2}).json()
        seen += [e["id"] for e in page["events"]]
        if not page["truncated"]:
            break
        after = page["events"][-1]["id"]

    assert seen == sorted(set(seen))
    assert len(seen) == 5  # four "queued" + one "cancelled"
    assert seen[-1] == page["latest_event_id"]


def test_feed_events_carry_task_context(client: TestClient) -> None:
    task_id = submit(client, {"workload": {"type": "benchmark"}})

    event = client.get("/api/events", params={"after": 0}).json()["events"][0]

    assert event["task_id"] == task_id
    assert event["workload_type"] == "benchmark"
    assert event["to_status"] == "queued"
    assert event["gpu_id"] is None


# ----- metrics -----


def test_metrics(database_url: str, client: TestClient) -> None:
    engine = create_db_engine(database_url)
    t0 = datetime(2026, 10, 25, 12, 0, tzinfo=UTC)
    clock_time = [t0]

    def clock() -> datetime:
        return clock_time[0]

    def at(seconds: float) -> None:
        clock_time[0] = t0 + timedelta(seconds=seconds)

    with create_session_factory(engine)() as session:
        service = TaskService(session, max_active_tasks=100, clock=clock)
        body = TaskCreate.model_validate(ECHO)
        # Two succeed (waits 2 s and 4 s; runs 10 s and 20 s), one fails, one is cancelled.
        runs = [
            (2, 10, TaskStatus.SUCCEEDED),
            (4, 20, TaskStatus.SUCCEEDED),
            (6, 30, TaskStatus.FAILED),
        ]
        for wait, run, final in runs:
            at(0)
            task = service.create(body)
            at(wait)
            service.transition(task.id, TaskStatus.SCHEDULED, message="s")
            service.transition(task.id, TaskStatus.RUNNING, message="r")
            at(wait + run)
            service.transition(task.id, final, message="done")
        at(0)
        service.cancel(service.create(body).id)
        service.create(body)  # still queued

        gpus = FleetRegistry(*build_simulated_fleet()).list_gpus()
        metrics = compute_metrics(session, gpus, now=t0 + timedelta(minutes=1))
    engine.dispose()

    assert metrics.tasks_by_status == {
        "queued": 1,
        "scheduled": 0,
        "running": 0,
        "succeeded": 2,
        "failed": 1,
        "cancelled": 1,
    }
    assert metrics.gpus.model_dump() == {"total": 6, "healthy": 4, "allocated": 0}
    assert metrics.recent.sample_size == 4
    assert metrics.recent.success_rate == pytest.approx(2 / 3, abs=1e-3)  # cancelled excluded
    assert metrics.recent.median_queue_wait_seconds == 4
    assert metrics.recent.median_run_seconds == 20
    assert metrics.finished_last_5_minutes == 4


def test_metrics_endpoint(client: TestClient) -> None:
    submit(client)
    body = client.get("/api/metrics").json()

    assert body["tasks_by_status"]["queued"] == 1
    assert body["recent"]["success_rate"] is None


# ----- websocket -----


def receive_until(ws: Any, predicate: Any, limit: int = 200) -> list[dict[str, Any]]:
    messages = []
    for _ in range(limit):
        message = ws.receive_json()
        messages.append(message)
        if predicate(message):
            return messages
    raise AssertionError(f"no matching message in {messages}")


def test_websocket_says_hello_then_announces_changes(client: TestClient) -> None:
    with client.websocket_connect("/api/live") as ws:
        hello = ws.receive_json()
        assert hello["type"] == "hello"

        task_id = submit(client)
        changed = ws.receive_json()

    assert changed == {"type": "changed", "revision": hello["revision"] + 1}
    snap = client.get("/api/live/snapshot").json()
    assert snap["revision"] >= changed["revision"]
    assert task_id in [t["id"] for t in snap["tasks"]]


def test_bursts_of_commits_are_coalesced(client: TestClient) -> None:
    with client.websocket_connect("/api/live") as ws:
        ws.receive_json()
        for _ in range(15):
            submit(client)
        time.sleep(0.3)
        revision = client.get("/api/live/snapshot").json()["revision"]
        messages = receive_until(ws, lambda m: m.get("revision") == revision)

    assert all(m["type"] == "changed" for m in messages)
    assert len(messages) < 15
    assert [m["revision"] for m in messages] == sorted({m["revision"] for m in messages})


def test_changes_from_worker_threads_are_announced(make_client: ClientFactory) -> None:
    # Speed 5: the 2 s echo takes ~0.4 s, spanning many 50 ms debounce windows.
    client = make_client(
        scheduler_enabled=True, simulation_speed=5, scheduler_interval_seconds=0.05
    )
    with client.websocket_connect("/api/live") as ws:
        ws.receive_json()
        task_id = submit(client)

        def finished(_: dict[str, Any]) -> bool:
            return client.get(f"/api/tasks/{task_id}").json()["status"] == "succeeded"

        messages = receive_until(ws, finished)

    # The API's commit and the worker thread's later commits were announced separately.
    assert len(messages) >= 3


def test_reconnecting_gets_a_fresh_hello(client: TestClient) -> None:
    with client.websocket_connect("/api/live") as ws:
        first = ws.receive_json()
        submit(client)
        ws.receive_json()

    with client.websocket_connect("/api/live") as ws:
        second = ws.receive_json()

    assert second["type"] == "hello"
    assert second["revision"] > first["revision"]


def test_a_client_that_stops_reading_is_disconnected() -> None:
    async def scenario() -> tuple[bool, dict[str, Any]]:
        broadcaster = LiveBroadcaster(debounce_seconds=0)
        await broadcaster.start()
        queue = broadcaster.subscribe()
        for _ in range(CLIENT_QUEUE_SIZE + 1):
            broadcaster.notify()
            await asyncio.sleep(0.005)
        await asyncio.sleep(0.02)
        message = queue.get_nowait()
        dropped = broadcaster.client_count == 0
        await broadcaster.stop()
        return dropped, message

    dropped, message = asyncio.run(scenario())

    assert dropped
    assert message is DISCONNECT


def test_notify_before_start_is_harmless() -> None:
    LiveBroadcaster().notify()
