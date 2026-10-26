"""ORM models for tasks and their event history."""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from pixelgpu.db import Base, UTCDateTime


class TaskRecord(Base):
    __tablename__ = "tasks"
    __table_args__ = (Index("ix_tasks_status_created_at", "status", "created_at"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    prompt: Mapped[str | None] = mapped_column(Text)
    workload_type: Mapped[str] = mapped_column(String(64))
    workload: Mapped[dict[str, Any]] = mapped_column(JSON)
    min_memory_mb: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16))

    created_at: Mapped[datetime] = mapped_column(UTCDateTime)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime)
    scheduled_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    cancel_requested_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    assigned_worker_id: Mapped[str | None] = mapped_column(String(64))
    assigned_gpu_id: Mapped[str | None] = mapped_column(String(64))
    progress: Mapped[float | None] = mapped_column(Float)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    error: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    scheduler_decision: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    events: Mapped[list["TaskEventRecord"]] = relationship(
        back_populates="task",
        order_by="TaskEventRecord.id",
        cascade="all, delete-orphan",
    )


class TaskEventRecord(Base):
    """One entry in a task's history: a status change or a log line."""

    __tablename__ = "task_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("tasks.id", ondelete="CASCADE"), index=True
    )
    timestamp: Mapped[datetime] = mapped_column(UTCDateTime)
    kind: Mapped[str] = mapped_column(String(16))
    level: Mapped[str] = mapped_column(String(8))
    message: Mapped[str] = mapped_column(Text)
    from_status: Mapped[str | None] = mapped_column(String(16))
    to_status: Mapped[str | None] = mapped_column(String(16))
    data: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    task: Mapped[TaskRecord] = relationship(back_populates="events")
