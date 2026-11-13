"""Enriched team list and the mobile home dashboard."""

from __future__ import annotations

import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session
from sqlmodel import SQLModel

from app.database import engine
from app.main import app
from app.models import Base, Club, ConferenceStanding, ScheduleGame, ScheduleTeam

EASTERN = ZoneInfo("America/New_York")
CLUB_ID = 8802101
RIVAL_ID = 8802102
MISSING_CLUB = 8802198


def _kick(day: datetime, hour: int) -> datetime:
    return datetime(day.year, day.month, day.day, hour, tzinfo=EASTERN)


class MobileApiTests(unittest.TestCase):
    def setUp(self) -> None:
        Base.metadata.create_all(engine)
        SQLModel.metadata.create_all(engine)
        self._cleanup()

    def tearDown(self) -> None:
        self._cleanup()

    def _cleanup(self) -> None:
        with engine.begin() as connection:
            if connection.execute(text("SELECT to_regclass('public.team')")).scalar() is None:
                return
            connection.execute(
                text(
                    """
                    DELETE FROM game
                    WHERE home_team_id IN (SELECT id FROM team WHERE name LIKE 'Probe Mobile%')
                       OR away_team_id IN (SELECT id FROM team WHERE name LIKE 'Probe Mobile%')
                    """
                )
            )
            if connection.execute(text("SELECT to_regclass('public.conference_standing')")).scalar() is not None:
                connection.execute(text("DELETE FROM conference_standing WHERE team_name LIKE 'Probe Mobile%'"))
            connection.execute(text("DELETE FROM team WHERE name LIKE 'Probe Mobile%'"))
            if connection.execute(text("SELECT to_regclass('public.club')")).scalar() is not None:
                connection.execute(
                    text(
                        """
                        DELETE FROM club
                        WHERE name LIKE 'Probe Mobile%'
                           OR id BETWEEN 8802100 AND 8802199
                        """
                    )
                )

    def _seed(self) -> dict[str, int]:
        now = datetime.now(EASTERN)
        today = now.date()
        with Session(engine) as session:
            session.add_all(
                (
                    Club(id=CLUB_ID, name="Probe Mobile FC", logo_url="https://example.com/probe-mobile.png"),
                    Club(id=RIVAL_ID, name="Probe Mobile Rival", logo_url="https://example.com/probe-mobile-rival.png"),
                )
            )
            session.flush()

            def add_team(
                name: str,
                age: str,
                gender: str,
                conference: str,
                club_id: int | None,
                tier: str = "ECNL",
            ) -> ScheduleTeam:
                team = ScheduleTeam(
                    name=name,
                    age_group=age,
                    tier=tier,
                    conference=conference,
                    city="Jacksonville",
                    state="FL",
                    gender=gender,
                    club_id=club_id,
                )
                session.add(team)
                session.flush()
                return team

            east = "ECNL Boys Probe Mobile East"
            west = "ECNL Girls Probe Mobile West"
            other = "Probe Mobile Calculated"
            boys = add_team("Probe Mobile FC", "U13", "boys", east, CLUB_ID)
            girls = add_team("Probe Mobile FC", "U15", "girls", west, CLUB_ID)
            rival = add_team("Probe Mobile Rival", "U13", "boys", east, RIVAL_ID)
            rival_girls = add_team("Probe Mobile Rival", "U15", "girls", west, RIVAL_ID)
            spare = add_team("Probe Mobile Spare", "U14", "boys", other, None)
            spare_opp = add_team("Probe Mobile Spare Opp", "U14", "boys", other, None)

            def add_game(
                home: ScheduleTeam,
                away: ScheduleTeam,
                when: datetime,
                status: str = "SCHEDULED",
                home_score: int | None = None,
                away_score: int | None = None,
                conference: bool = True,
                lat: float | None = None,
                lng: float | None = None,
            ) -> None:
                session.add(
                    ScheduleGame(
                        home_team_id=int(home.id),
                        away_team_id=int(away.id),
                        starts_at=when,
                        venue_name="Probe Mobile Park",
                        city="Jacksonville",
                        state="FL",
                        timezone="America/New_York",
                        status=status,
                        home_score=home_score,
                        away_score=away_score,
                        is_conference_game=conference,
                        field_name="Field 2",
                        venue_lat=lat,
                        venue_lng=lng,
                    )
                )

            add_game(rival, boys, _kick(datetime.combine(today - timedelta(days=20), datetime.min.time()), 10), "COMPLETED", 1, 0)
            add_game(boys, rival, _kick(datetime.combine(today - timedelta(days=1), datetime.min.time()), 11), "COMPLETED", 2, 0)
            add_game(
                rival,
                boys,
                now + timedelta(days=1),
                lat=30.33,
                lng=-81.66,
            )
            add_game(girls, rival_girls, now + timedelta(days=3))
            add_game(spare, spare_opp, _kick(datetime.combine(today - timedelta(days=2), datetime.min.time()), 9), "COMPLETED", 1, 0)

            session.add_all(
                (
                    ConferenceStanding(
                        conference="Probe Mobile East",
                        tier="ECNL",
                        gender="boys",
                        age_group="U13",
                        team_id=boys.id,
                        team_name="Probe Mobile FC",
                        games_played=4,
                        wins=3,
                        draws=0,
                        losses=1,
                        goals_for=8,
                        goals_against=2,
                        goal_diff=6,
                        points=9,
                        points_per_game=2.25,
                    ),
                    ConferenceStanding(
                        conference="Probe Mobile East",
                        tier="ECNL",
                        gender="boys",
                        age_group="U13",
                        team_id=rival.id,
                        team_name="Probe Mobile Rival",
                        games_played=4,
                        wins=1,
                        draws=1,
                        losses=2,
                        goals_for=3,
                        goals_against=6,
                        goal_diff=-3,
                        points=4,
                        points_per_game=1.0,
                    ),
                )
            )
            session.commit()
            return {
                "boys": int(boys.id),
                "girls": int(girls.id),
                "rival": int(rival.id),
                "spare": int(spare.id),
                "spare_opp": int(spare_opp.id),
            }

    def test_teams_include_gender_club_and_logo_and_ids_keep_order(self) -> None:
        ids = self._seed()
        with TestClient(app) as client:
            boys_only = client.get("/teams", params={"q": "Probe Mobile"})
            both = client.get("/teams", params={"ids": f"{ids['girls']},{ids['boys']}"})
            filtered = client.get("/teams", params={"ids": f"{ids['girls']},{ids['boys']}", "gender": "boys"})
            by_age = client.get("/teams", params={"ids": f"{ids['girls']},{ids['boys']}", "age_group": "U15"})
            rejected = client.get("/teams", params={"ids": "nope"})
            too_many = client.get("/teams", params={"ids": ",".join(str(8803000 + index) for index in range(101))})

        self.assertEqual(boys_only.status_code, 200)
        names = [row["name"] for row in boys_only.json()]
        self.assertIn("Probe Mobile FC", names)
        self.assertNotIn("Probe Mobile Rival", [row["name"] for row in boys_only.json() if row["gender"] == "girls"])
        self.assertTrue(all(row["gender"] == "boys" for row in boys_only.json() if row["name"].startswith("Probe Mobile")))

        self.assertEqual(both.status_code, 200)
        rows = both.json()
        self.assertEqual([row["id"] for row in rows], [ids["girls"], ids["boys"]])
        self.assertEqual(rows[0]["gender"], "girls")
        self.assertEqual(rows[0]["tier"], "ECNL")
        self.assertEqual(rows[0]["club_id"], CLUB_ID)
        self.assertEqual(rows[0]["logo_url"], "https://example.com/probe-mobile.png")
        self.assertEqual(rows[1]["gender"], "boys")

        self.assertEqual([row["id"] for row in filtered.json()], [ids["boys"]])
        self.assertEqual([row["id"] for row in by_age.json()], [ids["girls"]])
        self.assertEqual(rejected.status_code, 400)
        self.assertEqual(too_many.status_code, 400)

    def test_dashboard_teams_club_windows_and_limits(self) -> None:
        ids = self._seed()
        missing_team = 8802197
        with TestClient(app) as client:
            empty = client.get("/mobile/dashboard")
            payload = client.get(
                "/mobile/dashboard",
                params={
                    "team_ids": f"{ids['spare']},{missing_team},{ids['girls']},{ids['boys']}",
                    "club_id": str(CLUB_ID),
                },
            )
            club_only = client.get("/mobile/dashboard", params={"club_id": str(CLUB_ID)})
            missing_club = client.get("/mobile/dashboard", params={"club_id": str(MISSING_CLUB)})
            too_many = client.get(
                "/mobile/dashboard",
                params={"team_ids": f"{ids['spare']},{ids['girls']},{ids['boys']},{ids['rival']},{ids['spare_opp']}"},
            )
            malformed = client.get("/mobile/dashboard", params={"team_ids": f"{ids['boys']},abc"})

        self.assertEqual(empty.status_code, 200)
        self.assertEqual(empty.json(), {"teams": [], "club": None})

        self.assertEqual(payload.status_code, 200, payload.text)
        body = payload.json()
        self.assertEqual([row["id"] for row in body["teams"]], [ids["spare"], ids["girls"], ids["boys"]])

        spare, girls, boys = body["teams"]
        self.assertIsNone(spare["rank"])
        self.assertEqual(spare["ppg"], 3.0)
        self.assertEqual(spare["record"], {"wins": 1, "losses": 0, "draws": 0, "goal_diff": 1})
        self.assertEqual(spare["last_result"]["team_result"], "W")
        self.assertIsNone(spare["next_game"])

        self.assertEqual(girls["gender"], "girls")
        self.assertIsNone(girls["rank"])
        self.assertEqual(girls["ppg"], 0.0)
        self.assertIsNone(girls["last_result"])
        self.assertIsNotNone(girls["next_game"])
        self.assertEqual(girls["next_game"]["side"], "home")

        self.assertEqual(boys["conference"], "Probe Mobile East")
        self.assertEqual(boys["rank"], 1)
        self.assertEqual(boys["ppg"], 2.25)
        self.assertEqual(boys["logo_url"], "https://example.com/probe-mobile.png")
        self.assertEqual(boys["record"], {"wins": 1, "losses": 1, "draws": 0, "goal_diff": 1})
        self.assertEqual(boys["conference_record"], boys["record"])
        self.assertEqual(boys["last_result"]["team_result"], "W")
        self.assertEqual(boys["last_result"]["home_score"], 2)
        self.assertEqual(boys["last_result"]["away_score"], 0)
        self.assertEqual(boys["next_game"]["side"], "away")
        self.assertEqual(boys["next_game"]["opponent"]["name"], "Probe Mobile Rival")
        self.assertAlmostEqual(boys["next_game"]["latitude"], 30.33)
        self.assertAlmostEqual(boys["next_game"]["longitude"], -81.66)
        self.assertEqual(boys["next_game"]["field_name"], "Field 2")

        club = body["club"]
        self.assertEqual(club["id"], CLUB_ID)
        self.assertEqual(club["name"], "Probe Mobile FC")
        self.assertEqual(club["logo_url"], "https://example.com/probe-mobile.png")
        self.assertEqual(club["record"], {"wins": 1, "losses": 1, "draws": 0, "goal_diff": 1})
        self.assertEqual(club["conference_record"], club["record"])
        ranks = {squad["age_group"]: squad["conference_rank"] for squad in club["squads"]}
        self.assertEqual(ranks["U13"], 1)
        self.assertIsNone(ranks["U15"])
        played = [row["played_on"] for card in club["past_10_days"] for row in card["squads"]]
        self.assertEqual(len(played), 1)
        self.assertEqual(club["past_10_days"][0]["wins"], 1)
        self.assertEqual(club["past_10_days"][0]["opponent_name"], "Probe Mobile Rival")
        self.assertIsNotNone(club["next_10_days"])
        self.assertGreaterEqual(len(club["next_10_days"]["opponents"]), 1)

        self.assertEqual(club_only.status_code, 200)
        self.assertEqual(club_only.json()["teams"], [])
        self.assertEqual(club_only.json()["club"]["id"], CLUB_ID)
        self.assertEqual(missing_club.status_code, 404)
        self.assertEqual(too_many.status_code, 400)
        self.assertEqual(malformed.status_code, 400)
