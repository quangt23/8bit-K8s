from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import TypeAdapter
from sqlalchemy.orm import Session, sessionmaker

from pixelgpu.db import create_db_engine, create_session_factory, upgrade_database
from pixelgpu.tasks.lifecycle import InvalidTransitionError, TaskStatus
from pixelgpu.tasks.schemas import TaskCreate
from pixelgpu.tasks.service import TaskNotFoundError, TaskService, TooManyActiveTasksError


class FakeClock:
    def __init__(self) -> None:
        self.now = datetime(2026, 10, 25, 12, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        self.now += timedelta(seconds=1)
        return self.now


@pytest.fixture
def factory(database_url: str) -> Iterator[sessionmaker[Session]]:
    upgrade_database(database_url)
    engine = create_db_engine(database_url)
    yield create_session_factory(engine)
    engine.dispose()


@pytest.fixture
def service(factory: sessionmaker[Session]) -> Iterator[TaskService]:
    with factory() as session:
        yield TaskService(session, max_active_tasks=5, clock=FakeClock())


def echo(message: str = "hi", **extra: object) -> TaskCreate:
    return TaskCreate.model_validate({"workload": {"type": "echo", "message": message}, **extra})


def test_create_persists_a_queued_task_with_an_event(
    service: TaskService, factory: sessionmaker[Session]
) -> None:
    task = service.create(echo(prompt="  say hi  "))

    with factory() as other:
        stored = TaskService(other, max_active_tasks=5).get(task.id, with_events=True)
        assert stored.status == "queued"
        assert stored.prompt == "say hi"
        assert stored.workload == {"type": "echo", "message": "hi"}
        assert stored.min_memory_mb == 512
        assert stored.created_at.tzinfo is not None
        assert [(e.kind, e.to_status) for e in stored.events] == [("status", "queued")]


def test_requested_memory_can_raise_but_not_lower_the_minimum(service: TaskService) -> None:
    raised = service.create(echo(resources={"min_memory_mb": 8192}))
    lowered = service.create(echo(resources={"min_memory_mb": 100}))

    assert raised.min_memory_mb == 8192
    assert lowered.min_memory_mb == 512
    events = service.get(lowered.id, with_events=True).events
    assert events[-1].level == "warning"
    assert "workload minimum of 512 MiB" in events[-1].message


def test_queue_positions_are_fifo(service: TaskService) -> None:
    first, second, third = (service.create(echo(str(i))) for i in range(3))
    service.cancel(second.id)

    assert service.queue_positions() == {first.id: 1, third.id: 2}


def test_list_is_newest_first_and_filterable(service: TaskService) -> None:
    a = service.create(echo("a"))
    b = service.create(echo("b"))
    service.cancel(a.id)

    tasks, total = service.list()
    assert [t.id for t in tasks] == [b.id, a.id]
    assert total == 2
    cancelled, total = service.list(status=TaskStatus.CANCELLED)
    assert [t.id for t in cancelled] == [a.id]
    assert total == 1


def test_full_lifecycle_sets_timestamps(service: TaskService) -> None:
    task = service.create(echo())
    service.transition(task.id, TaskStatus.SCHEDULED, message="scheduled", assigned_gpu_id="GPU-01")
    service.transition(task.id, TaskStatus.RUNNING, message="running")
    done = service.transition(task.id, TaskStatus.SUCCEEDED, message="done", result={"echo": "hi"})

    assert done.status == "succeeded"
    assert done.assigned_gpu_id == "GPU-01"
    assert done.result == {"echo": "hi"}
    assert done.created_at < done.scheduled_at < done.started_at < done.finished_at  # type: ignore[operator]
    statuses = [e.to_status for e in service.get(task.id, with_events=True).events]
    assert statuses == ["queued", "scheduled", "running", "succeeded"]


@pytest.mark.parametrize(
    ("path", "target"),
    [
        ([], TaskStatus.RUNNING),
        ([], TaskStatus.SUCCEEDED),
        ([TaskStatus.SCHEDULED], TaskStatus.SUCCEEDED),
        ([TaskStatus.SCHEDULED, TaskStatus.RUNNING], TaskStatus.QUEUED),
        ([TaskStatus.CANCELLED], TaskStatus.RUNNING),
        ([TaskStatus.FAILED], TaskStatus.QUEUED),
    ],
)
def test_invalid_transitions_are_rejected_and_change_nothing(
    service: TaskService, path: list[TaskStatus], target: TaskStatus
) -> None:
    task = service.create(echo())
    for step in path:
        service.transition(task.id, step, message=str(step))
    before = service.get(task.id, with_events=True)
    status_before, events_before = before.status, len(before.events)

    with pytest.raises(InvalidTransitionError):
        service.transition(task.id, target, message="nope")

    after = service.get(task.id, with_events=True)
    assert (after.status, len(after.events)) == (status_before, events_before)


def test_a_lost_race_is_rejected(factory: sessionmaker[Session]) -> None:
    """Two sessions read the same queued task; only the first transition may win."""
    with factory() as setup:
        task_id = TaskService(setup, max_active_tasks=5).create(echo()).id

    with factory() as a, factory() as b:
        service_a = TaskService(a, max_active_tasks=5)
        service_b = TaskService(b, max_active_tasks=5)
        service_a.get(task_id)  # A has read 'queued'
        service_b.transition(task_id, TaskStatus.CANCELLED, message="cancelled by B")

        with pytest.raises(InvalidTransitionError) as info:
            service_a.transition(task_id, TaskStatus.SCHEDULED, message="scheduled by A")

    assert info.value.current == TaskStatus.CANCELLED
    with factory() as check:
        assert TaskService(check, max_active_tasks=5).get(task_id).status == "cancelled"


def test_cancel_queued_and_scheduled_tasks_immediately(service: TaskService) -> None:
    queued = service.create(echo())
    scheduled = service.create(echo())
    service.transition(scheduled.id, TaskStatus.SCHEDULED, message="scheduled")

    for task in (queued, scheduled):
        cancelled = service.cancel(task.id)
        assert cancelled.status == "cancelled"
        assert cancelled.finished_at is not None
        assert cancelled.error == {"code": "cancelled", "message": "Cancelled by user."}


def test_cancel_running_task_requests_cooperative_stop(service: TaskService) -> None:
    task = service.create(echo())
    service.transition(task.id, TaskStatus.SCHEDULED, message="s")
    service.transition(task.id, TaskStatus.RUNNING, message="r")

    first = service.cancel(task.id)
    requested_at = first.cancel_requested_at
    second = service.cancel(task.id)

    assert first.status == "running"
    assert requested_at is not None
    assert second.cancel_requested_at == requested_at  # idempotent
    warnings = [e for e in service.get(task.id, with_events=True).events if e.level == "warning"]
    assert len(warnings) == 1


@pytest.mark.parametrize("final", [TaskStatus.SUCCEEDED, TaskStatus.FAILED])
def test_finished_tasks_cannot_be_cancelled(service: TaskService, final: TaskStatus) -> None:
    task = service.create(echo())
    service.transition(task.id, TaskStatus.SCHEDULED, message="s")
    service.transition(task.id, TaskStatus.RUNNING, message="r")
    service.transition(task.id, final, message="done")

    with pytest.raises(InvalidTransitionError):
        service.cancel(task.id)


def test_active_task_limit(service: TaskService) -> None:
    tasks = [service.create(echo(str(i))) for i in range(5)]
    with pytest.raises(TooManyActiveTasksError):
        service.create(echo("one too many"))

    service.cancel(tasks[0].id)
    assert service.create(echo("fits again")).status == "queued"


def test_unknown_task(service: TaskService) -> None:
    with pytest.raises(TaskNotFoundError):
        service.get("task_missing")


def test_workload_round_trips_to_typed_spec(service: TaskService) -> None:
    from pixelgpu.tasks.workloads import BenchmarkWorkload, WorkloadSpec

    task = service.create(TaskCreate.model_validate({"workload": {"type": "benchmark"}}))
    spec = TypeAdapter(WorkloadSpec).validate_python(task.workload)

    assert spec == BenchmarkWorkload(duration_seconds=30, matrix_size=4096)
