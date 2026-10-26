"""Read-only fleet endpoints: workers and GPU devices."""

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from pixelgpu.api.deps import FleetDep
from pixelgpu.fleet.models import GpuDevice, Worker

router = APIRouter(tags=["fleet"])


class FleetSnapshot(BaseModel):
    """Workers and GPUs read together, so the UI never mixes two points in time."""

    workers: list[Worker]
    gpus: list[GpuDevice]
    generated_at: datetime


@router.get("/fleet", response_model=FleetSnapshot)
def get_fleet(fleet: FleetDep) -> FleetSnapshot:
    return FleetSnapshot(
        workers=fleet.list_workers(),
        gpus=fleet.list_gpus(),
        generated_at=datetime.now(UTC),
    )


@router.get("/workers", response_model=list[Worker])
def list_workers(fleet: FleetDep) -> list[Worker]:
    return fleet.list_workers()


@router.get("/gpus", response_model=list[GpuDevice])
def list_gpus(fleet: FleetDep) -> list[GpuDevice]:
    return fleet.list_gpus()


@router.get(
    "/gpus/{gpu_id}",
    response_model=GpuDevice,
    responses={status.HTTP_404_NOT_FOUND: {"description": "No GPU with this id"}},
)
def get_gpu(gpu_id: str, fleet: FleetDep) -> GpuDevice:
    gpu = fleet.get_gpu(gpu_id)
    if gpu is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"GPU '{gpu_id}' not found.")
    return gpu
