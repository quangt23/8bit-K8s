from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext

from pixelgpu.db import Base, create_db_engine, upgrade_database
from pixelgpu.tasks import models  # noqa: F401


def test_migrations_match_the_models(database_url: str) -> None:
    upgrade_database(database_url)
    engine = create_db_engine(database_url)
    with engine.connect() as connection:
        diff = compare_metadata(MigrationContext.configure(connection), Base.metadata)
    engine.dispose()

    assert diff == []


def test_upgrade_is_idempotent(database_url: str) -> None:
    upgrade_database(database_url)
    upgrade_database(database_url)
