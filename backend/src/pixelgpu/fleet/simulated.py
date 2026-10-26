"""The fixed simulated fleet used for local development.

Everything here is simulated and labelled as such. No hardware is touched.
"""

from typing import NamedTuple

from pixelgpu.fleet.models import DeviceHealth, GpuDevice, Metric, RackLocation, Worker


class _GpuSpec(NamedTuple):
    id: str
    name: str
    memory_gb: int
    slot: int
    health: DeviceHealth = "healthy"
    health_reason: str | None = None


class _WorkerSpec(NamedTuple):
    id: str
    name: str
    rack: str
    gpus: tuple[_GpuSpec, ...]


SIMULATED_FLEET: tuple[_WorkerSpec, ...] = (
    _WorkerSpec(
        id="sim-worker-a",
        name="Simulated worker A",
        rack="A",
        gpus=(
            _GpuSpec("GPU-01", "PixelSim 24G", 24, slot=1),
            _GpuSpec("GPU-02", "PixelSim 24G", 24, slot=2),
            _GpuSpec("GPU-03", "PixelSim 16G", 16, slot=3),
            _GpuSpec(
                "GPU-04",
                "PixelSim 16G",
                16,
                slot=4,
                health="error",
                health_reason="Simulated fault: device failed its startup self-test.",
            ),
        ),
    ),
    _WorkerSpec(
        id="sim-worker-b",
        name="Simulated worker B",
        rack="B",
        gpus=(
            _GpuSpec("GPU-05", "PixelSim 8G", 8, slot=1),
            _GpuSpec(
                "GPU-06",
                "PixelSim 12G",
                12,
                slot=2,
                health="offline",
                health_reason="Simulated outage: device is not responding.",
            ),
        ),
    ),
)

_UTILIZATION_NOTE = "Simulated workers do not model utilization."


def _build_gpu(spec: _GpuSpec, worker_id: str, rack: str) -> GpuDevice:
    if spec.health == "offline":
        memory_used = Metric.unavailable("MiB", "Device is offline.")
    else:
        memory_used = Metric(
            value=0,
            unit="MiB",
            source="simulated",
            note="Simulated usage comes from task reservations; none are active.",
        )
    return GpuDevice(
        id=spec.id,
        name=spec.name,
        worker_id=worker_id,
        execution_mode="simulated",
        location=RackLocation(rack=rack, slot=spec.slot),
        memory_total_mb=spec.memory_gb * 1024,
        memory_used=memory_used,
        utilization=Metric.unavailable("%", _UTILIZATION_NOTE),
        health=spec.health,
        health_reason=spec.health_reason,
    )


def build_simulated_fleet() -> tuple[list[Worker], list[GpuDevice]]:
    workers: list[Worker] = []
    gpus: list[GpuDevice] = []
    for worker in SIMULATED_FLEET:
        workers.append(
            Worker(
                id=worker.id,
                name=worker.name,
                execution_mode="simulated",
                status="online",
                rack=worker.rack,
                gpu_ids=[gpu.id for gpu in worker.gpus],
            )
        )
        gpus.extend(_build_gpu(gpu, worker.id, worker.rack) for gpu in worker.gpus)
    return workers, gpus
