"""Entry point: ``uv run python -m pixelgpu`` starts the API server."""

import uvicorn

from pixelgpu.config import get_settings


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "pixelgpu.main:app",
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level,
        reload=settings.environment == "development",
    )


if __name__ == "__main__":
    main()
