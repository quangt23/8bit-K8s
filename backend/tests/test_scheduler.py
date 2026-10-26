import threading
from collections.abc import Iterator
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from pixelgpu.db import create_db_engine, create_session_factory, upgrade_database
from pixelgpu.fleet.live import live_gpus
from pixelgpu.fleet.registry import FleetRegistry
from pixelgpu.fleet.simulated import build_simulated_fleet
from pixelgpu.runtime import recover_interrupted_tasks
from pixelgpu.scheduling.models import GpuReservation
from pixelgpu.scheduling.scheduler import Assignment, Scheduler
from pixelgpu.tasks.lifecycle import TaskStatus
from pixelgpu.tasks.models import TaskRecord
from pixelgpu.tasks.schemas import TaskCreate
from pixelgpu.tasks.service import TaskService
from pixelgpu.workers.simulated import SimulatedWorker
from tests.test_task_service import FakeClock

# Simulated fleet: GPU-01 24G, GPU-02 24G, GPU-03 16G, GPU-04 16G (error),
# GPU-05 8G, GPU-06 12G (offline). Healthy by best fit: 05, 03, 01, 02.


class RecordingDispatcher:
    def __init__(self) -> None:
        self.assignments: list[Assignment] = []
        self._lock = threading.Lock()

    def dispatch(self, assignment: Assignment) -> None:
        with self._lock:
            self.assignments.append(assignment)


@pytest.fixture
def factory(database_url: str) -> Iterator[sessionmaker[Session]]:
    upgrade_database(database_url)
    engine = create_db_engine(database_url)
    yield create_session_factory(engine)
    engine.dispose()


@pytest.fixture
def fleet() -> FleetRegistry:
    return FleetRegistry(*build_simulated_fleet())


@pytest.fixture
def dispatcher() -> RecordingDispatcher:
    return RecordingDispatcher()


@pytest.fixture
def scheduler(
    factory: sessionmaker[Session], fleet: FleetRegistry, dispatcher: RecordingDispatcher
) -> Scheduler:
    return Scheduler(factory, fleet, dispatcher, clock=FakeClock())


# One clock for all submissions, so tasks get distinct, increasing created_at values.
_submit_clock = FakeClock()
_submit_lock = threading.Lock()


def submit(
    factory: sessionmaker[Session], workload: dict[str, Any], memory_gb: int | None = None
) -> str:
    body: dict[str, Any] = {"workload": workload}
    if memory_gb is not None:
        body["resources"] = {"min_memory_mb": memory_gb * 1024}
    with _submit_lock:
        now = _submit_clock()
    with factory() as session:
        service = TaskService(session, max_active_tasks=1000, clock=lambda: now)
        return service.create(TaskCreate.model_validate(body)).id


def echo(factory: sessionmaker[Session], memory_gb: int | None = None) -> str:
    return submit(factory, {"type": "echo", "message": "hi"}, memory_gb)


def task(factory: sessionmaker[Session], task_id: str) -> TaskRecord:
    with factory() as session:
        return TaskService(session, max_active_tasks=0).get(task_id, with_events=True)


def reservations(factory: sessionmaker[Session]) -> dict[str, str]:
    with factory() as session:
        return {r.gpu_id: r.task_id for r in session.scalars(select(GpuReservation))}


def worker(factory: sessionmaker[Session], **kwargs: Any) -> SimulatedWorker:
    return SimulatedWorker("sim-worker-a", 4, factory, speed=1e6, timeout_seconds=600, **kwargs)


def test_a_task_is_reserved_on_the_best_fit_gpu_and_dispatched(
    factory: sessionmaker[Session],
    scheduler: Scheduler,
    dispatcher: RecordingDispatcher,
    fleet: FleetRegistry,
) -> None:
    task_id = echo(factory)

    scheduler.schedule_once()

    stored = task(factory, task_id)
    assert stored.status == "scheduled"
    assert (stored.assigned_gpu_id, stored.assigned_worker_id) == ("GPU-05", "sim-worker-b")
    assert reservations(factory) == {"GPU-05": task_id}
    assert dispatcher.assignments == [Assignment(task_id, "GPU-05", "sim-worker-b")]

    decision = stored.scheduler_decision
    assert decision is not None
    assert decision["outcome"] == "scheduled"
    assert decision["selected_gpu_id"] == "GPU-05"
    assert decision["policy"] == "best_fit_memory"
    rejected = {c["gpu_id"]: c["reason"] for c in decision["candidates"] if not c["eligible"]}
    assert rejected == {
        "GPU-04": (
            "Device is reporting an error: Simulated fault: device failed its startup self-test."
        ),
        "GPU-06": "Device is offline.",
    }
    assert stored.events[-1].message == decision["explanation"]

    with factory() as session:
        gpu = next(g for g in live_gpus(session, fleet) if g.id == "GPU-05")
    assert (gpu.activity, gpu.current_task_id, gpu.memory_used.value) == ("reserved", task_id, 512)


def test_gpus_fill_by_best_fit_then_tasks_wait(
    factory: sessionmaker[Session], scheduler: Scheduler
) -> None:
    ids = [echo(factory) for _ in range(5)]

    scheduler.schedule_once()
    scheduler.schedule_once()  # a second pass must not log the wait again

    assert [task(factory, i).assigned_gpu_id for i in ids] == [
        "GPU-05",
        "GPU-03",
        "GPU-01",
        "GPU-02",
        None,
    ]
    waiting = task(factory, ids[4])
    assert waiting.status == "queued"
    assert waiting.scheduler_decision is not None
    assert waiting.scheduler_decision["outcome"] == "waiting"
    assert waiting.scheduler_decision["explanation"] == (
        "Waiting for a GPU. The 6 GPUs that could run this are unavailable: "
        "4 busy, 1 reporting an error, 1 offline."
    )
    assert [e.level for e in waiting.events if e.kind == "log"] == ["warning"]


def test_impossible_requirements_fail_with_an_explanation(
    factory: sessionmaker[Session], scheduler: Scheduler
) -> None:
    task_id = echo(factory, memory_gb=48)

    scheduler.schedule_once()

    stored = task(factory, task_id)
    assert stored.status == "failed"
    assert stored.error == {
        "code": "unschedulable",
        "message": (
            "No GPU satisfies the 48 GiB memory requirement. "
            "The largest is 24 GiB (GPU-01, GPU-02)."
        ),
    }
    assert reservations(factory) == {}


def test_requirements_only_unhealthy_gpus_meet_keep_the_task_waiting(
    factory: sessionmaker[Session], scheduler: Scheduler
) -> None:
    blockers = [echo(factory, memory_gb=20) for _ in range(2)]  # take GPU-01 and GPU-02
    big = echo(factory, memory_gb=20)

    scheduler.schedule_once()

    assert {task(factory, b).assigned_gpu_id for b in blockers} == {"GPU-01", "GPU-02"}
    assert task(factory, big).status == "queued"


def test_smaller_tasks_backfill_around_a_waiting_large_task(
    factory: sessionmaker[Session], scheduler: Scheduler
) -> None:
    blockers = [echo(factory, memory_gb=20) for _ in range(2)]
    big = echo(factory, memory_gb=20)
    small = echo(factory)

    scheduler.schedule_once()

    assert task(factory, big).status == "queued"
    assert task(factory, small).assigned_gpu_id == "GPU-05"
    assert len(blockers) == 2


@pytest.mark.parametrize(
    ("workload", "final", "error_code"),
    [
        ({"type": "echo", "message": "done"}, "succeeded", None),
        ({"type": "echo", "message": "fail: simulated crash"}, "failed", "workload_failed"),
    ],
)
def test_finishing_releases_the_gpu(
    factory: sessionmaker[Session],
    scheduler: Scheduler,
    dispatcher: RecordingDispatcher,
    workload: dict[str, Any],
    final: str,
    error_code: str | None,
) -> None:
    task_id = submit(factory, workload)
    scheduler.schedule_once()

    worker(factory).execute(dispatcher.assignments[0])

    stored = task(factory, task_id)
    assert stored.status == final
    assert (stored.error or {}).get("code") == error_code
    assert reservations(factory) == {}
    statuses = [e.to_status for e in stored.events if e.kind == "status"]
    assert statuses == ["queued", "scheduled", "running", final]
    assert "Released GPU-05." in stored.events[-1].message


def test_cancelling_a_scheduled_task_releases_the_gpu_and_the_worker_skips_it(
    factory: sessionmaker[Session], scheduler: Scheduler, dispatcher: RecordingDispatcher
) -> None:
    task_id = echo(factory)
    scheduler.schedule_once()

    with factory() as session:
        TaskService(session, max_active_tasks=0).cancel(task_id)
    assert reservations(factory) == {}

    worker(factory).execute(dispatcher.assignments[0])
    assert task(factory, task_id).status == "cancelled"


def test_cancelling_a_running_task_stops_it_and_releases_the_gpu(
    factory: sessionmaker[Session], scheduler: Scheduler, dispatcher: RecordingDispatcher
) -> None:
    task_id = submit(factory, {"type": "benchmark", "duration_seconds": 60})
    scheduler.schedule_once()

    def cancel_on_first_sleep(_: float) -> None:
        with factory() as session:
            TaskService(session, max_active_tasks=0).cancel(task_id)

    worker(factory, sleep=cancel_on_first_sleep).execute(dispatcher.assignments[0])

    stored = task(factory, task_id)
    assert stored.status == "cancelled"
    assert stored.error == {"code": "cancelled", "message": "Cancelled by user while running."}
    assert reservations(factory) == {}


def test_freed_gpus_are_reused(
    factory: sessionmaker[Session], scheduler: Scheduler, dispatcher: RecordingDispatcher
) -> None:
    ids = [echo(factory) for _ in range(5)]
    scheduler.schedule_once()
    worker(factory).execute(dispatcher.assignments[0])  # frees GPU-05

    scheduler.schedule_once()

    assert task(factory, ids[4]).assigned_gpu_id == "GPU-05"


def test_concurrent_schedulers_never_double_book_a_gpu(
    factory: sessionmaker[Session], fleet: FleetRegistry, dispatcher: RecordingDispatcher
) -> None:
    ids = [echo(factory) for _ in range(12)]
    schedulers = [Scheduler(factory, fleet, dispatcher) for _ in range(6)]
    barrier = threading.Barrier(len(schedulers))
    errors: list[BaseException] = []

    def run(s: Scheduler) -> None:
        try:
            barrier.wait()
            for _ in range(3):
                s.schedule_once()
        except BaseException as error:
            errors.append(error)

    threads = [threading.Thread(target=run, args=(s,)) for s in schedulers]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == []
    held = reservations(factory)
    assert sorted(held) == ["GPU-01", "GPU-02", "GPU-03", "GPU-05"]
    scheduled = [task(factory, i) for i in ids if task(factory, i).status == "scheduled"]
    assert len(scheduled) == 4
    assert {t.assigned_gpu_id: t.id for t in scheduled} == held
    # Each placement was dispatched exactly once, to the GPU it reserved.
    assert sorted((a.gpu_id, a.task_id) for a in dispatcher.assignments) == sorted(held.items())


def test_concurrent_submissions_are_all_placed_without_overlap(
    factory: sessionmaker[Session], scheduler: Scheduler, dispatcher: RecordingDispatcher
) -> None:
    ids: list[str] = []
    lock = threading.Lock()

    def submit_one() -> None:
        task_id = echo(factory)
        with lock:
            ids.append(task_id)

    threads = [threading.Thread(target=submit_one) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    scheduler.schedule_once()
    assert len(ids) == 8
    assert len(reservations(factory)) == 4
    assert len({a.gpu_id for a in dispatcher.assignments}) == 4


def run_scenario(database_url: str) -> list[tuple[str | None, str | None, str]]:
    upgrade_database(database_url)
    engine = create_db_engine(database_url)
    factory = create_session_factory(engine)
    scheduler = Scheduler(
        factory, FleetRegistry(*build_simulated_fleet()), RecordingDispatcher(), clock=FakeClock()
    )
    ids = [
        echo(factory, memory_gb=20),
        submit(factory, {"type": "benchmark", "matrix_size": 8192}),
        echo(factory),
        echo(factory, memory_gb=40),
        submit(factory, {"type": "sample_inference", "prompt": "hi", "model": "pixel-small-7b"}),
        echo(factory),
    ]
    scheduler.schedule_once()
    outcome = []
    for task_id in ids:
        stored = task(factory, task_id)
        explanation = (stored.scheduler_decision or {}).get("explanation", "")
        # Task IDs are random; refer to tasks by submission order instead.
        for index, other in enumerate(ids):
            explanation = explanation.replace(other, f"<task {index}>")
        outcome.append((stored.status, stored.assigned_gpu_id, explanation))
    engine.dispose()
    return outcome


def test_same_submissions_give_the_same_placements(tmp_path: Any) -> None:
    first = run_scenario(f"sqlite:///{tmp_path / 'a.db'}")
    second = run_scenario(f"sqlite:///{tmp_path / 'b.db'}")

    assert first == second
    assert [(s, g) for s, g, _ in first] == [
        ("scheduled", "GPU-01"),  # 20 GiB: smallest that fits is a 24 GiB GPU
        ("scheduled", "GPU-05"),  # 8192 benchmark needs 8 GiB: exact fit
        ("scheduled", "GPU-03"),  # echo: smallest free is now the 16 GiB GPU
        ("failed", None),  # 40 GiB: no GPU is that large
        ("scheduled", "GPU-02"),  # 14 GiB model: only a 24 GiB GPU is left
        ("queued", None),  # nothing free
    ]


def test_restart_recovery_fails_interrupted_tasks_and_frees_gpus(
    factory: sessionmaker[Session], scheduler: Scheduler
) -> None:
    scheduled, running = echo(factory), echo(factory)
    scheduler.schedule_once()
    with factory() as session:
        TaskService(session, max_active_tasks=0).transition(
            running, TaskStatus.RUNNING, message="r"
        )

    recovered = recover_interrupted_tasks(factory)

    assert sorted(recovered) == sorted([scheduled, running])
    assert reservations(factory) == {}
    for task_id in (scheduled, running):
        assert (task(factory, task_id).error or {}).get("code") == "worker_lost"
