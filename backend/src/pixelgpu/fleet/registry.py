"""In-memory registry of workers and GPUs.

This is the single backend source of truth for fleet state until the database
arrives (Phase 2). The scheduler will update device activity through it (Phase 3).
"""

from collections.abc import Iterable

from pixelgpu.fleet.models import GpuDevice, Worker


class FleetRegistry:
    def __init__(self, workers: Iterable[Worker] = (), gpus: Iterable[GpuDevice] = ()) -> None:
        self._workers = {worker.id: worker for worker in workers}
        self._gpus: dict[str, GpuDevice] = {}
        for gpu in gpus:
            self._add_gpu(gpu)

    def _add_gpu(self, gpu: GpuDevice) -> None:
        if gpu.id in self._gpus:
            raise ValueError(f"Duplicate GPU id {gpu.id!r}")
        if gpu.worker_id not in self._workers:
            raise ValueError(f"GPU {gpu.id!r} references unknown worker {gpu.worker_id!r}")
        for other in self._gpus.values():
            if other.location == gpu.location:
                raise ValueError(f"GPUs {other.id!r} and {gpu.id!r} share {gpu.location}")
        self._gpus[gpu.id] = gpu

    def list_workers(self) -> list[Worker]:
        return sorted(self._workers.values(), key=lambda worker: worker.id)

    def list_gpus(self) -> list[GpuDevice]:
        return sorted(self._gpus.values(), key=lambda gpu: gpu.id)

    def get_gpu(self, gpu_id: str) -> GpuDevice | None:
        return self._gpus.get(gpu_id)
