"""Shared FastAPI dependencies."""

from collections.abc import Iterator
from typing import Annotated, cast

from fastapi import Depends, Request
from sqlalchemy.orm import Session, sessionmaker

from pixelgpu.config import Settings
from pixelgpu.fleet.registry import FleetRegistry
from pixelgpu.tasks.service import TaskService


def get_app_settings(request: Request) -> Settings:
    """Return the settings the running app was created with."""
    return cast(Settings, request.app.state.settings)


def get_fleet(request: Request) -> FleetRegistry:
    return cast(FleetRegistry, request.app.state.fleet)


def get_session(request: Request) -> Iterator[Session]:
    factory = cast(sessionmaker[Session], request.app.state.session_factory)
    with factory() as session:
        yield session


SettingsDep = Annotated[Settings, Depends(get_app_settings)]
FleetDep = Annotated[FleetRegistry, Depends(get_fleet)]
SessionDep = Annotated[Session, Depends(get_session)]


def get_task_service(session: SessionDep, settings: SettingsDep) -> TaskService:
    return TaskService(session, max_active_tasks=settings.max_active_tasks)


TaskServiceDep = Annotated[TaskService, Depends(get_task_service)]
