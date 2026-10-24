"""League refresh upserts in place and a failure keeps the last success time."""

from __future__ import annotations

import io
import sys
import unittest
from contextlib import redirect_stdout
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

import refresh_league
from app.database import engine
from app.main import app
from app.models import DataRefresh
from app.refresh import RefreshCounts, complete_refresh, ensure_refresh_tables, open_refresh

HOME_SOURCE = 910000001
AWAY_SOURCE = 910000002
GAME_SOURCE = 910000101


def _payload(home_score: int = 1, away_score: int = 0, venue: str = "Probe Park") -> dict:
    return {
        "teams": [
            {
                "source_id": HOME_SOURCE,
                "name": "Probe Refresh Home",
                "age_group": "U13",
                "tier": "ECNL",
                "conference": "Probe Conference",
                "city": "Jacksonville",
                "state": "FL",
            },
            {
                "source_id": AWAY_SOURCE,
                "name": "Probe Refresh Away",
                "age_group": "U13",
                "tier": "ECNL",
                "conference": "Probe Conference",
                "city": "Tampa",
                "state": "FL",
            },
        ],
        "games": [
            {
                "source_id": GAME_SOURCE,
                "home_source_id": HOME_SOURCE,
                "away_source_id": AWAY_SOURCE,
                "starts_at": "2026-10-24T13:00:00-04:00",
                "timezone": "America/New_York",
                "venue_name": venue,
                "city": "Jacksonville",
                "state": "FL",
                "event": None,
                "status": "COMPLETED",
                "home_score": home_score,
                "away_score": away_score,
            }
        ],
    }


def _instant(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


class RefreshTests(unittest.TestCase):
    def setUp(self) -> None:
        ensure_refresh_tables()
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
                       OR home_team_id IN (SELECT id FROM team WHERE source_id IN (:home, :away) OR name LIKE 'Probe Refresh %')
                       OR away_team_id IN (SELECT id FROM team WHERE source_id IN (:home, :away) OR name LIKE 'Probe Refresh %')
                    """
                ),
                {"game": GAME_SOURCE, "home": HOME_SOURCE, "away": AWAY_SOURCE},
            )
            connection.execute(
                text("DELETE FROM team WHERE source_id IN (:home, :away) OR name LIKE 'Probe Refresh %'"),
                {"home": HOME_SOURCE, "away": AWAY_SOURCE},
            )
            connection.execute(text("DELETE FROM data_refresh WHERE error LIKE '%probe-failure%'"))
            connection.execute(
                text(
                    """
                    DELETE FROM data_refresh
                    WHERE (teams_count, games_count, scores_count) IN ((1, 2, 3), (4, 5, 6))
                    """
                )
            )

    def _counts(self) -> tuple[int, int]:
        with engine.connect() as connection:
            teams = connection.execute(text("SELECT count(*) FROM team")).scalar()
            games = connection.execute(text("SELECT count(*) FROM game")).scalar()
        return int(teams or 0), int(games or 0)

    def test_upsert_does_not_drop_tables(self) -> None:
        from app.refresh import upsert_published

        before_teams, before_games = self._counts()
        with engine.connect() as connection:
            sample_id = connection.execute(text("SELECT id FROM team ORDER BY id LIMIT 1")).scalar()
            self.assertIsNotNone(connection.execute(text("SELECT to_regclass('public.team')")).scalar())

        first = upsert_published(_payload(), refresh_standings=False)
        self.assertEqual((first.teams, first.games, first.scores), (2, 1, 1))
        after_teams, after_games = self._counts()
        self.assertEqual(after_teams, before_teams + 2)
        self.assertEqual(after_games, before_games + 1)
        with engine.connect() as connection:
            if sample_id is not None:
                self.assertEqual(connection.execute(text("SELECT id FROM team WHERE id = :id"), {"id": sample_id}).scalar(), sample_id)
            self.assertIsNotNone(connection.execute(text("SELECT to_regclass('public.game')")).scalar())

        second = upsert_published(_payload(), refresh_standings=False)
        self.assertEqual((second.teams, second.games, second.scores), (0, 0, 0))
        self.assertEqual(self._counts(), (after_teams, after_games))

        scored = upsert_published(_payload(home_score=3, away_score=1), refresh_standings=False)
        self.assertEqual((scored.teams, scored.games, scored.scores), (0, 0, 1))
        moved = upsert_published(_payload(home_score=3, away_score=1, venue="Probe Field"), refresh_standings=False)
        self.assertEqual((moved.teams, moved.games, moved.scores), (0, 1, 0))

    def test_failed_run_keeps_the_last_success(self) -> None:
        success_at = datetime(2026, 10, 24, 12, 0, tzinfo=UTC)
        success_id = open_refresh(success_at)
        complete_refresh(success_id, success_at, RefreshCounts(1, 2, 3))

        with patch("refresh_league.load", side_effect=RuntimeError("probe-failure")), redirect_stdout(io.StringIO()) as stdout:
            code = refresh_league.run()
        self.assertEqual(code, 1)
        printed = stdout.getvalue()
        self.assertIn("League refresh start", printed)
        self.assertIn("League refresh failure", printed)
        self.assertIn("probe-failure", printed)

        with Session(engine) as session:
            success = session.get(DataRefresh, success_id)
            self.assertIsNotNone(success)
            assert success is not None
            self.assertEqual(success.status, "success")
            self.assertEqual(_instant(success.finished_at), success_at)

        with TestClient(app) as client:
            payload = client.get("/data-refresh").json()
        stamp = str(payload["last_successful_finish"]).replace("+00:00", "Z")
        self.assertEqual(stamp, "2026-10-24T12:00:00Z")

        with (
            patch("refresh_league.load", return_value={"teams": [], "games": []}),
            patch("refresh_league.upsert_published", return_value=RefreshCounts(4, 5, 6)),
            redirect_stdout(io.StringIO()) as stdout,
        ):
            self.assertEqual(refresh_league.run(), 0)
        printed = stdout.getvalue()
        self.assertIn("teams=4 games=5 scores=6", printed)
        self.assertIn("League refresh success", printed)

        with TestClient(app) as client:
            later = str(client.get("/data-refresh").json()["last_successful_finish"]).replace("+00:00", "Z")
        self.assertNotEqual(later, "2026-10-24T12:00:00Z")
