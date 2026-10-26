"""An in-process simulated worker.

Tasks arrive through a queue. One runner thread per GPU takes assignments off the
queue, so a worker runs as many tasks at once as it has GPUs (the scheduler's
reservations guarantee one task per GPU).
"""

import logging
import queue
import threading
import time
from collections.abc import Callable
from typing import Any

from pydantic import TypeAdapter
from sqlalchemy.orm import Session, sessionmaker

from pixelgpu.scheduling.scheduler import Assignment
from pixelgpu.tasks.lifecycle import InvalidTransitionError, TaskStatus
from pixelgpu.tasks.service import TaskService
from pixelgpu.tasks.workloads import WorkloadSpec
from pixelgpu.workers.execution import (
    ExecutionContext,
    TaskCancelledError,
    TaskTimeoutError,
    WorkloadFailedError,
)
from pixelgpu.workers.simulation import run_simulated

logger = logging.getLogger(__name__)

_specs: TypeAdapter[WorkloadSpec] = TypeAdapter(WorkloadSpec)


class SimulatedWorker:
    def __init__(
        self,
        worker_id: str,
        gpu_count: int,
        session_factory: sessionmaker[Session],
        *,
        speed: float,
        timeout_seconds: float,
        on_finished: Callable[[], None] = lambda: None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.worker_id = worker_id
        self.gpu_count = gpu_count
        self.session_factory = session_factory
        self.speed = speed
        self.timeout_seconds = timeout_seconds
        self.on_finished = on_finished
        self.sleep = sleep
        self._queue: queue.Queue[Assignment | None] = queue.Queue()
        self._threads: list[threading.Thread] = []

    def start(self) -> None:
        for index in range(max(1, self.gpu_count)):
            thread = threading.Thread(
                target=self._run, name=f"{self.worker_id}-runner-{index}", daemon=True
            )
            thread.start()
            self._threads.append(thread)

    def stop(self, timeout: float = 5.0) -> None:
        for _ in self._threads:
            self._queue.put(None)
        for thread in self._threads:
            thread.join(timeout)

    def submit(self, assignment: Assignment) -> None:
        self._queue.put(assignment)

    def _run(self) -> None:
        while (assignment := self._queue.get()) is not None:
            try:
                self.execute(assignment)
            except Exception:
                logger.exception("Runner crashed while handling %s", assignment.task_id)
            finally:
                self.on_finished()

    def execute(self, assignment: Assignment) -> None:
        """Run one assignment to a terminal status. Safe to call directly in tests."""
        with self.session_factory() as session:
            service = TaskService(session, max_active_tasks=0)
            try:
                task = service.transition(
                    assignment.task_id,
                    TaskStatus.RUNNING,
                    message=f"Started on {assignment.gpu_id} ({self.worker_id}, simulated).",
                    progress=0.0,
                )
            except InvalidTransitionError:
                return  # cancelled before we picked it up

            ctx = ExecutionContext(
                service,
                assignment.task_id,
                speed=self.speed,
                timeout_seconds=self.timeout_seconds,
                sleep=self.sleep,
            )
            try:
                result = run_simulated(_specs.validate_python(task.workload), ctx)
            except TaskCancelledError:
                self._finish(
                    service,
                    assignment,
                    TaskStatus.CANCELLED,
                    "Stopped by the worker after a cancel request.",
                    error={"code": "cancelled", "message": "Cancelled by user while running."},
                )
            except TaskTimeoutError as error:
                self._finish(
                    service,
                    assignment,
                    TaskStatus.FAILED,
                    str(error),
                    error={"code": "timeout", "message": str(error)},
                )
            except WorkloadFailedError as error:
                self._finish(
                    service,
                    assignment,
                    TaskStatus.FAILED,
                    f"Workload failed: {error}",
                    error={"code": "workload_failed", "message": str(error)},
                )
            except Exception as error:
                logger.exception("Simulated workload crashed: %s", assignment.task_id)
                self._finish(
                    service,
                    assignment,
                    TaskStatus.FAILED,
                    "The worker hit an unexpected error.",
                    error={"code": "worker_error", "message": f"{type(error).__name__}: {error}"},
                )
            else:
                self._finish(
                    service,
                    assignment,
                    TaskStatus.SUCCEEDED,
                    f"Finished on {assignment.gpu_id}.",
                    result=result,
                    progress=1.0,
                )

    def _finish(
        self,
        service: TaskService,
        assignment: Assignment,
        status: TaskStatus,
        message: str,
        **fields: Any,
    ) -> None:
        level = "info" if status == TaskStatus.SUCCEEDED else "error"
        if status == TaskStatus.CANCELLED:
            level = "warning"
        try:
            service.transition(
                assignment.task_id,
                status,
                message=f"{message} Released {assignment.gpu_id}.",
                level=level,
                **fields,
            )
        except InvalidTransitionError:
            logger.warning("%s already finished elsewhere", assignment.task_id)
