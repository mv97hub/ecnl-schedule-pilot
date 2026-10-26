"""Club record math, weekend scorecards, and the club read routes."""

from __future__ import annotations

import sys
import unittest
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session
from sqlmodel import SQLModel

from app.clubs import CLUB_LIST_LIMIT, accumulate_records, game_local_date, group_weekends, weekend_friday
from app.database import engine
from app.main import app
from app.models import Base, Club, ConferenceStanding, ScheduleGame, ScheduleTeam

EASTERN = ZoneInfo("America/New_York")
CLUB_ID = 8801101
RIVAL_ID = 8801102
OTHER_ID = 8801103
MISSING_ID = 8801998


def _kick(day: date, hour: int, minute: int = 0) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=EASTERN)


def _next_friday(today: date) -> date:
    days = (4 - today.weekday()) % 7
    if days == 0:
        days = 7
    return today + timedelta(days=days)


class RecordAndWeekendTests(unittest.TestCase):
    def test_same_club_game_counts_once(self) -> None:
        def played(game_id: int, home: int, away: int, home_score: int, away_score: int, conference: bool) -> ScheduleGame:
            return ScheduleGame(
                id=game_id,
                home_team_id=home,
                away_team_id=away,
                starts_at=datetime(2026, 10, 7, 18, tzinfo=EASTERN),
                venue_name="Park",
                city="Jacksonville",
                state="FL",
                timezone="America/New_York",
                status="COMPLETED",
                home_score=home_score,
                away_score=away_score,
                is_conference_game=conference,
            )

        # Home 3-1 is inside the club. Counting both squads would add a win and a loss.
        intra = played(1, 1, 2, 3, 1, True)
        win = played(2, 1, 9, 2, 0, True)
        loss = played(3, 8, 2, 1, 0, False)
        overall, conference = accumulate_records([intra, win, loss], {1, 2})
        self.assertEqual((overall.wins, overall.losses, overall.draws, overall.goal_diff), (2, 1, 0, 3))
        self.assertEqual((conference.wins, conference.losses, conference.draws, conference.goal_diff), (2, 0, 0, 4))

    def test_thursday_evening_stays_out_of_the_friday_weekend(self) -> None:
        # 03:30 UTC on 6 Nov 2026 is 22:30 on Thursday 5 Nov in New York.
        moment = datetime(2026, 11, 6, 3, 30, tzinfo=UTC)
        local = game_local_date(moment, "America/New_York")
        self.assertEqual(local, date(2026, 11, 5))
        self.assertIsNone(weekend_friday(local))
        self.assertEqual(weekend_friday(date(2026, 11, 6)), date(2026, 11, 6))
        self.assertEqual(game_local_date(moment, None), local)

    def test_one_squad_weekend_is_omitted_and_two_squads_are_kept(self) -> None:
        def squad(team_id: int, club_id: int | None, age: str, gender: str = "boys") -> ScheduleTeam:
            return ScheduleTeam(
                id=team_id,
                name=f"Probe Squad {team_id}",
                age_group=age,
                tier="ECNL",
                conference="ECNL Boys East",
                city="Jacksonville",
                state="FL",
                gender=gender,
                club_id=club_id,
            )

        def match(
            game_id: int,
            home: ScheduleTeam,
            away: ScheduleTeam,
            day: date,
            hour: int = 10,
            status: str = "SCHEDULED",
            home_score: int | None = None,
            away_score: int | None = None,
        ) -> ScheduleGame:
            game = ScheduleGame(
                id=game_id,
                home_team_id=int(home.id),
                away_team_id=int(away.id),
                starts_at=_kick(day, hour),
                venue_name="Park",
                city="Jacksonville",
                state="FL",
                timezone="America/New_York",
                status=status,
                home_score=home_score,
                away_score=away_score,
                is_conference_game=True,
            )
            game.home_team = home
            game.away_team = away
            return game

        friday = date(2026, 11, 6)
        earlier = date(2026, 10, 30)
        ours_u13 = squad(1, 7, "U13")
        ours_u14 = squad(2, 7, "U14")
        rival_u13 = squad(10, 50, "U13")
        rival_u14 = squad(11, 50, "U14")
        nomad_u13 = squad(12, None, "U13")
        nomad_u14 = squad(13, None, "U14")
        games = [
            match(1, ours_u13, rival_u13, friday, 10),
            match(2, ours_u14, rival_u14, friday, 12),
            match(3, ours_u13, rival_u13, earlier, 10),
            match(4, ours_u13, nomad_u13, friday, 14),
            match(5, ours_u14, nomad_u14, friday, 16),
            match(6, ours_u13, ours_u14, friday, 18, status="COMPLETED", home_score=2, away_score=2),
        ]
        cards, upcoming = group_weekends(
            games,
            {1, 2},
            {50: Club(id=50, name="Rival FC", logo_url=None)},
            7,
            today=date(2026, 11, 4),
        )
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0].opponent_club_id, 50)
        self.assertEqual(len(cards[0].squads), 2)
        self.assertEqual([row.age_group for row in cards[0].squads], ["U13", "U14"])
        self.assertTrue(cards[0].upcoming)
        self.assertEqual(upcoming, "Nov 6–8 vs Rival FC")
        self.assertNotIn(earlier, [card.weekend_start for card in cards])


class ClubRouteTests(unittest.TestCase):
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
                    WHERE home_team_id IN (SELECT id FROM team WHERE name LIKE 'Probe Club Page%')
                       OR away_team_id IN (SELECT id FROM team WHERE name LIKE 'Probe Club Page%')
                    """
                )
            )
            if connection.execute(text("SELECT to_regclass('public.conference_standing')")).scalar() is not None:
                connection.execute(text("DELETE FROM conference_standing WHERE team_name LIKE 'Probe Club Page%'"))
            connection.execute(text("DELETE FROM team WHERE name LIKE 'Probe Club Page%'"))
            if connection.execute(text("SELECT to_regclass('public.club')")).scalar() is not None:
                connection.execute(
                    text(
                        """
                        DELETE FROM club
                        WHERE name LIKE 'Probe Club Page%'
                           OR id BETWEEN 8801100 AND 8801999
                        """
                    )
                )

    def test_unknown_club_is_404(self) -> None:
        with TestClient(app) as client:
            missing = client.get(f"/clubs/{MISSING_ID}")
        self.assertEqual(missing.status_code, 404)

    def test_detail_record_weekends_and_search(self) -> None:
        today = datetime.now(EASTERN).date()
        coming = _next_friday(today)
        recent = coming - timedelta(days=14)
        single = coming - timedelta(days=21)
        nomads = coming - timedelta(days=28)
        wednesday = coming - timedelta(days=2)
        tuesday = recent - timedelta(days=3)
        thursday = coming - timedelta(days=1)

        with Session(engine) as session:
            session.add_all(
                (
                    Club(id=CLUB_ID, name="Probe Club Page FC", logo_url="https://example.com/probe-club.png"),
                    Club(id=RIVAL_ID, name="Probe Club Page Rival", logo_url="https://example.com/probe-rival.png"),
                    Club(id=OTHER_ID, name="Probe Club Page Other", logo_url=None),
                    Club(id=8801104, name="Probe Club Page Empty", logo_url=None),
                )
            )
            session.flush()

            def add_team(name: str, age: str, gender: str, tier: str, conference: str, club_id: int | None) -> ScheduleTeam:
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

            east = "ECNL Boys Probe Club Page East"
            south = "ECNL RL Boys Probe Club Page South"
            west = "ECNL Girls Probe Club Page West"
            u13 = add_team("Probe Club Page U13", "U13", "boys", "ECNL", east, CLUB_ID)
            u13_rl = add_team("Probe Club Page U13 RL", "U13", "boys", "ECNL-RL", south, CLUB_ID)
            u14 = add_team("Probe Club Page U14", "U14", "boys", "ECNL-RL", south, CLUB_ID)
            u15 = add_team("Probe Club Page U15", "U15", "boys", "ECNL", east, CLUB_ID)
            u16 = add_team("Probe Club Page U16", "U16", "boys", "ECNL", east, CLUB_ID)
            g13 = add_team("Probe Club Page G13", "U13", "girls", "ECNL", west, CLUB_ID)
            g17 = add_team("Probe Club Page G17", "U17", "girls", "ECNL", west, CLUB_ID)
            rival_u13 = add_team("Probe Club Page Rival U13", "U13", "boys", "ECNL", east, RIVAL_ID)
            rival_u14 = add_team("Probe Club Page Rival U14", "U14", "boys", "ECNL-RL", south, RIVAL_ID)
            rival_g13 = add_team("Probe Club Page Rival G13", "U13", "girls", "ECNL", west, RIVAL_ID)
            rival_u16 = add_team("Probe Club Page Rival U16", "U16", "boys", "ECNL", east, RIVAL_ID)
            other_u15 = add_team("Probe Club Page Other U15", "U15", "boys", "ECNL", east, OTHER_ID)
            other_u14 = add_team("Probe Club Page Other U14", "U14", "boys", "ECNL-RL", south, OTHER_ID)
            other_g17 = add_team("Probe Club Page Other G17", "U17", "girls", "ECNL", west, OTHER_ID)
            nomad_u15 = add_team("Probe Club Page Nomad U15", "U15", "boys", "ECNL", east, None)
            nomad_u16 = add_team("Probe Club Page Nomad U16", "U16", "boys", "ECNL", east, None)

            def add_game(
                home: ScheduleTeam,
                away: ScheduleTeam,
                when: datetime,
                status: str = "SCHEDULED",
                home_score: int | None = None,
                away_score: int | None = None,
                conference: bool = True,
                venue: str = "Probe Complex",
                field: str | None = "North Pitch",
                city: str = "Jacksonville",
                state: str = "FL",
                lat: float | None = 30.5,
                lng: float | None = -81.25,
            ) -> None:
                session.add(
                    ScheduleGame(
                        home_team_id=int(home.id),
                        away_team_id=int(away.id),
                        starts_at=when,
                        venue_name=venue,
                        city=city,
                        state=state,
                        timezone="America/New_York",
                        status=status,
                        home_score=home_score,
                        away_score=away_score,
                        is_conference_game=conference,
                        field_name=field,
                        venue_lat=lat,
                        venue_lng=lng,
                    )
                )

            add_game(u13, u14, _kick(wednesday, 18), "COMPLETED", 3, 1, True)
            add_game(u13, rival_u13, _kick(recent, 11), "COMPLETED", 2, 0, True)
            add_game(
                rival_u14,
                u14,
                _kick(recent, 13),
                "COMPLETED",
                1,
                0,
                False,
                venue="Rival Stadium",
                field="Main",
                city="Tampa",
                lat=None,
                lng=None,
            )
            add_game(
                g13,
                rival_g13,
                _kick(tuesday, 10),
                "COMPLETED",
                1,
                1,
                True,
                field="South Pitch",
                lat=None,
                lng=None,
            )
            add_game(
                u15,
                other_u15,
                _kick(single, 10),
                "COMPLETED",
                4,
                0,
                False,
                venue="Probe Annex",
                field=None,
                city="Orlando",
                lat=None,
                lng=None,
            )
            add_game(u13, rival_u13, _kick(coming, 10))
            add_game(
                rival_g13,
                g13,
                _kick(coming, 12),
                venue="Rival Girls Field",
                field=None,
                city="Miami",
                lat=None,
                lng=None,
            )
            add_game(
                other_u14,
                u14,
                _kick(coming, 14),
                venue="Other Park",
                field=None,
                city="Tampa",
                lat=None,
                lng=None,
            )
            add_game(
                other_g17,
                g17,
                _kick(coming, 16),
                venue="Other Park",
                field=None,
                city="Tampa",
                lat=None,
                lng=None,
            )
            add_game(nomad_u15, u15, _kick(nomads, 10), venue="Nomad Field", field=None, city="Tampa", lat=None, lng=None)
            add_game(nomad_u16, u16, _kick(nomads, 12), venue="Nomad Field", field=None, city="Tampa", lat=None, lng=None)
            add_game(u16, rival_u16, _kick(thursday, 23, 30))
            session.add_all(
                (
                    ConferenceStanding(
                        conference=east,
                        tier="ECNL",
                        gender="boys",
                        age_group="U13",
                        team_id=u13.id,
                        team_name=u13.name,
                        games_played=1,
                        wins=1,
                        goal_diff=1,
                        goals_for=1,
                        points=3,
                        points_per_game=1.0,
                    ),
                    ConferenceStanding(
                        conference=east,
                        tier="ECNL",
                        gender="boys",
                        age_group="U13",
                        team_name="Probe Club Page Peer",
                        games_played=1,
                        wins=1,
                        goal_diff=5,
                        goals_for=5,
                        points=3,
                        points_per_game=3.0,
                    ),
                )
            )
            session.commit()
            u13_id = int(u13.id)
            u13_rl_id = int(u13_rl.id)

        with TestClient(app) as client:
            missing = client.get(f"/clubs/{MISSING_ID}")
            detail = client.get(f"/clubs/{CLUB_ID}")
            found = client.get("/clubs", params={"q": "probe club page fc"})
            empty = client.get("/clubs", params={"q": "Probe Club Page Empty"})
            schedule = client.get(f"/teams/{u13_id}/schedule")

        self.assertEqual(missing.status_code, 404)
        self.assertEqual(detail.status_code, 200)
        body = detail.json()
        self.assertEqual(body["name"], "Probe Club Page FC")
        self.assertEqual(body["logo_url"], "https://example.com/probe-club.png")
        self.assertEqual(body["team_count"], 7)
        self.assertEqual(
            body["summary"],
            "7 teams · ECNL and ECNL-RL · Probe Club Page East, Probe Club Page South, Probe Club Page West",
        )
        self.assertEqual(body["tiers"], ["ECNL", "ECNL-RL"])
        self.assertEqual(body["record"], {"wins": 3, "losses": 1, "draws": 1, "goal_diff": 7})
        self.assertEqual(body["conference_record"], {"wins": 2, "losses": 0, "draws": 1, "goal_diff": 4})
        self.assertEqual([squad["gender"] for squad in body["squads"][:5]], ["boys", "boys", "boys", "boys", "boys"])
        self.assertEqual([squad["gender"] for squad in body["squads"][5:]], ["girls", "girls"])
        boys_u13 = [squad for squad in body["squads"] if squad["age_group"] == "U13" and squad["gender"] == "boys"]
        self.assertEqual([squad["tier"] for squad in boys_u13], ["ECNL", "ECNL-RL"])
        self.assertEqual(boys_u13[0]["id"], u13_id)
        self.assertEqual(boys_u13[1]["id"], u13_rl_id)
        self.assertEqual(boys_u13[0]["conference"], "Probe Club Page East")
        self.assertEqual(boys_u13[0]["conference_rank"], 2)
        self.assertIsNone(boys_u13[1]["conference_rank"])

        self.assertEqual(len(body["weekends"]), 3)
        self.assertEqual(body["weekends"][0]["opponent_name"], "Probe Club Page Other")
        self.assertEqual(body["weekends"][1]["opponent_name"], "Probe Club Page Rival")
        self.assertTrue(body["weekends"][0]["upcoming"])
        self.assertTrue(body["weekends"][1]["upcoming"])
        self.assertEqual(body["weekends"][0]["weekend_start"], coming.isoformat())
        self.assertEqual(len(body["weekends"][0]["squads"]), 2)
        self.assertEqual(body["weekends"][1]["wins"], 0)
        rival_ages = [(row["age_group"], row["gender"]) for row in body["weekends"][1]["squads"]]
        self.assertEqual(rival_ages, [("U13", "boys"), ("U13", "girls")])
        recent_card = body["weekends"][2]
        self.assertFalse(recent_card["upcoming"])
        self.assertEqual(recent_card["opponent_name"], "Probe Club Page Rival")
        self.assertEqual((recent_card["wins"], recent_card["losses"], recent_card["draws"]), (1, 1, 0))
        self.assertEqual(len(recent_card["squads"]), 2)
        self.assertEqual(recent_card["weekend_start"], recent.isoformat())
        self.assertNotIn(single.isoformat(), [card["weekend_start"] for card in body["weekends"]])
        self.assertNotIn("U16", [row["age_group"] for card in body["weekends"] for row in card["squads"]])
        self.assertIn("Probe Club Page Other", body["next_weekend"])
        self.assertIn("Probe Club Page Rival", body["next_weekend"])

        venue_names = [venue["venue_name"] for venue in body["venues"]]
        self.assertEqual(venue_names, ["Probe Annex", "Probe Complex", "Probe Complex"])
        annex = body["venues"][0]
        self.assertEqual(annex["city"], "Orlando")
        self.assertIsNone(annex["field_name"])
        self.assertIsNone(annex["latitude"])
        north = next(venue for venue in body["venues"] if venue["field_name"] == "North Pitch")
        self.assertEqual(north["latitude"], 30.5)
        self.assertEqual(north["longitude"], -81.25)
        self.assertNotIn("Rival Stadium", venue_names)
        self.assertNotIn("address", body["venues"][0])

        self.assertEqual(found.status_code, 200)
        self.assertEqual(found.json()[0]["id"], CLUB_ID)
        self.assertEqual(found.json()[0]["team_count"], 7)
        self.assertEqual(empty.json(), [])
        self.assertEqual(schedule.status_code, 200)
        self.assertEqual(schedule.json()["club_id"], CLUB_ID)

    def test_empty_query_is_capped_to_clubs_with_teams(self) -> None:
        from app import clubs as clubs_module

        with Session(engine) as session:
            for offset in range(3):
                club_id = 8801500 + offset
                session.add(Club(id=club_id, name=f"Probe Club Page Cap {offset}", logo_url=None))
                session.flush()
                session.add(
                    ScheduleTeam(
                        name=f"Probe Club Page Cap Team {offset}",
                        age_group="U13",
                        tier="ECNL",
                        conference="ECNL Boys Probe Club Page East",
                        city="Jacksonville",
                        state="FL",
                        gender="boys",
                        club_id=club_id,
                    )
                )
            session.commit()

        original = clubs_module.CLUB_LIST_LIMIT
        clubs_module.CLUB_LIST_LIMIT = 1
        try:
            with TestClient(app) as client:
                listed = client.get("/clubs")
                narrowed = client.get("/clubs", params={"q": "Probe Club Page Cap"})
                named = client.get("/clubs", params={"q": "Probe Club Page Cap 2"})
        finally:
            clubs_module.CLUB_LIST_LIMIT = original

        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.json()), 1)
        self.assertGreaterEqual(listed.json()[0]["team_count"], 1)
        self.assertEqual(len(narrowed.json()), 1)
        self.assertEqual(named.json()[0]["name"], "Probe Club Page Cap 2")
        self.assertEqual(CLUB_LIST_LIMIT, 30)
