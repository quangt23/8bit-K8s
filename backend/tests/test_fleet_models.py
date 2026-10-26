import pytest
from pydantic import ValidationError

from pixelgpu.fleet.models import GpuDevice, Metric, RackLocation, Worker
from pixelgpu.fleet.registry import FleetRegistry
from pixelgpu.fleet.simulated import build_simulated_fleet


def make_worker(worker_id: str = "w1") -> Worker:
    return Worker(
        id=worker_id,
        name=worker_id,
        execution_mode="simulated",
        status="online",
        rack="A",
        gpu_ids=[],
    )


def make_gpu(gpu_id: str = "GPU-01", slot: int = 1, **overrides: object) -> GpuDevice:
    fields: dict[str, object] = {
        "id": gpu_id,
        "name": "Test",
        "worker_id": "w1",
        "execution_mode": "simulated",
        "location": RackLocation(rack="A", slot=slot),
        "memory_total_mb": 8192,
        "memory_used": Metric(value=0, unit="MiB", source="simulated"),
        "utilization": Metric.unavailable("%", "n/a"),
        "health": "healthy",
    }
    fields.update(overrides)
    return GpuDevice.model_validate(fields)


@pytest.mark.parametrize(
    ("value", "source"), [(None, "simulated"), (None, "measured"), (5.0, "unavailable")]
)
def test_metric_rejects_value_source_mismatch(value: float | None, source: str) -> None:
    with pytest.raises(ValidationError):
        Metric.model_validate({"value": value, "unit": "%", "source": source})


@pytest.mark.parametrize(
    ("overrides", "reason"),
    [
        ({}, None),
        ({"health": "offline"}, "Device is offline."),
        ({"health": "error"}, "Device is reporting an error."),
        ({"activity": "running"}, "Device is running."),
        ({"activity": "reserved"}, "Device is reserved."),
    ],
)
def test_schedulability_is_derived_from_health_and_activity(
    overrides: dict[str, object], reason: str | None
) -> None:
    gpu = make_gpu(**overrides)

    assert gpu.unschedulable_reason == reason
    assert gpu.schedulable is (reason is None)


def test_registry_rejects_duplicate_ids() -> None:
    with pytest.raises(ValueError, match="Duplicate"):
        FleetRegistry([make_worker()], [make_gpu(slot=1), make_gpu(slot=2)])


def test_registry_rejects_unknown_worker() -> None:
    with pytest.raises(ValueError, match="unknown worker"):
        FleetRegistry([], [make_gpu()])


def test_registry_rejects_shared_rack_slot() -> None:
    with pytest.raises(ValueError, match="share"):
        FleetRegistry([make_worker()], [make_gpu("GPU-01"), make_gpu("GPU-02")])


def test_simulated_fleet_is_deterministic() -> None:
    assert build_simulated_fleet() == build_simulated_fleet()


def test_simulated_fleet_has_at_least_four_gpus() -> None:
    _, gpus = build_simulated_fleet()

    assert len(gpus) >= 4
