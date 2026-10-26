"""The fleet as it is right now: static inventory plus live reservations.

The registry says what hardware exists. Reservations in the database say which
task holds which GPU. Activity, current task and (simulated) memory use are
derived from those reservations, so the API, the UI and the scheduler all see
the same state.
"""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from pixelgpu.fleet.models import DeviceActivity, GpuDevice, Metric, Worker
from pixelgpu.fleet.registry import FleetRegistry
from pixelgpu.scheduling.models import GpuReservation
from pixelgpu.scheduling.policy import GpuState
from pixelgpu.tasks.lifecycle import TaskStatus
from pixelgpu.tasks.models import TaskRecord


@dataclass(frozen=True)
class _Holder:
    task_id: str
    status: str
    min_memory_mb: int


def _holders(session: Session) -> dict[str, _Holder]:
    rows = session.execute(
        select(
            GpuReservation.gpu_id,
            GpuReservation.task_id,
            TaskRecord.status,
            TaskRecord.min_memory_mb,
        ).join(TaskRecord, TaskRecord.id == GpuReservation.task_id)
    ).all()
    return {row.gpu_id: _Holder(row.task_id, row.status, row.min_memory_mb) for row in rows}


def _with_reservation(gpu: GpuDevice, holder: _Holder | None) -> GpuDevice:
    if holder is None:
        return gpu
    activity: DeviceActivity = "running" if holder.status == TaskStatus.RUNNING else "reserved"
    update: dict[str, object] = {"activity": activity, "current_task_id": holder.task_id}
    if gpu.execution_mode == "simulated" and gpu.memory_used.source == "simulated":
        update["memory_used"] = Metric(
            value=holder.min_memory_mb,
            unit="MiB",
            source="simulated",
            note="Simulated: equal to the reserved task's memory requirement.",
        )
    return gpu.model_copy(update=update)


def live_gpus(session: Session, registry: FleetRegistry) -> list[GpuDevice]:
    holders = _holders(session)
    return [_with_reservation(gpu, holders.get(gpu.id)) for gpu in registry.list_gpus()]


def live_workers(registry: FleetRegistry) -> list[Worker]:
    return registry.list_workers()


def gpu_states(session: Session, registry: FleetRegistry) -> list[GpuState]:
    """The scheduler's view: each GPU with its worker and current holder."""
    holders = _holders(session)
    workers = {worker.id: worker for worker in registry.list_workers()}
    return [
        GpuState(
            gpu=gpu,
            worker=workers.get(gpu.worker_id),
            reserved_by=holder.task_id if (holder := holders.get(gpu.id)) else None,
        )
        for gpu in registry.list_gpus()
    ]
