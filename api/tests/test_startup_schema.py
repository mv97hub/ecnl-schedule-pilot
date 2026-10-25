"""A cold API start reads committed rows while a refresh transaction is open."""

from __future__ import annotations

import sys
import unittest
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import event, text
from sqlalchemy.orm import Session
from sqlmodel import SQLModel

from app.database import engine, ensure_result_columns, ensure_source_columns
from app.models import Base, ScheduleGame, ScheduleTeam
from app.routers.teams import list_teams, team_schedule

HOME_SOURCE = 910000301
AWAY_SOURCE = 910000302
GAME_SOURCE = 910000303


def _limit_lock_wait(dbapi_connection, _record, _proxy) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("SET lock_timeout = '2s'")
    cursor.close()


class StartupSchemaTests(unittest.TestCase):
    def setUp(self) -> None:
        self._cleanup()

    def tearDown(self) -> None:
        self._cleanup()

    def _cleanup(self) -> None:
        with engine.begin() as connection:
            connection.execute(
                text(
                    """
                    DELETE FROM game
                    WHERE source_id = :game
                       OR home_team_id IN (SELECT id FROM team WHERE source_id IN (:home, :away) OR name LIKE 'Probe Startup %')
                       OR away_team_id IN (SELECT id FROM team WHERE source_id IN (:home, :away) OR name LIKE 'Probe Startup %')
                    """
                ),
                {"game": GAME_SOURCE, "home": HOME_SOURCE, "away": AWAY_SOURCE},
            )
            connection.execute(
                text("DELETE FROM team WHERE source_id IN (:home, :away) OR name LIKE 'Probe Startup %'"),
                {"home": HOME_SOURCE, "away": AWAY_SOURCE},
            )

    def test_cold_start_reads_committed_rows_during_refresh_transaction(self) -> None:
        with Session(engine) as session:
            home = ScheduleTeam(
                name="Probe Startup Home",
                age_group="U13",
                tier="ECNL",
                conference="Probe Startup Conference",
                city="Jacksonville",
                state="FL",
                source_id=HOME_SOURCE,
            )
            away = ScheduleTeam(
                name="Probe Startup Away",
                age_group="U13",
                tier="ECNL",
                conference="Probe Startup Conference",
                city="Tampa",
                state="FL",
                source_id=AWAY_SOURCE,
            )
            session.add_all((home, away))
            session.flush()
            session.add(
                ScheduleGame(
                    home_team_id=home.id,
                    away_team_id=away.id,
                    starts_at=datetime(2026, 10, 24, 17, 0, tzinfo=UTC),
                    venue_name="Probe Park",
                    city="Jacksonville",
                    state="FL",
                    timezone="America/New_York",
                    event=None,
                    status="SCHEDULED",
                    home_score=None,
                    away_score=None,
                    is_conference_game=True,
                    source_id=GAME_SOURCE,
                )
            )
            session.commit()
            home_id = int(home.id)

        holder = engine.connect()
        transaction = holder.begin()
        holder.execute(text("SELECT id FROM team WHERE source_id = :id"), {"id": HOME_SOURCE})
        holder.execute(text("SELECT id FROM game WHERE source_id = :id"), {"id": GAME_SOURCE})
        holder.execute(text("UPDATE team SET city = 'Blocked' WHERE source_id = :id"), {"id": HOME_SOURCE})
        event.listen(engine, "checkout", _limit_lock_wait)
        try:
            Base.metadata.create_all(engine)
            SQLModel.metadata.create_all(engine)
            ensure_result_columns()
            ensure_source_columns()
            with Session(engine) as session:
                teams = list_teams(session, q=None, age_group=None)
                match = next(team for team in teams if team.source_id == HOME_SOURCE)
                self.assertEqual(match.city, "Jacksonville")
                schedule = team_schedule(home_id, session, filter="all")
            self.assertEqual(len(schedule.games), 1)
            self.assertEqual(schedule.games[0].venue_name, "Probe Park")
        finally:
            event.remove(engine, "checkout", _limit_lock_wait)
            transaction.rollback()
            holder.close()
            engine.dispose()


if __name__ == "__main__":
    unittest.main()
