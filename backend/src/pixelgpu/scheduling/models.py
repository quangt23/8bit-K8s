"""GPU reservations.

A row means "this GPU belongs to this task". ``gpu_id`` is the primary key, so a
second reservation of the same GPU fails at the database, not in application
code; ``task_id`` is unique, so a task can never hold two GPUs. Reservations are
inserted in the same transaction that moves a task to ``scheduled`` and deleted
in the same transaction that moves it to a terminal status.
"""

from datetime import datetime

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from pixelgpu.db import Base, UTCDateTime


class GpuReservation(Base):
    __tablename__ = "gpu_reservations"

    gpu_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    task_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("tasks.id", ondelete="CASCADE"), unique=True
    )
    worker_id: Mapped[str] = mapped_column(String(64))
    reserved_at: Mapped[datetime] = mapped_column(UTCDateTime)
