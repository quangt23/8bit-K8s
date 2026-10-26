"""The scheduler: places queued tasks on GPUs and hands them to workers.

One pass (``schedule_once``) walks queued tasks oldest first. For each one it
evaluates every GPU, then either

* reserves the chosen GPU and moves the task to ``scheduled`` in one transaction,
  then dispatches it to the GPU's worker;
* fails the task as ``unschedulable`` if no registered GPU could ever run it; or
* leaves it queued and records why it is waiting.

A later, smaller task may be placed while an earlier, larger one waits (backfill).
That keeps GPUs busy but means a large task can wait behind a stream of small ones.
"""

import contextlib
import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from pixelgpu.fleet.live import gpu_states
from pixelgpu.fleet.registry import FleetRegistry
from pixelgpu.scheduling.models import GpuReservation
from pixelgpu.scheduling.policy import (
    BestFitPolicy,
    Requirements,
    SchedulingDecision,
    SchedulingPolicy,
    decide,
)
from pixelgpu.tasks.lifecycle import InvalidTransitionError, TaskStatus
from pixelgpu.tasks.models import TaskRecord
from pixelgpu.tasks.service import TaskService

logger = logging.getLogger(__name__)

MAX_TASKS_PER_PASS = 200


@dataclass(frozen=True)
class Assignment:
    task_id: str
    gpu_id: str
    worker_id: str


class Dispatcher(Protocol):
    def dispatch(self, assignment: Assignment) -> None: ...


def _utcnow() -> datetime:
    return datetime.now(UTC)


class Scheduler:
    def __init__(
        self,
        session_factory: sessionmaker[Session],
        fleet: FleetRegistry,
        dispatcher: Dispatcher,
        *,
        policy: SchedulingPolicy | None = None,
        clock: Callable[[], datetime] = _utcnow,
    ) -> None:
        self.session_factory = session_factory
        self.fleet = fleet
        self.dispatcher = dispatcher
        self.policy: SchedulingPolicy = policy or BestFitPolicy()
        self.clock = clock

    def schedule_once(self) -> list[tuple[str, SchedulingDecision]]:
        """Run one scheduling pass. Returns (task_id, decision) for every task considered."""
        results: list[tuple[str, SchedulingDecision]] = []
        with self.session_factory() as session:
            # max_active_tasks only limits creation, which the scheduler never does.
            service = TaskService(session, max_active_tasks=0, clock=self.clock)
            queued = session.execute(
                select(TaskRecord.id, TaskRecord.workload_type, TaskRecord.min_memory_mb)
                .where(TaskRecord.status == TaskStatus.QUEUED)
                .order_by(TaskRecord.created_at, TaskRecord.id)
                .limit(MAX_TASKS_PER_PASS)
            ).all()

            for task_id, workload_type, min_memory_mb in queued:
                req = Requirements(workload_type=workload_type, min_memory_mb=min_memory_mb)
                decision = decide(gpu_states(session, self.fleet), req, self.policy, self.clock())
                if decision.outcome == "scheduled":
                    self._schedule(session, service, task_id, decision)
                elif decision.outcome == "unschedulable":
                    self._reject(service, task_id, decision)
                else:
                    self._wait(session, service, task_id, decision)
                results.append((task_id, decision))
        return results

    def _schedule(
        self, session: Session, service: TaskService, task_id: str, decision: SchedulingDecision
    ) -> None:
        assert decision.selected_gpu_id and decision.selected_worker_id
        assignment = Assignment(task_id, decision.selected_gpu_id, decision.selected_worker_id)
        try:
            # Reservation and status change commit together or not at all.
            session.add(
                GpuReservation(
                    gpu_id=assignment.gpu_id,
                    task_id=task_id,
                    worker_id=assignment.worker_id,
                    reserved_at=decision.decided_at,
                )
            )
            session.flush()
            service.apply_transition(
                task_id,
                TaskStatus.SCHEDULED,
                message=decision.explanation,
                data={"gpu_id": assignment.gpu_id, "worker_id": assignment.worker_id},
                assigned_gpu_id=assignment.gpu_id,
                assigned_worker_id=assignment.worker_id,
                scheduler_decision=decision.model_dump(mode="json"),
            )
            session.commit()
        except (IntegrityError, InvalidTransitionError) as error:
            # Another scheduler took the GPU, or the task was cancelled meanwhile.
            session.rollback()
            logger.info("Could not schedule %s on %s: %s", task_id, assignment.gpu_id, error)
            return
        self.dispatcher.dispatch(assignment)

    def _reject(self, service: TaskService, task_id: str, decision: SchedulingDecision) -> None:
        # If the task was cancelled meanwhile there is nothing left to reject.
        with contextlib.suppress(InvalidTransitionError):
            service.transition(
                task_id,
                TaskStatus.FAILED,
                message=decision.explanation,
                level="error",
                error={"code": "unschedulable", "message": decision.explanation},
                scheduler_decision=decision.model_dump(mode="json"),
            )

    def _wait(
        self, session: Session, service: TaskService, task_id: str, decision: SchedulingDecision
    ) -> None:
        previous = session.scalar(
            select(TaskRecord.scheduler_decision).where(TaskRecord.id == task_id)
        )
        current = decision.model_dump(mode="json")
        if previous and _same_decision(previous, current):
            return  # nothing new to record; avoid a write every pass
        session.execute(
            update(TaskRecord)
            .where(TaskRecord.id == task_id, TaskRecord.status == TaskStatus.QUEUED)
            .values(scheduler_decision=current)
            .execution_options(synchronize_session=False)
        )
        session.commit()
        if not previous or previous.get("outcome") != "waiting":
            service.log(task_id, decision.explanation, level="warning")


def _same_decision(a: dict[str, Any], b: dict[str, Any]) -> bool:
    """Equal apart from when they were made."""
    return {k: v for k, v in a.items() if k != "decided_at"} == {
        k: v for k, v in b.items() if k != "decided_at"
    }


class SchedulerLoop:
    """Runs scheduling passes on a background thread: on wake-up, or every interval."""

    def __init__(self, scheduler: Scheduler, interval_seconds: float) -> None:
        self.scheduler = scheduler
        self.interval_seconds = interval_seconds
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="pixelgpu-scheduler", daemon=True)
        self._thread.start()

    def wake(self) -> None:
        self._wake.set()

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread:
            self._thread.join(timeout)

    def _run(self) -> None:
        while not self._stop.is_set():
            self._wake.clear()
            try:
                self.scheduler.schedule_once()
            except Exception:
                # Keep scheduling alive; a failed pass is retried on the next one.
                logger.exception("Scheduling pass failed")
            self._wake.wait(self.interval_seconds)
