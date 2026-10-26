"""Domain models for workers and GPU devices.

Every telemetry value carries its provenance. A value is ``simulated`` (produced by
a simulated worker), ``measured`` (read from real hardware), or ``unavailable``
(unknown, so ``value`` is ``None``). Values are never invented to fill gaps.
"""

from datetime import datetime
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator

ExecutionMode = Literal["simulated", "cpu", "gpu"]
"""How workloads on a device or worker actually execute."""

DeviceHealth = Literal["healthy", "error", "offline"]
"""Whether the device can be used at all, independent of what it is doing."""

DeviceActivity = Literal["idle", "reserved", "running"]
"""What the device is doing. Driven by task reservations (Phase 3)."""

WorkerStatus = Literal["online", "offline"]

MetricSource = Literal["simulated", "measured", "unavailable"]


class Metric(BaseModel):
    """A telemetry reading together with where it came from."""

    model_config = ConfigDict(frozen=True)

    value: float | None
    unit: str
    source: MetricSource
    updated_at: datetime | None = None
    note: str | None = None

    @model_validator(mode="after")
    def _value_matches_source(self) -> Self:
        if (self.source == "unavailable") != (self.value is None):
            raise ValueError("value must be None exactly when source is 'unavailable'")
        return self

    @classmethod
    def unavailable(cls, unit: str, note: str) -> "Metric":
        return cls(value=None, unit=unit, source="unavailable", note=note)


class RackLocation(BaseModel):
    """Stable physical placement, used to lay out the facility scene."""

    model_config = ConfigDict(frozen=True)

    rack: str = Field(min_length=1, max_length=8)
    slot: int = Field(ge=1, le=8)


class GpuDevice(BaseModel):
    id: str
    name: str
    worker_id: str
    execution_mode: ExecutionMode
    location: RackLocation
    memory_total_mb: int = Field(gt=0, description="Advertised device memory in MiB.")
    memory_used: Metric
    utilization: Metric
    health: DeviceHealth
    health_reason: str | None = None
    activity: DeviceActivity = "idle"
    current_task_id: str | None = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def schedulable(self) -> bool:
        """Whether the scheduler may place new work here right now."""
        return self.unschedulable_reason is None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def unschedulable_reason(self) -> str | None:
        if self.health == "offline":
            return "Device is offline."
        if self.health == "error":
            return "Device is reporting an error."
        if self.activity != "idle":
            return f"Device is {self.activity}."
        return None


class Worker(BaseModel):
    id: str
    name: str
    execution_mode: ExecutionMode
    status: WorkerStatus
    rack: str
    gpu_ids: list[str]
    supported_workloads: list[str] = Field(
        default_factory=list,
        description="Workload types this worker accepts. Empty until workloads exist (Phase 2).",
    )
    last_heartbeat: datetime | None = Field(
        default=None,
        description="None for in-process simulated workers, which do not send heartbeats.",
    )
