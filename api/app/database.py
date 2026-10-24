from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.config import build_database_url

engine = create_engine(build_database_url(), pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

_RESULT_COLUMNS = (
    "ADD COLUMN IF NOT EXISTS status varchar(16) NOT NULL DEFAULT 'SCHEDULED'",
    "ADD COLUMN IF NOT EXISTS home_score integer",
    "ADD COLUMN IF NOT EXISTS away_score integer",
    "ADD COLUMN IF NOT EXISTS is_conference_game boolean NOT NULL DEFAULT true",
)


def ensure_result_columns() -> None:
    """Add score columns to tables that were created before results existed."""

    with engine.begin() as connection:
        for table in ("game", "ingest_game"):
            if connection.execute(text("SELECT to_regclass(:name)"), {"name": f"public.{table}"}).scalar() is None:
                continue
            for clause in _RESULT_COLUMNS:
                connection.execute(text(f"ALTER TABLE {table} {clause}"))
            connection.execute(
                text(
                    f"""
                    DO $$ BEGIN
                      ALTER TABLE {table} ADD CONSTRAINT ck_{table}_status
                        CHECK (status IN ('SCHEDULED', 'COMPLETED', 'POSTPONED', 'CANCELLED'));
                    EXCEPTION WHEN duplicate_object THEN NULL;
                    END $$
                    """
                )
            )
        if connection.execute(text("SELECT to_regclass('public.team')")).scalar() is not None:
            connection.execute(text("ALTER TABLE team ADD COLUMN IF NOT EXISTS tier varchar(16) NOT NULL DEFAULT 'ECNL'"))
            connection.execute(text("ALTER TABLE team ALTER COLUMN conference TYPE varchar(120)"))
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


def get_session() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
