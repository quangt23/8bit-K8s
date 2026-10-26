"""FastAPI application factory.

Run locally with: ``uv run python -m pixelgpu``
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import event

from pixelgpu import __version__
from pixelgpu.api import fleet, health, live, tasks
from pixelgpu.api.errors import install_error_handlers
from pixelgpu.config import Settings, get_settings
from pixelgpu.db import create_db_engine, create_session_factory, upgrade_database
from pixelgpu.fleet.registry import FleetRegistry
from pixelgpu.fleet.simulated import build_simulated_fleet
from pixelgpu.live.broadcaster import LiveBroadcaster
from pixelgpu.runtime import Runtime

API_PREFIX = "/api"


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    engine = create_db_engine(settings.database_url)
    session_factory = create_session_factory(engine)
    fleet_registry = (
        FleetRegistry(*build_simulated_fleet()) if settings.simulated_fleet else FleetRegistry()
    )
    runtime = Runtime(settings, session_factory, fleet_registry)
    broadcaster = LiveBroadcaster()
    # Every commit, from any thread or code path, tells live clients to refresh.
    event.listen(session_factory, "after_commit", lambda _session: broadcaster.notify())

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        if settings.auto_migrate:
            upgrade_database(settings.database_url)
        await broadcaster.start()
        if settings.scheduler_enabled:
            runtime.start()
        try:
            yield
        finally:
            runtime.stop()
            await broadcaster.stop()
            engine.dispose()

    app = FastAPI(
        title="PixelGPU API",
        version=__version__,
        docs_url=f"{API_PREFIX}/docs",
        openapi_url=f"{API_PREFIX}/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.session_factory = session_factory
    app.state.fleet = fleet_registry
    app.state.runtime = runtime
    app.state.broadcaster = broadcaster
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=["GET", "POST", "DELETE"],
            allow_headers=["Content-Type"],
        )
    install_error_handlers(app)
    app.include_router(health.router, prefix=API_PREFIX)
    app.include_router(fleet.router, prefix=API_PREFIX)
    app.include_router(tasks.router, prefix=API_PREFIX)
    app.include_router(live.router, prefix=API_PREFIX)
    return app


app = create_app()
