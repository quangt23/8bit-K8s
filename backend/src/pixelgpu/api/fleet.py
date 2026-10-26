"""Read-only fleet endpoints: workers and GPU devices."""

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from pixelgpu.api.deps import FleetDep, SessionDep
from pixelgpu.fleet.live import live_gpus, live_workers
from pixelgpu.fleet.models import GpuDevice, Worker

router = APIRouter(tags=["fleet"])


class FleetSnapshot(BaseModel):
    """Workers and GPUs read together, so the UI never mixes two points in time."""

    workers: list[Worker]
    gpus: list[GpuDevice]
    generated_at: datetime


@router.get("/fleet", response_model=FleetSnapshot)
def get_fleet(fleet: FleetDep, session: SessionDep) -> FleetSnapshot:
    return FleetSnapshot(
        workers=live_workers(fleet),
        gpus=live_gpus(session, fleet),
        generated_at=datetime.now(UTC),
    )


@router.get("/workers", response_model=list[Worker])
def list_workers(fleet: FleetDep) -> list[Worker]:
    return live_workers(fleet)


@router.get("/gpus", response_model=list[GpuDevice])
def list_gpus(fleet: FleetDep, session: SessionDep) -> list[GpuDevice]:
    return live_gpus(session, fleet)


@router.get(
    "/gpus/{gpu_id}",
    response_model=GpuDevice,
    responses={status.HTTP_404_NOT_FOUND: {"description": "No GPU with this id"}},
)
def get_gpu(gpu_id: str, fleet: FleetDep, session: SessionDep) -> GpuDevice:
    gpu = next((g for g in live_gpus(session, fleet) if g.id == gpu_id), None)
    if gpu is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"GPU '{gpu_id}' not found.")
    return gpu
