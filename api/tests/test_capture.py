"""Boys queries, standings identity, showcase squads, and player privacy."""

from __future__ import annotations

import sys
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.capture import public_player, upsert_player
from app.database import engine
from app.ingestion.normalizer import counts_as_conference
from app.main import app
from app.models import ConferenceStanding, DataRefresh, Player, ScheduleGame, ScheduleTeam
from app.refresh import ensure_refresh_tables, upsert_published
from app.standings import _row_from_parts, ecnl_standings, short_conference, upsert_standings
from load_league import age_group

HOME = 910000821
AWAY = 910000822
SHOW_HOME = 910000841
SHOW_AWAY = 910000842
LEAGUE_GAME = 910000831
SHOW_GAME = 910000832
PLAYOFF_GAME = 910000833
BOY = 910000861
GIRL = 910000862
PLAYER = 910000777
CLUB_HOME = 910000851
CLUB_AWAY = 910000852


def _kickoff() -> str:
    return (datetime.now(UTC) - timedelta(days=1)).isoformat()


class ParserTests(unittest.TestCase):
    def test_leading_g_is_accepted_like_b(self) -> None:
        self.assertEqual(age_group("GU13"), "U13")
        self.assertEqual(age_group("BU15"), "U15")
        self.assertEqual(age_group("U14"), "U14")
        self.assertEqual(age_group("GU19"), "U18/19")
        self.assertEqual(age_group("BU19"), "U18/19")
        self.assertEqual(age_group("U19"), "U18/19")
        self.assertEqual(age_group("GU18/19"), "U18/19")

    def test_playoff_and_scout_are_not_conference_games(self) -> None:
        self.assertFalse(counts_as_conference("Playoff"))
        self.assertFalse(counts_as_conference("Scout event"))
        self.assertFalse(counts_as_conference("Friendly"))
        self.assertTrue(counts_as_conference("Group Play"))

    def test_short_conference_strips_boys_or_girls(self) -> None:
        self.assertEqual(short_conference("ECNL Girls Far West"), "Far West")
        self.assertEqual(short_conference("ECNL Boys Far West"), "Far West")
        self.assertEqual(short_conference("ECNL RL Girls Texas"), short_conference("ECNL RL Boys Texas"))
        self.assertEqual(short_conference("ECNL RL Boys Texas"), "Texas")
        self.assertEqual(short_conference("ECNL Girls Southwest 2026-27"), "Southwest")


class CaptureTests(unittest.TestCase):
    def setUp(self) -> None:
        ensure_refresh_tables()
        self.refresh_ids: list[int] = []
        self._cleanup()

    def tearDown(self) -> None:
        self._cleanup()

    def _cleanup(self) -> None:
        with Session(engine) as session:
            team_ids = select(ScheduleTeam.id).where(ScheduleTeam.source_id.in_([HOME, AWAY, BOY, GIRL, SHOW_HOME, SHOW_AWAY]))
            session.execute(
                delete(ScheduleGame).where(
                    or_(
                        ScheduleGame.source_id.in_([LEAGUE_GAME, SHOW_GAME, PLAYOFF_GAME]),
                        ScheduleGame.home_team_id.in_(team_ids),
                        ScheduleGame.away_team_id.in_(team_ids),
                    )
                )
            )
            session.execute(
                delete(ConferenceStanding).where(
                    ConferenceStanding.conference.in_(["Probe Capture Conf", "Probe Capture East", "ECNL Girls Probe Capture East"])
                )
            )
            session.execute(delete(ScheduleTeam).where(ScheduleTeam.source_id.in_([HOME, AWAY, BOY, GIRL, SHOW_HOME, SHOW_AWAY])))
            session.execute(delete(Player).where(Player.source_id == PLAYER))
            if self.refresh_ids:
                session.execute(delete(DataRefresh).where(DataRefresh.id.in_(self.refresh_ids)))
            session.commit()

    def test_boys_queries_hide_girls(self) -> None:
        with Session(engine) as session:
            boy = ScheduleTeam(
                name="ProbeCaptureBoy",
                age_group="U13",
                tier="ECNL",
                conference="Probe Capture East",
                city="Jacksonville",
                state="FL",
                gender="boys",
                source_id=BOY,
            )
            girl = ScheduleTeam(
                name="ProbeCaptureGirl",
                age_group="U13",
                tier="ECNL",
                conference="Probe Capture East",
                city="Tampa",
                state="FL",
                gender="girls",
                source_id=GIRL,
            )
            session.add_all((boy, girl))
            session.flush()
            session.add_all(
                (
                    ConferenceStanding(
                        conference="Probe Capture East",
                        tier="ECNL",
                        gender="boys",
                        age_group="U13",
                        team_id=boy.id,
                        team_name="ProbeCaptureBoy",
                        games_played=1,
                        wins=1,
                        goal_diff=1,
                        points=3,
                        points_per_game=3.0,
                    ),
                    ConferenceStanding(
                        conference="ECNL Girls Probe Capture East",
                        tier="ECNL",
                        gender="girls",
                        age_group="U13",
                        team_id=girl.id,
                        team_name="ProbeCaptureGirl",
                        games_played=4,
                        wins=4,
                        goal_diff=9,
                        points=12,
                        points_per_game=3.0,
                    ),
                )
            )
            session.commit()
            boy_id = int(boy.id)
            girl_id = int(girl.id)

        with TestClient(app) as client:
            teams = client.get("/teams", params={"q": "ProbeCapture"}).json()
            standings = client.get(
                "/standings",
                params={"conference": "Probe Capture East", "tier": "ECNL", "age_group": "U13"},
            ).json()
            schedule = client.get(f"/teams/{girl_id}/schedule")
            missing = client.get("/head-to-head", params={"team_a_id": girl_id, "team_b_id": 2147483646})
            mixed = client.get("/head-to-head", params={"team_a_id": boy_id, "team_b_id": girl_id})
            girls = client.get("/teams", params={"q": "ProbeCapture", "gender": "girls"}).json()
            girls_table = client.get(
                "/standings",
                params={"conference": "Probe Capture East", "tier": "ECNL", "age_group": "U13", "gender": "girls"},
            ).json()
            calculated = client.get(
                "/standings",
                params={
                    "conference": "Probe Capture East",
                    "tier": "ECNL",
                    "age_group": "U13",
                    "gender": "girls",
                    "mode": "calculated",
                },
            ).json()
            rejected_teams = client.get("/teams", params={"gender": "coed"})
            rejected_table = client.get(
                "/standings",
                params={"conference": "Probe Capture East", "tier": "ECNL", "age_group": "U13", "gender": "coed"},
            )

        self.assertEqual([team["name"] for team in teams], ["ProbeCaptureBoy"])
        self.assertNotIn("gender", teams[0])
        self.assertNotIn("club_id", teams[0])
        self.assertEqual([row["team_name"] for row in standings], ["ProbeCaptureBoy"])
        self.assertNotIn("gender", standings[0])
        self.assertNotIn("capped_goal_diff", standings[0])
        self.assertEqual(schedule.status_code, 200)
        self.assertEqual(schedule.json()["games"], [])
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(mixed.status_code, 404)
        self.assertEqual([team["name"] for team in girls], ["ProbeCaptureGirl"])
        self.assertEqual([row["team_name"] for row in girls_table], ["ProbeCaptureGirl"])
        self.assertEqual([row["team_name"] for row in calculated], ["ProbeCaptureGirl"])
        self.assertEqual(rejected_teams.status_code, 400)
        self.assertEqual(rejected_table.status_code, 400)

    def test_standings_unique_key_includes_gender(self) -> None:
        with Session(engine) as session:
            session.add_all(
                (
                    ConferenceStanding(
                        conference="Probe Capture East",
                        tier="ECNL",
                        gender="boys",
                        age_group="U14",
                        team_name="Probe Capture Shared",
                        goal_diff=2,
                    ),
                    ConferenceStanding(
                        conference="Probe Capture East",
                        tier="ECNL",
                        gender="girls",
                        age_group="U14",
                        team_name="Probe Capture Shared",
                        goal_diff=5,
                    ),
                )
            )
            session.commit()
            rows = list(
                session.scalars(
                    select(ConferenceStanding).where(
                        ConferenceStanding.conference == "Probe Capture East",
                        ConferenceStanding.team_name == "Probe Capture Shared",
                    )
                ).all()
            )
        self.assertEqual(sorted(row.gender for row in rows), ["boys", "girls"])

    def test_capped_goal_difference_does_not_replace_goal_diff(self) -> None:
        row = _row_from_parts(
            conference="Probe Capture Conf",
            tier="ECNL",
            age_group="U13",
            team_id=None,
            team_name="Probe Capture Margin",
            games_played=1,
            wins=1,
            losses=0,
            draws=0,
            goals_for=12,
            goals_against=3,
            goal_diff=9,
            gender="boys",
            capped_goal_diff=4,
        )
        with Session(engine) as session:
            upsert_standings(session, [row])
            stored = session.scalar(
                select(ConferenceStanding).where(
                    ConferenceStanding.conference == "Probe Capture Conf",
                    ConferenceStanding.team_name == "Probe Capture Margin",
                    ConferenceStanding.gender == "boys",
                )
            )
            self.assertIsNotNone(stored)
            assert stored is not None
            self.assertEqual(stored.goal_diff, 9)
            self.assertEqual(stored.capped_goal_diff, 4)
            self.assertEqual(stored.points_per_game, 3.0)

    def test_showcase_does_not_create_a_second_team_or_standing(self) -> None:
        payload = {
            "teams": [
                {
                    "source_id": HOME,
                    "name": "Probe Capture Home",
                    "age_group": "U13",
                    "tier": "ECNL",
                    "conference": "Probe Capture Conf",
                    "city": "Jacksonville",
                    "state": "FL",
                    "gender": "boys",
                    "club_id": CLUB_HOME,
                },
                {
                    "source_id": AWAY,
                    "name": "Probe Capture Away",
                    "age_group": "U13",
                    "tier": "ECNL",
                    "conference": "Probe Capture Conf",
                    "city": "Tampa",
                    "state": "FL",
                    "gender": "boys",
                    "club_id": CLUB_AWAY,
                },
            ],
            "games": [
                {
                    "source_id": LEAGUE_GAME,
                    "home_source_id": HOME,
                    "away_source_id": AWAY,
                    "home_club_id": CLUB_HOME,
                    "away_club_id": CLUB_AWAY,
                    "age_group": "U13",
                    "gender": "boys",
                    "starts_at": _kickoff(),
                    "timezone": "America/New_York",
                    "venue_name": "Probe Park",
                    "city": "Jacksonville",
                    "state": "FL",
                    "event": None,
                    "status": "COMPLETED",
                    "home_score": 2,
                    "away_score": 1,
                    "is_conference_game": True,
                },
                {
                    "source_id": SHOW_GAME,
                    "home_source_id": SHOW_HOME,
                    "away_source_id": SHOW_AWAY,
                    "home_club_id": CLUB_HOME,
                    "away_club_id": CLUB_AWAY,
                    "age_group": "U13",
                    "gender": "boys",
                    "starts_at": _kickoff(),
                    "timezone": "America/New_York",
                    "venue_name": "Showcase Park",
                    "city": "Orlando",
                    "state": "FL",
                    "event": "ECNL Showcase",
                    "status": "COMPLETED",
                    "home_score": 9,
                    "away_score": 0,
                    "is_conference_game": False,
                },
                {
                    "source_id": PLAYOFF_GAME,
                    "home_source_id": SHOW_HOME,
                    "away_source_id": SHOW_AWAY,
                    "home_club_id": CLUB_HOME,
                    "away_club_id": CLUB_AWAY,
                    "age_group": "U13",
                    "gender": "boys",
                    "starts_at": (datetime.now(UTC) - timedelta(days=2)).isoformat(),
                    "timezone": "America/New_York",
                    "venue_name": "Playoff Park",
                    "city": "Orlando",
                    "state": "FL",
                    "event": "Playoff",
                    "status": "COMPLETED",
                    "home_score": 7,
                    "away_score": 0,
                    "is_conference_game": False,
                },
            ],
        }
        upsert_published(payload, refresh_standings=False)
        with Session(engine) as session:
            teams = list(session.scalars(select(ScheduleTeam).where(ScheduleTeam.club_id.in_([CLUB_HOME, CLUB_AWAY]))).all())
            self.assertEqual(sorted(team.source_id or 0 for team in teams), [HOME, AWAY])
            rows = ecnl_standings(session, "Probe Capture Conf", "U13", "ECNL", "boys")
        home = next(row for row in rows if row["team_name"] == "Probe Capture Home")
        self.assertEqual(home["games_played"], 1)
        self.assertEqual(home["goal_diff"], 1)
        self.assertIsNone(home["capped_goal_diff"])

    def test_schedule_refresh_ignores_a_reference_job(self) -> None:
        schedule_at = datetime(2099, 1, 2, 3, 4, 5, tzinfo=UTC)
        reference_at = datetime(2099, 6, 1, 0, 0, tzinfo=UTC)
        with Session(engine) as session:
            schedule = DataRefresh(job="schedule", started_at=schedule_at, finished_at=schedule_at, status="success")
            reference = DataRefresh(job="reference", started_at=reference_at, finished_at=reference_at, status="success")
            session.add_all((schedule, reference))
            session.commit()
            self.refresh_ids.extend((int(schedule.id), int(reference.id)))
        with TestClient(app) as client:
            payload = client.get("/data-refresh").json()
        stamp = str(payload["last_successful_finish"]).replace("+00:00", "Z")
        self.assertTrue(stamp.startswith("2099-01-02T03:04:05"))

    def test_player_rows_omit_email_and_address(self) -> None:
        record = public_player(
            {
                "playerID": PLAYER,
                "firstName": "Probe",
                "lastName": "Player",
                "email": "probe@example.com",
                "address": "123 Main Street",
                "homeAddress": "123 Main Street",
                "dateOfBirth": "2013-04-01",
                "parentEmail": "parent@example.com",
                "parentPhone": "555-0100",
                "gpa": "3.9",
                "highSchool": "Lincoln High",
                "collegeCommitment": "Example University",
            }
        )
        self.assertIsNotNone(record)
        assert record is not None
        self.assertNotIn("email", record)
        self.assertNotIn("address", record)
        self.assertNotIn("dateOfBirth", record)
        self.assertNotIn("parentEmail", record)
        self.assertEqual(record["gpa"], "3.9")
        self.assertEqual(record["high_school"], "Lincoln High")
        self.assertEqual(record["college_commitment"], "Example University")
        self.assertNotIn("email", set(Player.__table__.columns.keys()))
        self.assertNotIn("address", set(Player.__table__.columns.keys()))
        with Session(engine) as session:
            saved = upsert_player(session, record)
            session.commit()
            session.refresh(saved)
            self.assertEqual(saved.gpa, "3.9")
            self.assertEqual(saved.high_school, "Lincoln High")
            self.assertNotIn("email", saved.__dict__)
            self.assertNotIn("address", saved.__dict__)
