"""League refresh upserts in place and a failure keeps the last success time."""

from __future__ import annotations

import io
import sys
import unittest
from contextlib import redirect_stdout
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

import refresh_league
from app.database import engine
from app.main import app
from app.models import DataRefresh, ScheduleGame, ScheduleTeam
from app.refresh import RefreshCounts, complete_refresh, ensure_refresh_tables, open_refresh, upsert_published

HOME_SOURCE = 910000001
AWAY_SOURCE = 910000002
GAME_SOURCE = 910000101
_RECENT_KICKOFF = (datetime.now(UTC) - timedelta(days=1)).isoformat()


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
                "starts_at": _RECENT_KICKOFF,
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
        with engine.connect() as connection:
            game_id = connection.execute(text("SELECT id FROM game WHERE source_id = :game"), {"game": GAME_SOURCE}).scalar()
        self.assertIsNotNone(game_id)
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
        with engine.connect() as connection:
            rows = connection.execute(
                text("SELECT id, venue_name FROM game WHERE source_id = :game"),
                {"game": GAME_SOURCE},
            ).all()
        self.assertEqual([(game_id, "Probe Field")], [(row.id, row.venue_name) for row in rows])

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

    def test_full_flag_defaults_off(self) -> None:
        with patch("refresh_league.run", return_value=0) as run:
            self.assertEqual(refresh_league.main([]), 0)
        run.assert_called_once_with(full_pass=False)
        with patch("refresh_league.run", return_value=0) as run:
            self.assertEqual(refresh_league.main(["--full"]), 0)
        run.assert_called_once_with(full_pass=True)

    def test_null_source_game_matches_home_away_kickoff_and_venue(self) -> None:
        kickoff = datetime.now(UTC) - timedelta(days=1)
        with Session(engine) as session:
            home, away = _pair(session, "Probe Refresh Tie", 910000441, 910000442)
            _game(session, home, away, kickoff, "Probe Park", "SCHEDULED", None)
            _game(session, home, away, kickoff, "Probe Field", "SCHEDULED", None)
            session.commit()
        counts = upsert_published(
            _match_payload(910000441, 910000442, "Probe Refresh Tie", kickoff, 910000443, "Probe Field"),
            refresh_standings=False,
        )
        self.assertEqual((counts.games, counts.scores), (0, 0))
        with engine.connect() as connection:
            rows = connection.execute(
                text(
                    """
                    SELECT venue_name, source_id
                    FROM game
                    WHERE home_team_id = (SELECT id FROM team WHERE source_id = 910000441)
                    ORDER BY venue_name
                    """
                )
            ).all()
        self.assertEqual([(row.venue_name, row.source_id) for row in rows], [("Probe Field", 910000443), ("Probe Park", None)])

    def test_renamed_team_is_found_again_in_the_same_pass(self) -> None:
        with Session(engine) as session:
            session.add(
                ScheduleTeam(
                    name="Probe Refresh Before",
                    age_group="U13",
                    tier="ECNL",
                    conference="Before Conference",
                    city="Jacksonville",
                    state="FL",
                    source_id=None,
                )
            )
            session.commit()
        payload = {
            "teams": [
                _team_row(910000411, "Probe Refresh Before", "After Conference"),
                _team_row(910000411, "Probe Refresh After", "After Conference", city="Miami"),
            ],
            "games": [],
        }
        counts = upsert_published(payload, refresh_standings=False)
        self.assertEqual(counts.teams, 2)
        with engine.connect() as connection:
            rows = connection.execute(
                text(
                    """
                    SELECT name, conference, city, source_id
                    FROM team
                    WHERE name LIKE 'Probe Refresh %' AND source_id = 910000411
                    """
                )
            ).all()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].name, "Probe Refresh After")
        self.assertEqual(rows[0].conference, "After Conference")
        self.assertEqual(rows[0].city, "Miami")

    def test_age_mismatch_writes_no_game(self) -> None:
        payload = {
            "teams": [
                _team_row(910000421, "Probe Refresh Age Home", "Probe Conference", age_group="U13"),
                _team_row(910000422, "Probe Refresh Age Away", "Probe Conference", age_group="U14"),
            ],
            "games": [_game_row(910000423, 910000421, 910000422, datetime.now(UTC) + timedelta(days=2), "Probe Park")],
        }
        counts = upsert_published(payload, refresh_standings=False)
        self.assertEqual(counts.games, 0)
        with engine.connect() as connection:
            stored = connection.execute(text("SELECT count(*) FROM game WHERE source_id = 910000423")).scalar()
        self.assertEqual(stored, 0)

    def test_different_conferences_still_match_the_same_game(self) -> None:
        kickoff = datetime.now(UTC) - timedelta(days=1)
        with Session(engine) as session:
            home = _one_team(session, "Probe Refresh East", 910000431, "East Conference")
            away = _one_team(session, "Probe Refresh West", 910000432, "West Conference")
            _game(session, home, away, kickoff, "Probe Park", "SCHEDULED", None)
            session.commit()
        counts = upsert_published(
            _match_payload(
                910000431,
                910000432,
                "Probe Refresh East",
                kickoff,
                910000433,
                "Probe Field",
                away_name="Probe Refresh West",
                away_conference="West Conference",
                home_conference="East Conference",
            ),
            refresh_standings=False,
        )
        self.assertEqual(counts.games, 1)
        with engine.connect() as connection:
            rows = connection.execute(
                text(
                    """
                    SELECT venue_name, source_id
                    FROM game
                    WHERE home_team_id = (SELECT id FROM team WHERE source_id = 910000431)
                    """
                )
            ).all()
        self.assertEqual([(row.venue_name, row.source_id) for row in rows], [("Probe Field", 910000433)])

    def test_seven_day_window_skips_only_old_completed_games(self) -> None:
        now = datetime.now(UTC)
        old_kickoff = now - timedelta(days=8)
        recent_kickoff = now - timedelta(days=2)
        upcoming_kickoff = now + timedelta(days=3)
        missing_kickoff = now - timedelta(days=30)
        with Session(engine) as session:
            home, away = _pair(session, "Probe Refresh Window", 910000451, 910000452)
            _game(session, home, away, old_kickoff, "Probe Park", "COMPLETED", 910000461, 1, 0)
            _game(session, home, away, recent_kickoff, "Probe Park", "COMPLETED", 910000462, 2, 1)
            session.commit()
        payload = {
            "teams": [
                _team_row(910000451, "Probe Refresh Window Home", "Probe Conference"),
                _team_row(910000452, "Probe Refresh Window Away", "Probe Conference", city="Tampa"),
            ],
            "games": [
                _game_row(910000461, 910000451, 910000452, old_kickoff, "Probe Field", "COMPLETED", 9, 0),
                _game_row(910000462, 910000451, 910000452, recent_kickoff, "Probe Field", "COMPLETED", 2, 1),
                _game_row(910000463, 910000451, 910000452, upcoming_kickoff, "Probe Upcoming", "SCHEDULED"),
                _game_row(910000464, 910000451, 910000452, missing_kickoff, "Probe Missing", "COMPLETED", 4, 2),
            ],
        }
        with redirect_stdout(io.StringIO()) as stdout:
            counts = upsert_published(payload, refresh_standings=False)
        printed = stdout.getvalue()
        self.assertIn("Teams started", printed)
        self.assertIn("Teams finished written=0", printed)
        self.assertIn("Games started seven-day window", printed)
        self.assertIn("Games finished examined=4 written=3 skipped=1 old completed games", printed)
        self.assertNotIn("Standings started", printed)
        self.assertEqual((counts.games, counts.scores), (3, 1))
        self.assertEqual(_game_row_state(910000461), ("Probe Park", "COMPLETED", 1, 0))
        self.assertEqual(_game_row_state(910000462), ("Probe Field", "COMPLETED", 2, 1))
        self.assertEqual(_game_row_state(910000463), ("Probe Upcoming", "SCHEDULED", None, None))
        self.assertEqual(_game_row_state(910000464), ("Probe Missing", "COMPLETED", 4, 2))

        with redirect_stdout(io.StringIO()) as stdout:
            full = upsert_published(
                {
                    "teams": payload["teams"],
                    "games": [_game_row(910000461, 910000451, 910000452, old_kickoff, "Probe Updated", "COMPLETED", 9, 0)],
                },
                refresh_standings=False,
                full_pass=True,
            )
        self.assertIn("Games started full pass", stdout.getvalue())
        self.assertEqual((full.games, full.scores), (1, 1))
        self.assertEqual(_game_row_state(910000461), ("Probe Updated", "COMPLETED", 9, 0))


def _kickoff_pair(prefix: str, home_source: int, away_source: int) -> tuple[ScheduleTeam, ScheduleTeam]:
    return (
        ScheduleTeam(
            name=f"{prefix} Home",
            age_group="U13",
            tier="ECNL",
            conference="Probe Conference",
            city="Jacksonville",
            state="FL",
            source_id=home_source,
        ),
        ScheduleTeam(
            name=f"{prefix} Away",
            age_group="U13",
            tier="ECNL",
            conference="Probe Conference",
            city="Tampa",
            state="FL",
            source_id=away_source,
        ),
    )


def _pair(session: Session, prefix: str, home_source: int, away_source: int) -> tuple[ScheduleTeam, ScheduleTeam]:
    home, away = _kickoff_pair(prefix, home_source, away_source)
    session.add_all((home, away))
    session.flush()
    return home, away


def _one_team(session: Session, name: str, source_id: int, conference: str) -> ScheduleTeam:
    team = ScheduleTeam(
        name=name,
        age_group="U13",
        tier="ECNL",
        conference=conference,
        city="Jacksonville",
        state="FL",
        source_id=source_id,
    )
    session.add(team)
    session.flush()
    return team


def _game(
    session: Session,
    home: ScheduleTeam,
    away: ScheduleTeam,
    kickoff: datetime,
    venue: str,
    status: str,
    source_id: int | None,
    home_score: int | None = None,
    away_score: int | None = None,
) -> None:
    session.add(
        ScheduleGame(
            home_team_id=home.id,
            away_team_id=away.id,
            starts_at=kickoff,
            venue_name=venue,
            city="Jacksonville",
            state="FL",
            timezone="America/New_York",
            event=None,
            status=status,
            home_score=home_score,
            away_score=away_score,
            is_conference_game=True,
            source_id=source_id,
        )
    )


def _team_row(source_id: int, name: str, conference: str, age_group: str = "U13", city: str = "Jacksonville") -> dict:
    return {
        "source_id": source_id,
        "name": name,
        "age_group": age_group,
        "tier": "ECNL",
        "conference": conference,
        "city": city,
        "state": "FL",
    }


def _game_row(
    source_id: int,
    home_source: int,
    away_source: int,
    kickoff: datetime,
    venue: str,
    status: str = "SCHEDULED",
    home_score: int | None = None,
    away_score: int | None = None,
) -> dict:
    return {
        "source_id": source_id,
        "home_source_id": home_source,
        "away_source_id": away_source,
        "starts_at": kickoff.isoformat(),
        "timezone": "America/New_York",
        "venue_name": venue,
        "city": "Jacksonville",
        "state": "FL",
        "event": None,
        "status": status,
        "home_score": home_score,
        "away_score": away_score,
    }


def _match_payload(
    home_source: int,
    away_source: int,
    home_name: str,
    kickoff: datetime,
    game_source: int,
    venue: str,
    away_name: str | None = None,
    home_conference: str = "Probe Conference",
    away_conference: str = "Probe Conference",
) -> dict:
    return {
        "teams": [
            _team_row(home_source, f"{home_name} Home" if away_name is None else home_name, home_conference),
            _team_row(away_source, f"{home_name} Away" if away_name is None else away_name, away_conference, city="Tampa"),
        ],
        "games": [_game_row(game_source, home_source, away_source, kickoff, venue)],
    }


def _game_row_state(source_id: int) -> tuple[str, str, int | None, int | None]:
    with engine.connect() as connection:
        row = connection.execute(
            text("SELECT venue_name, status, home_score, away_score FROM game WHERE source_id = :source_id"),
            {"source_id": source_id},
        ).one()
    return (row.venue_name, row.status, row.home_score, row.away_score)
