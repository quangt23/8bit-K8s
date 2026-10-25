"""FastAPI application factory.

Run locally with: ``uv run uvicorn pixelgpu.main:app --reload``
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from pixelgpu import __version__
from pixelgpu.api import health
from pixelgpu.config import Settings, get_settings

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
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=["GET", "POST", "DELETE"],
            allow_headers=["Content-Type"],
        )
    app.include_router(health.router, prefix=API_PREFIX)
    return app


app = create_app()
