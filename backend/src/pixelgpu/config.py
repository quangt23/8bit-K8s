"""Application settings, loaded from environment variables prefixed with ``PIXELGPU_``."""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="PIXELGPU_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: Literal["development", "test", "production"] = "development"
    host: str = "127.0.0.1"
    port: int = 8000
    log_level: Literal["debug", "info", "warning", "error"] = "info"
    # Origins allowed to call the API directly. The Vite dev server proxies /api,
    # so this is only needed when the frontend is served from another origin.
    cors_origins: list[str] = []
    # Register the built-in simulated fleet (6 GPUs on 2 workers) at startup.
    simulated_fleet: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()
