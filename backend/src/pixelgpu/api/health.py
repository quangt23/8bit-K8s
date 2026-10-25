"""Liveness endpoint used by the frontend and by local tooling."""

from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from pixelgpu import __version__
from pixelgpu.api.deps import SettingsDep

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    version: str
    environment: str
    server_time: datetime


@router.get("/health", response_model=HealthResponse)
def health(settings: SettingsDep) -> HealthResponse:
    return HealthResponse(
        status="ok",
        service="pixelgpu-backend",
        version=__version__,
        environment=settings.environment,
        server_time=datetime.now(UTC),
    )
