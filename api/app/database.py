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


def _index_exists(connection, table: str, name: str) -> bool:
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


_GAME_CAPTURE_COLUMNS = (
    ("venue_address", "ADD COLUMN venue_address text"),
    ("venue_zip", "ADD COLUMN venue_zip varchar(16)"),
    ("venue_lat", "ADD COLUMN venue_lat double precision"),
    ("venue_lng", "ADD COLUMN venue_lng double precision"),
    ("field_name", "ADD COLUMN field_name varchar(160)"),
    ("stream_link", "ADD COLUMN stream_link text"),
    ("field_surface", "ADD COLUMN field_surface varchar(80)"),
    ("postponement_reason", "ADD COLUMN postponement_reason text"),
)


def _add_check(connection, table: str, name: str, expression: str) -> None:
    if _constraint_exists(connection, table, name):
        return
    connection.execute(
        text(
            f"""
            DO $$ BEGIN
              ALTER TABLE {table} ADD CONSTRAINT {name} CHECK ({expression});
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$
            """
        )
    )


def ensure_capture_columns() -> None:
    """Add AthleteOne columns and ix_team_club_id once. Later cold starts only read the catalog."""

    with engine.begin() as connection:
        if _table_exists(connection, "team"):
            if not _column_exists(connection, "team", "gender"):
                connection.execute(text("ALTER TABLE team ADD COLUMN gender varchar(8) NOT NULL DEFAULT 'boys'"))
            if not _column_exists(connection, "team", "club_id"):
                connection.execute(text("ALTER TABLE team ADD COLUMN club_id integer"))
            if not _index_exists(connection, "team", "ix_team_club_id"):
                connection.execute(text("CREATE INDEX IF NOT EXISTS ix_team_club_id ON team (club_id)"))
            _add_check(connection, "team", "ck_team_gender", "gender IN ('boys', 'girls')")
        if _table_exists(connection, "game"):
            for column, clause in _GAME_CAPTURE_COLUMNS:
                if not _column_exists(connection, "game", column):
                    connection.execute(text(f"ALTER TABLE game {clause}"))
        if _table_exists(connection, "data_refresh"):
            if not _column_exists(connection, "data_refresh", "job"):
                connection.execute(text("ALTER TABLE data_refresh ADD COLUMN job varchar(16) NOT NULL DEFAULT 'schedule'"))
            _add_check(connection, "data_refresh", "ck_data_refresh_job", "job IN ('schedule', 'people', 'reference')")
        if not _table_exists(connection, "conference_standing"):
            return
        if not _column_exists(connection, "conference_standing", "gender"):
            connection.execute(
                text("ALTER TABLE conference_standing ADD COLUMN gender varchar(8) NOT NULL DEFAULT 'boys'")
            )
        if not _column_exists(connection, "conference_standing", "capped_goal_diff"):
            connection.execute(text("ALTER TABLE conference_standing ADD COLUMN capped_goal_diff integer"))
        _add_check(connection, "conference_standing", "ck_conference_standing_gender", "gender IN ('boys', 'girls')")
        if _constraint_exists(connection, "conference_standing", "uq_conference_standing_with_gender"):
            return
        connection.execute(
            text(
                """
                DO $$
                DECLARE
                  constraint_name text;
                BEGIN
                  FOR constraint_name IN
                    SELECT constraint_row.conname
                    FROM pg_constraint AS constraint_row
                    JOIN pg_class AS table_row ON table_row.oid = constraint_row.conrelid
                    JOIN pg_namespace AS namespace_row ON namespace_row.oid = table_row.relnamespace
                    WHERE namespace_row.nspname = 'public'
                      AND table_row.relname = 'conference_standing'
                      AND constraint_row.contype = 'u'
                      AND pg_get_constraintdef(constraint_row.oid) NOT ILIKE '%gender%'
                  LOOP
                    EXECUTE format('ALTER TABLE conference_standing DROP CONSTRAINT %I', constraint_name);
                  END LOOP;
                END $$
                """
            )
        )
        connection.execute(
            text(
                """
                ALTER TABLE conference_standing
                ADD CONSTRAINT uq_conference_standing_with_gender
                UNIQUE (conference, tier, gender, age_group, team_name)
                """
            )
        )


def _constraint_definition(connection, table: str, name: str) -> str | None:
    row = connection.execute(
        text(
            """
            SELECT pg_get_constraintdef(constraint_row.oid)
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
    return None if row is None else str(row[0])


def _add_timestamp(connection, table: str, column: str, *, nullable: bool) -> None:
    if not _table_exists(connection, table) or _column_exists(connection, table, column):
        return
    if nullable:
        connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} timestamp with time zone"))
        return
    connection.execute(
        text(f"ALTER TABLE {table} ADD COLUMN {column} timestamp with time zone NOT NULL DEFAULT now()")
    )


def ensure_location_columns() -> None:
    """Add tip votes and contribution-review columns. New tables come from create_all."""

    with engine.begin() as connection:
        if _table_exists(connection, "venue_recommendation"):
            if not _column_exists(connection, "venue_recommendation", "downvotes"):
                connection.execute(
                    text("ALTER TABLE venue_recommendation ADD COLUMN downvotes integer NOT NULL DEFAULT 0")
                )
            _add_check(connection, "venue_recommendation", "ck_venue_recommendation_downvotes", "downvotes >= 0")
        for table in ("venue_rating", "venue_recommendation", "venue_tip_vote"):
            _add_timestamp(connection, table, "hidden_at", nullable=True)
            _add_timestamp(connection, table, "flagged_at", nullable=True)
        for table in ("venue_rating", "venue_recommendation"):
            _add_timestamp(connection, table, "edited_at", nullable=True)
        _add_timestamp(connection, "venue_tip_vote", "updated_at", nullable=False)
        if not _table_exists(connection, "location_write_event"):
            return
        name = "ck_location_write_event_action"
        definition = _constraint_definition(connection, "location_write_event", name)
        if definition is not None and "hide" not in definition:
            connection.execute(text(f"ALTER TABLE location_write_event DROP CONSTRAINT {name}"))
            definition = None
        if definition is None:
            _add_check(
                connection,
                "location_write_event",
                name,
                "action IN ('create', 'update', 'hide', 'restore', 'edit')",
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


def ensure_account_columns() -> None:
    """Add last_login_at. Copy the newest session time once where that column is still empty."""

    with engine.begin() as connection:
        if not _table_exists(connection, "app_user"):
            return
        if not _column_exists(connection, "app_user", "last_login_at"):
            connection.execute(text("ALTER TABLE app_user ADD COLUMN last_login_at timestamp with time zone"))
        if not _table_exists(connection, "app_session"):
            return
        connection.execute(
            text(
                """
                UPDATE app_user AS account
                SET last_login_at = newest.created_at
                FROM (
                    SELECT user_id, MAX(created_at) AS created_at
                    FROM app_session
                    GROUP BY user_id
                ) AS newest
                WHERE account.id = newest.user_id
                  AND account.last_login_at IS NULL
                """
            )
        )


def get_session() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
