"""Wires the scheduler and workers together for one running backend process."""

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from pixelgpu.config import Settings
from pixelgpu.fleet.registry import FleetRegistry
from pixelgpu.scheduling.scheduler import Assignment, Scheduler, SchedulerLoop
from pixelgpu.tasks.lifecycle import InvalidTransitionError, TaskStatus
from pixelgpu.tasks.models import TaskRecord
from pixelgpu.tasks.service import TaskService
from pixelgpu.workers.simulated import SimulatedWorker

logger = logging.getLogger(__name__)


def recover_interrupted_tasks(session_factory: sessionmaker[Session]) -> list[str]:
    """Fail tasks that were scheduled or running when the process last stopped.

    In-process workers don't survive a restart, so nothing is executing them any
    more. Failing them also releases their GPU reservations.
    """
    recovered = []
    with session_factory() as session:
        service = TaskService(session, max_active_tasks=0)
        stuck = session.scalars(
            select(TaskRecord).where(
                TaskRecord.status.in_([TaskStatus.SCHEDULED, TaskStatus.RUNNING])
            )
        ).all()
        for task in stuck:
            message = (
                f"The backend restarted while this task was {task.status}; its worker is gone."
            )
            try:
                service.transition(
                    task.id,
                    TaskStatus.FAILED,
                    message=message,
                    level="error",
                    error={"code": "worker_lost", "message": message},
                )
                recovered.append(task.id)
            except InvalidTransitionError:
                continue
    if recovered:
        logger.warning("Failed %d task(s) interrupted by a restart", len(recovered))
    return recovered


class Runtime:
    """Owns the scheduler loop and the simulated workers."""

    def __init__(
        self, settings: Settings, session_factory: sessionmaker[Session], fleet: FleetRegistry
    ) -> None:
        self.settings = settings
        self.session_factory = session_factory
        self.loop: SchedulerLoop | None = None
        self.workers: dict[str, SimulatedWorker] = {}
        for worker in fleet.list_workers():
            if worker.execution_mode != "simulated":
                continue
            self.workers[worker.id] = SimulatedWorker(
                worker.id,
                len(worker.gpu_ids),
                session_factory,
                speed=settings.simulation_speed,
                timeout_seconds=settings.task_timeout_seconds,
                on_finished=self.wake,
            )
        self.scheduler = Scheduler(session_factory, fleet, self)

    def dispatch(self, assignment: Assignment) -> None:
        worker = self.workers.get(assignment.worker_id)
        if worker is not None:
            worker.submit(assignment)
            return
        with self.session_factory() as session:
            message = f"No running worker {assignment.worker_id} to execute this task."
            TaskService(session, max_active_tasks=0).transition(
                assignment.task_id,
                TaskStatus.FAILED,
                message=message,
                level="error",
                error={"code": "worker_unavailable", "message": message},
            )

    def start(self) -> None:
        recover_interrupted_tasks(self.session_factory)
        for worker in self.workers.values():
            worker.start()
        self.loop = SchedulerLoop(self.scheduler, self.settings.scheduler_interval_seconds)
        self.loop.start()

    def wake(self) -> None:
        """Ask for a scheduling pass now (new task, freed GPU)."""
        if self.loop:
            self.loop.wake()

    def stop(self) -> None:
        if self.loop:
            self.loop.stop()
        for worker in self.workers.values():
            worker.stop()
