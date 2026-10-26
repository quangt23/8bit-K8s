"""FastAPI application factory.

Run locally with: ``uv run uvicorn pixelgpu.main:app --reload``
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from pixelgpu import __version__
from pixelgpu.api import fleet, health
from pixelgpu.config import Settings, get_settings
from pixelgpu.fleet.registry import FleetRegistry
from pixelgpu.fleet.simulated import build_simulated_fleet

API_PREFIX = "/api"


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(
        title="PixelGPU API",
        version=__version__,
        docs_url=f"{API_PREFIX}/docs",
        openapi_url=f"{API_PREFIX}/openapi.json",
    )
    app.state.settings = settings
    app.state.fleet = (
        FleetRegistry(*build_simulated_fleet()) if settings.simulated_fleet else FleetRegistry()
    )
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=["GET", "POST", "DELETE"],
            allow_headers=["Content-Type"],
        )
    app.include_router(health.router, prefix=API_PREFIX)
    app.include_router(fleet.router, prefix=API_PREFIX)
    return app


app = create_app()
