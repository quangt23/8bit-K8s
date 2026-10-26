"""Shared FastAPI dependencies."""

from typing import Annotated, cast

from fastapi import Depends, Request

from pixelgpu.config import Settings
from pixelgpu.fleet.registry import FleetRegistry


def get_app_settings(request: Request) -> Settings:
    """Return the settings the running app was created with."""
    return cast(Settings, request.app.state.settings)


def get_fleet(request: Request) -> FleetRegistry:
    return cast(FleetRegistry, request.app.state.fleet)


SettingsDep = Annotated[Settings, Depends(get_app_settings)]
FleetDep = Annotated[FleetRegistry, Depends(get_fleet)]
