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
    database_url: str = "sqlite:///./pixelgpu.db"
    # Apply pending migrations at startup. Disable when migrations are run as a deploy step.
    auto_migrate: bool = True
    # Submission limit: queued + scheduled + running tasks allowed at once.
    max_active_tasks: int = 100
    # Run the scheduler loop and simulated workers in this process.
    scheduler_enabled: bool = True
    # Seconds between scheduling passes when nothing wakes the scheduler sooner.
    scheduler_interval_seconds: float = 1.0
    # Simulated time runs this many times faster than real time (tests use large values).
    simulation_speed: float = 1.0
    # Tasks running longer than this (in simulated seconds) fail with a timeout.
    task_timeout_seconds: float = 600.0
    # Register the built-in simulated fleet (6 GPUs on 2 workers) at startup.
    simulated_fleet: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()
