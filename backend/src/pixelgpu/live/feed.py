"""The activity feed: every task event, in commit order.

``task_events.id`` only ever increases, so it doubles as a cursor: a client that
has seen up to event N asks for ``after=N`` and gets exactly what it missed.
"""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from pixelgpu.tasks.lifecycle import TaskStatus
from pixelgpu.tasks.models import TaskEventRecord, TaskRecord

MAX_EVENTS = 500
DEFAULT_RECENT = 50


class FeedEvent(BaseModel):
    id: int
    task_id: str
    timestamp: datetime
    kind: Literal["status", "log"]
    level: Literal["info", "warning", "error"]
    message: str
    from_status: TaskStatus | None
    to_status: TaskStatus | None
    data: dict[str, Any] | None
    workload_type: str
    gpu_id: str | None


class FeedPage(BaseModel):
    events: list[FeedEvent]
    latest_event_id: int
    truncated: bool
    """True if more events than ``limit`` happened after the cursor; resync from scratch."""


def _query() -> Any:
    return select(
        TaskEventRecord,
        TaskRecord.workload_type,
        TaskRecord.assigned_gpu_id,
    ).join(TaskRecord, TaskRecord.id == TaskEventRecord.task_id)


def _to_feed(row: Any) -> FeedEvent:
    event, workload_type, gpu_id = row
    return FeedEvent(
        id=event.id,
        task_id=event.task_id,
        timestamp=event.timestamp,
        kind=event.kind,
        level=event.level,
        message=event.message,
        from_status=event.from_status,
        to_status=event.to_status,
        data=event.data,
        workload_type=workload_type,
        gpu_id=gpu_id,
    )


def latest_event_id(session: Session) -> int:
    return session.scalar(select(func.max(TaskEventRecord.id))) or 0


def read_feed(session: Session, *, after: int | None, limit: int = MAX_EVENTS) -> FeedPage:
    """Events after the cursor, oldest first. Without a cursor: the most recent ones."""
    latest = latest_event_id(session)
    if after is None:
        rows = session.execute(
            _query().order_by(TaskEventRecord.id.desc()).limit(min(limit, DEFAULT_RECENT))
        ).all()
        return FeedPage(
            events=[_to_feed(r) for r in reversed(rows)], latest_event_id=latest, truncated=False
        )

    rows = session.execute(
        _query().where(TaskEventRecord.id > after).order_by(TaskEventRecord.id).limit(limit + 1)
    ).all()
    truncated = len(rows) > limit
    return FeedPage(
        events=[_to_feed(r) for r in rows[:limit]], latest_event_id=latest, truncated=truncated
    )
