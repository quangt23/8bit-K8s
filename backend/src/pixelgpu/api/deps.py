"""Shared FastAPI dependencies."""

from typing import Annotated, cast

from fastapi import Depends, Request

from pixelgpu.config import Settings


def get_app_settings(request: Request) -> Settings:
    """Return the settings the running app was created with."""
    return cast(Settings, request.app.state.settings)


SettingsDep = Annotated[Settings, Depends(get_app_settings)]
