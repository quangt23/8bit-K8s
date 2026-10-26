"""API request and response models for tasks."""

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from pixelgpu.tasks.lifecycle import TaskStatus
from pixelgpu.tasks.workloads import WorkloadSpec

MAX_MEMORY_REQUEST_MB = 256 * 1024

Prompt = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]


class ResourceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    min_memory_mb: int | None = Field(
        default=None,
        ge=1,
        le=MAX_MEMORY_REQUEST_MB,
        description="Minimum free GPU memory. Can only raise the workload's own minimum.",
    )


class TaskCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: Prompt | None = Field(
        default=None,
        description="The user's own words. Stored for context; never executed.",
    )
    workload: WorkloadSpec
    resources: ResourceRequest = Field(default_factory=ResourceRequest)


class TaskError(BaseModel):
    code: str
    message: str


class TaskEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    timestamp: datetime
    kind: Literal["status", "log"]
    level: Literal["info", "warning", "error"]
    message: str
    from_status: TaskStatus | None
    to_status: TaskStatus | None
    data: dict[str, Any] | None


class TaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    prompt: str | None
    workload: WorkloadSpec
    min_memory_mb: int
    status: TaskStatus
    queue_position: int | None = Field(
        default=None, description="1-based position among queued tasks; null otherwise."
    )
    created_at: datetime
    updated_at: datetime
    scheduled_at: datetime | None
    started_at: datetime | None
    finished_at: datetime | None
    cancel_requested_at: datetime | None
    assigned_worker_id: str | None
    assigned_gpu_id: str | None
    progress: float | None
    result: dict[str, Any] | None
    error: TaskError | None
    scheduler_decision: dict[str, Any] | None


class TaskDetail(TaskRead):
    events: list[TaskEventRead]


class TaskList(BaseModel):
    tasks: list[TaskRead]
    total: int
