"""Task persistence and lifecycle operations.

All status changes go through ``transition``, which enforces the state machine
and updates the row with a compare-and-swap on the current status. Two callers
racing to move the same task cannot both succeed.
"""

import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, selectinload

from pixelgpu.tasks.lifecycle import (
    ACTIVE_STATUSES,
    TERMINAL_STATUSES,
    InvalidTransitionError,
    TaskStatus,
    ensure_transition,
)
from pixelgpu.tasks.models import TaskEventRecord, TaskRecord
from pixelgpu.tasks.schemas import TaskCreate

Clock = Callable[[], datetime]

# Timestamp column set when a task enters each status.
_STATUS_TIMESTAMPS: dict[TaskStatus, str] = {
    TaskStatus.SCHEDULED: "scheduled_at",
    TaskStatus.RUNNING: "started_at",
    TaskStatus.SUCCEEDED: "finished_at",
    TaskStatus.FAILED: "finished_at",
    TaskStatus.CANCELLED: "finished_at",
}


class TaskNotFoundError(Exception):
    def __init__(self, task_id: str) -> None:
        self.task_id = task_id
        super().__init__(f"Task '{task_id}' not found.")


class TooManyActiveTasksError(Exception):
    def __init__(self, limit: int) -> None:
        self.limit = limit
        super().__init__(
            f"There are already {limit} active tasks. Wait for some to finish or cancel them."
        )


def _utcnow() -> datetime:
    return datetime.now(UTC)


def new_task_id() -> str:
    return f"task_{uuid.uuid4().hex[:16]}"


class TaskService:
    def __init__(self, session: Session, *, max_active_tasks: int, clock: Clock = _utcnow):
        self.session = session
        self.max_active_tasks = max_active_tasks
        self.clock = clock

    # ----- queries -----

    def get(self, task_id: str, *, with_events: bool = False) -> TaskRecord:
        query = select(TaskRecord).where(TaskRecord.id == task_id)
        if with_events:
            query = query.options(selectinload(TaskRecord.events))
        task = self.session.scalars(query).one_or_none()
        if task is None:
            raise TaskNotFoundError(task_id)
        return task

    def list(
        self, *, status: TaskStatus | None = None, limit: int = 50
    ) -> tuple[list[TaskRecord], int]:
        query = select(TaskRecord)
        count = select(func.count()).select_from(TaskRecord)
        if status is not None:
            query = query.where(TaskRecord.status == status)
            count = count.where(TaskRecord.status == status)
        tasks = self.session.scalars(
            query.order_by(TaskRecord.created_at.desc(), TaskRecord.id.desc()).limit(limit)
        ).all()
        return list(tasks), self.session.scalar(count) or 0

    def queue_positions(self) -> dict[str, int]:
        """1-based FIFO position of every queued task."""
        ids = self.session.scalars(
            select(TaskRecord.id)
            .where(TaskRecord.status == TaskStatus.QUEUED)
            .order_by(TaskRecord.created_at, TaskRecord.id)
        ).all()
        return {task_id: index for index, task_id in enumerate(ids, start=1)}

    def count_active(self) -> int:
        query = select(func.count()).where(TaskRecord.status.in_(list(ACTIVE_STATUSES)))
        return self.session.scalar(query) or 0

    # ----- commands -----

    def create(self, request: TaskCreate) -> TaskRecord:
        if self.count_active() >= self.max_active_tasks:
            raise TooManyActiveTasksError(self.max_active_tasks)

        workload = request.workload
        workload_min = workload.default_min_memory_mb()
        requested = request.resources.min_memory_mb
        min_memory_mb = max(workload_min, requested or 0)

        now = self.clock()
        task = TaskRecord(
            id=new_task_id(),
            prompt=request.prompt or None,
            workload_type=workload.type,
            workload=workload.model_dump(mode="json"),
            min_memory_mb=min_memory_mb,
            status=TaskStatus.QUEUED,
            created_at=now,
            updated_at=now,
        )
        self.session.add(task)
        self._event(
            task.id,
            now,
            kind="status",
            message="Task accepted and queued.",
            to_status=TaskStatus.QUEUED,
            data={"workload_type": workload.type, "min_memory_mb": min_memory_mb},
        )
        if requested is not None and requested < workload_min:
            self._event(
                task.id,
                now,
                message=(
                    f"Requested {requested} MiB is below what '{workload.type}' needs; "
                    f"using the workload minimum of {workload_min} MiB."
                ),
                level="warning",
            )
        self.session.commit()
        return task

    def transition(
        self,
        task_id: str,
        target: TaskStatus,
        *,
        message: str,
        level: str = "info",
        data: dict[str, Any] | None = None,
        **fields: Any,
    ) -> TaskRecord:
        """Move a task to ``target`` if the state machine allows it. Atomic per task."""
        task = self.get(task_id)
        current = TaskStatus(task.status)
        ensure_transition(task_id, current, target)

        now = self.clock()
        values: dict[str, Any] = {"status": target, "updated_at": now, **fields}
        if column := _STATUS_TIMESTAMPS.get(target):
            values[column] = now

        result = self.session.execute(
            update(TaskRecord)
            .where(TaskRecord.id == task_id, TaskRecord.status == current)
            .values(**values)
        )
        if result.rowcount != 1:  # type: ignore[attr-defined]
            # Someone else changed the status between our read and write.
            self.session.rollback()
            latest = TaskStatus(self.get(task_id).status)
            raise InvalidTransitionError(task_id, latest, target)

        self._event(
            task_id,
            now,
            kind="status",
            message=message,
            level=level,
            from_status=current,
            to_status=target,
            data=data,
        )
        self.session.commit()
        self.session.refresh(task)
        return task

    def cancel(self, task_id: str) -> TaskRecord:
        """Cancel immediately if not started; otherwise ask the worker to stop."""
        task = self.get(task_id)
        status = TaskStatus(task.status)

        if status in TERMINAL_STATUSES:
            raise InvalidTransitionError(task_id, status, TaskStatus.CANCELLED)

        if status == TaskStatus.RUNNING:
            if task.cancel_requested_at is None:
                now = self.clock()
                task.cancel_requested_at = now
                task.updated_at = now
                self._event(
                    task_id,
                    now,
                    message="Cancellation requested; waiting for the worker to stop.",
                    level="warning",
                )
                self.session.commit()
            return task

        return self.transition(
            task_id,
            TaskStatus.CANCELLED,
            message="Cancelled before it started running.",
            error={"code": "cancelled", "message": "Cancelled by user."},
        )

    def _event(
        self,
        task_id: str,
        timestamp: datetime,
        *,
        message: str,
        kind: str = "log",
        level: str = "info",
        from_status: TaskStatus | None = None,
        to_status: TaskStatus | None = None,
        data: dict[str, Any] | None = None,
    ) -> None:
        self.session.add(
            TaskEventRecord(
                task_id=task_id,
                timestamp=timestamp,
                kind=kind,
                level=level,
                message=message,
                from_status=from_status,
                to_status=to_status,
                data=data,
            )
        )
