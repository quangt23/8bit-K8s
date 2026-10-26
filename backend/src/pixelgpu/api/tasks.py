"""Task endpoints. Clients can create, read and cancel tasks, but never set their
status, assignment or resource measurements: those belong to the backend."""

from typing import Annotated, Any

from fastapi import APIRouter, Query, status

from pixelgpu.api.deps import TaskServiceDep
from pixelgpu.api.errors import ErrorResponse
from pixelgpu.tasks.lifecycle import TaskStatus
from pixelgpu.tasks.models import TaskRecord
from pixelgpu.tasks.schemas import TaskCreate, TaskDetail, TaskList, TaskRead
from pixelgpu.tasks.service import TaskService
from pixelgpu.tasks.workloads import WorkloadInfo, workload_catalog

router = APIRouter(tags=["tasks"])

NOT_FOUND: dict[int | str, dict[str, Any]] = {status.HTTP_404_NOT_FOUND: {"model": ErrorResponse}}


def _read(
    task: TaskRecord, service: TaskService, positions: dict[str, int] | None = None
) -> TaskRead:
    positions = positions if positions is not None else service.queue_positions()
    return TaskRead.model_validate(task).model_copy(
        update={"queue_position": positions.get(task.id)}
    )


@router.get("/workloads", response_model=list[WorkloadInfo])
def list_workloads() -> list[WorkloadInfo]:
    return workload_catalog()


@router.post(
    "/tasks",
    response_model=TaskRead,
    status_code=status.HTTP_201_CREATED,
    responses={
        status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": ErrorResponse},
        status.HTTP_429_TOO_MANY_REQUESTS: {"model": ErrorResponse},
    },
)
def create_task(request: TaskCreate, service: TaskServiceDep) -> TaskRead:
    return _read(service.create(request), service)


@router.get("/tasks", response_model=TaskList)
def list_tasks(
    service: TaskServiceDep,
    status_filter: Annotated[TaskStatus | None, Query(alias="status")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> TaskList:
    tasks, total = service.list(status=status_filter, limit=limit)
    positions = service.queue_positions()
    return TaskList(tasks=[_read(task, service, positions) for task in tasks], total=total)


@router.get("/tasks/{task_id}", response_model=TaskDetail, responses=NOT_FOUND)
def get_task(task_id: str, service: TaskServiceDep) -> TaskDetail:
    task = service.get(task_id, with_events=True)
    summary = _read(task, service)
    return TaskDetail.model_validate(task).model_copy(
        update={"queue_position": summary.queue_position}
    )


@router.post(
    "/tasks/{task_id}/cancel",
    response_model=TaskRead,
    responses={**NOT_FOUND, status.HTTP_409_CONFLICT: {"model": ErrorResponse}},
)
def cancel_task(task_id: str, service: TaskServiceDep) -> TaskRead:
    return _read(service.cancel(task_id), service)
