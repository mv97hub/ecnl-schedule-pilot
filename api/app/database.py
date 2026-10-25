from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.config import build_database_url

engine = create_engine(build_database_url(), pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

_RESULT_COLUMNS = (
    ("status", "ADD COLUMN IF NOT EXISTS status varchar(16) NOT NULL DEFAULT 'SCHEDULED'"),
    ("home_score", "ADD COLUMN IF NOT EXISTS home_score integer"),
    ("away_score", "ADD COLUMN IF NOT EXISTS away_score integer"),
    ("is_conference_game", "ADD COLUMN IF NOT EXISTS is_conference_game boolean NOT NULL DEFAULT true"),
)


def _table_exists(connection, table: str) -> bool:
    return connection.execute(text("SELECT to_regclass(:name)"), {"name": f"public.{table}"}).scalar() is not None


def _column_exists(connection, table: str, column: str) -> bool:
    return (
        connection.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = :table AND column_name = :column
                """
            ),
            {"table": table, "column": column},
        ).first()
        is not None
    )


def _constraint_exists(connection, table: str, name: str) -> bool:
    return (
        connection.execute(
            text(
                """
                SELECT 1
                FROM pg_constraint AS constraint_row
                JOIN pg_class AS table_row ON table_row.oid = constraint_row.conrelid
                JOIN pg_namespace AS namespace_row ON namespace_row.oid = table_row.relnamespace
                WHERE namespace_row.nspname = 'public'
                  AND table_row.relname = :table
                  AND constraint_row.conname = :name
                """
            ),
            {"table": table, "name": name},
        ).first()
        is not None
    )


def _unique_index_exists(connection, table: str, name: str) -> bool:
    return (
        connection.execute(
            text(
                """
                SELECT 1
                FROM pg_class AS index_row
                JOIN pg_namespace AS namespace_row ON namespace_row.oid = index_row.relnamespace
                JOIN pg_index AS index_meta ON index_meta.indexrelid = index_row.oid
                JOIN pg_class AS table_row ON table_row.oid = index_meta.indrelid
                WHERE namespace_row.nspname = 'public'
                  AND index_row.relname = :name
                  AND table_row.relname = :table
                  AND index_meta.indisunique
                """
            ),
            {"table": table, "name": name},
        ).first()
        is not None
    )


def _conference_is_varchar_120(connection) -> bool:
    row = connection.execute(
        text(
            """
            SELECT data_type, character_maximum_length
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'team' AND column_name = 'conference'
            """
        )
    ).one_or_none()
    return row is not None and row.data_type == "character varying" and row.character_maximum_length == 120


def ensure_result_columns() -> None:
    """Add score columns when missing. Skip ALTER TABLE once they are already present."""

    with engine.begin() as connection:
        for table in ("game", "ingest_game"):
            if not _table_exists(connection, table):
                continue
            for column, clause in _RESULT_COLUMNS:
                if not _column_exists(connection, table, column):
                    connection.execute(text(f"ALTER TABLE {table} {clause}"))
            constraint = f"ck_{table}_status"
            if not _constraint_exists(connection, table, constraint):
                connection.execute(
                    text(
                        f"""
                        DO $$ BEGIN
                          ALTER TABLE {table} ADD CONSTRAINT {constraint}
                            CHECK (status IN ('SCHEDULED', 'COMPLETED', 'POSTPONED', 'CANCELLED'));
                        EXCEPTION WHEN duplicate_object THEN NULL;
                        END $$
                        """
                    )
                )
        if _table_exists(connection, "team"):
            if not _column_exists(connection, "team", "tier"):
                connection.execute(text("ALTER TABLE team ADD COLUMN IF NOT EXISTS tier varchar(16) NOT NULL DEFAULT 'ECNL'"))
            if not _conference_is_varchar_120(connection):
                connection.execute(text("ALTER TABLE team ALTER COLUMN conference TYPE varchar(120)"))
            if not _constraint_exists(connection, "team", "ck_team_tier"):
                connection.execute(
                    text(
                        """
                        DO $$ BEGIN
                          ALTER TABLE team ADD CONSTRAINT ck_team_tier
                            CHECK (tier IN ('ECNL', 'ECNL-RL'));
                        EXCEPTION WHEN duplicate_object THEN NULL;
                        END $$
                        """
                    )
                )


def ensure_source_columns() -> None:
    """Keep external league ids. Skip ALTER TABLE and CREATE UNIQUE INDEX when they already exist."""

    with engine.begin() as connection:
        for table in ("team", "game"):
            if not _table_exists(connection, table):
                continue
            if not _column_exists(connection, table, "source_id"):
                connection.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS source_id integer"))
            index_name = f"uq_{table}_source_id"
            if not _unique_index_exists(connection, table, index_name):
                connection.execute(text(f"CREATE UNIQUE INDEX IF NOT EXISTS {index_name} ON {table} (source_id)"))


def get_session() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
