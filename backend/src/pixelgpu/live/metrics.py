"""Orchestration metrics, computed from task records.

These describe the scheduler and queue, not hardware: "allocated" counts GPUs
holding a reservation, which says nothing about how hard a GPU is working.
"""

from datetime import datetime, timedelta
from statistics import median

from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from pixelgpu.fleet.models import GpuDevice
from pixelgpu.tasks.lifecycle import TaskStatus
from pixelgpu.tasks.models import TaskRecord

RECENT_WINDOW = 50
THROUGHPUT_WINDOW = timedelta(minutes=5)


class GpuMetrics(BaseModel):
    total: int
    healthy: int
    allocated: int = Field(description="GPUs reserved by a scheduled or running task.")


class RecentMetrics(BaseModel):
    """Over the last finished tasks (up to 50)."""

    sample_size: int
    success_rate: float | None
    median_queue_wait_seconds: float | None = Field(description="created → scheduled")
    median_run_seconds: float | None = Field(description="started → finished")


class Metrics(BaseModel):
    generated_at: datetime
    tasks_by_status: dict[TaskStatus, int]
    gpus: GpuMetrics
    finished_last_5_minutes: int
    recent: RecentMetrics


def _median_seconds(pairs: list[tuple[datetime | None, datetime | None]]) -> float | None:
    values = [(end - start).total_seconds() for start, end in pairs if start and end]
    return round(median(values), 3) if values else None


def compute_metrics(session: Session, gpus: list[GpuDevice], now: datetime) -> Metrics:
    counts = dict(
        session.execute(select(TaskRecord.status, func.count()).group_by(TaskRecord.status)).all()
    )
    by_status = {status: int(counts.get(status, 0)) for status in TaskStatus}

    finished = [TaskStatus.SUCCEEDED, TaskStatus.FAILED, TaskStatus.CANCELLED]
    recent = session.execute(
        select(
            TaskRecord.status,
            TaskRecord.created_at,
            TaskRecord.scheduled_at,
            TaskRecord.started_at,
            TaskRecord.finished_at,
        )
        .where(TaskRecord.status.in_(finished))
        .order_by(TaskRecord.finished_at.desc())
        .limit(RECENT_WINDOW)
    ).all()
    throughput = (
        session.scalar(
            select(func.count())
            .where(TaskRecord.status.in_(finished))
            .where(TaskRecord.finished_at >= now - THROUGHPUT_WINDOW)
        )
        or 0
    )
    # Cancelled tasks say nothing about whether work succeeds.
    outcomes = [r.status for r in recent if r.status != TaskStatus.CANCELLED]

    return Metrics(
        generated_at=now,
        tasks_by_status=by_status,
        gpus=GpuMetrics(
            total=len(gpus),
            healthy=sum(1 for g in gpus if g.health == "healthy"),
            allocated=sum(1 for g in gpus if g.activity != "idle"),
        ),
        finished_last_5_minutes=throughput,
        recent=RecentMetrics(
            sample_size=len(recent),
            success_rate=(
                round(outcomes.count(TaskStatus.SUCCEEDED) / len(outcomes), 3) if outcomes else None
            ),
            median_queue_wait_seconds=_median_seconds(
                [(r.created_at, r.scheduled_at) for r in recent]
            ),
            median_run_seconds=_median_seconds([(r.started_at, r.finished_at) for r in recent]),
        ),
    )
