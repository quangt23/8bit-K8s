"""Entry point: ``uv run python -m pixelgpu`` starts the API server."""

import logging

import uvicorn

from pixelgpu.config import get_settings


def main() -> None:
    settings = get_settings()
    # Show PixelGPU's own logs (scheduler, workers) next to uvicorn's.
    logging.basicConfig(
        level=settings.log_level.upper(),
        format="%(levelname)s:     [%(name)s] %(message)s",
    )
    uvicorn.run(
        "pixelgpu.main:app",
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level,
        reload=settings.environment == "development",
    )


if __name__ == "__main__":
    main()
