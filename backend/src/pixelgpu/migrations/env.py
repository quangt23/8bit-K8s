"""Alembic environment. The database URL comes from the caller or from settings."""

from alembic import context

from pixelgpu.config import get_settings
from pixelgpu.db import Base, create_db_engine
from pixelgpu.scheduling import models as _scheduling_models  # noqa: F401  (registers tables)
from pixelgpu.tasks import models as _task_models  # noqa: F401

target_metadata = Base.metadata


def _url() -> str:
    return context.config.get_main_option("sqlalchemy.url") or get_settings().database_url


def run_migrations_offline() -> None:
    context.configure(url=_url(), target_metadata=target_metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_db_engine(_url())
    with engine.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata, render_as_batch=True
        )
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
