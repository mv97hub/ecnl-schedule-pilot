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

    def test_completed_pair_is_a_scorecard_and_one_squad_stays_on_next_weekend(self) -> None:
        def squad(team_id: int, club_id: int | None, age: str, gender: str = "boys", name: str | None = None) -> ScheduleTeam:
            return ScheduleTeam(
                id=team_id,
                name=name or f"Probe Squad {team_id}",
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
        lone = date(2026, 10, 23)
        ours_u13 = squad(1, 7, "U13", name="Home FC")
        ours_u14 = squad(2, 7, "U14", name="Home FC")
        rival_u13 = squad(10, 50, "U13", name="Rival FC")
        rival_u14 = squad(11, 50, "U14", name="Rival FC")
        nomad_u13 = squad(12, None, "U13")
        nomad_u14 = squad(13, None, "U14")
        solo_u13 = squad(20, 60, "U13", name="Solo FC")
        games = [
            match(1, ours_u13, rival_u13, friday, 10),
            match(2, ours_u14, rival_u14, friday, 12),
            match(3, ours_u13, rival_u13, earlier, 10, status="COMPLETED", home_score=2, away_score=0),
            match(7, ours_u14, rival_u14, earlier, 12, status="COMPLETED", home_score=1, away_score=0),
            match(4, ours_u13, nomad_u13, friday, 14),
            match(5, ours_u14, nomad_u14, friday, 16),
            match(6, ours_u13, ours_u14, friday, 18, status="COMPLETED", home_score=2, away_score=2),
            match(8, ours_u13, solo_u13, friday, 9),
            match(9, ours_u13, solo_u13, lone, 10, status="COMPLETED", home_score=1, away_score=0),
        ]
        cards, upcoming = group_weekends(
            games,
            {1, 2},
            {
                50: Club(id=50, name="Rival FC", logo_url=None),
                60: Club(id=60, name="Solo FC", logo_url=None),
            },
            7,
            today=date(2026, 11, 4),
        )
        self.assertEqual([card.weekend_start for card in cards], [earlier])
        self.assertEqual(cards[0].opponent_club_id, 50)
        self.assertFalse(cards[0].upcoming)
        self.assertEqual([row.age_group for row in cards[0].squads], ["U13", "U14"])
        self.assertEqual(cards[0].squads[0].result, "W")
        self.assertEqual(cards[0].squads[0].tier, "ECNL")
        self.assertEqual(cards[0].squads[0].opponent_squad_name, "Rival FC")
        self.assertNotIn(friday, [card.weekend_start for card in cards])
        self.assertNotIn(lone, [card.weekend_start for card in cards])
        self.assertIsNotNone(upcoming)
        assert upcoming is not None
        self.assertEqual(upcoming.weekend_start, friday)
        self.assertEqual(upcoming.label, "Nov 6")
        self.assertEqual([item.opponent_name for item in upcoming.opponents], ["Rival FC", "Solo FC"])
        self.assertEqual(len(upcoming.opponents[0].squads), 2)
        self.assertEqual(len(upcoming.opponents[1].squads), 1)
        self.assertEqual(upcoming.opponents[1].squads[0].age_group, "U13")

    def test_ten_day_windows_keep_today_and_drop_this_weekends_past_days_from_upcoming(self) -> None:
        today = date(2026, 10, 25)

        def squad(team_id: int, club_id: int, age: str, name: str) -> ScheduleTeam:
            return ScheduleTeam(
                id=team_id,
                name=name,
                age_group=age,
                tier="ECNL",
                conference="ECNL Boys East",
                city="Jacksonville",
                state="FL",
                gender="boys",
                club_id=club_id,
            )

        def match(game_id: int, home: ScheduleTeam, away: ScheduleTeam, day: date, status: str = "SCHEDULED", home_score: int | None = None, away_score: int | None = None) -> ScheduleGame:
            game = ScheduleGame(
                id=game_id,
                home_team_id=int(home.id),
                away_team_id=int(away.id),
                starts_at=_kick(day, 10),
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

        ours = squad(1, 7, "U13", "Home FC")
        rival = squad(10, 50, "U13", "Rival FC")
        edge = squad(11, 51, "U13", "Edge FC")
        beyond = squad(12, 52, "U13", "Beyond FC")
        games = [
            match(1, ours, rival, today - timedelta(days=11), "COMPLETED", 1, 0),
            match(2, ours, rival, today - timedelta(days=10), "COMPLETED", 2, 0),
            match(3, ours, rival, date(2026, 10, 23), "COMPLETED", 3, 1),
            match(4, ours, rival, date(2026, 10, 24), "COMPLETED", 1, 0),
            match(5, ours, rival, today, "COMPLETED", 4, 0),
            match(6, ours, rival, today),
            match(7, ours, edge, today + timedelta(days=10)),
            match(8, ours, beyond, today + timedelta(days=11)),
        ]
        clubs = {
            50: Club(id=50, name="Rival FC", logo_url=None),
            51: Club(id=51, name="Edge FC", logo_url=None),
            52: Club(id=52, name="Beyond FC", logo_url=None),
        }
        cards, upcoming = group_weekends(games, {1}, clubs, 7, today=today)
        played = [row.played_on for card in cards for row in card.squads]
        self.assertEqual(played, [today, date(2026, 10, 24), date(2026, 10, 23), today - timedelta(days=10)])
        self.assertNotIn(today - timedelta(days=11), played)
        self.assertIsNotNone(upcoming)
        assert upcoming is not None
        by_name = {item.opponent_name: [row.game_date for row in item.squads] for item in upcoming.opponents}
        self.assertEqual(by_name["Rival FC"], [today])
        self.assertEqual(by_name["Edge FC"], [today + timedelta(days=10)])
        self.assertNotIn("Beyond FC", by_name)
        self.assertNotIn(date(2026, 10, 23), [day for days in by_name.values() for day in days])
        self.assertNotIn(date(2026, 10, 24), [day for days in by_name.values() for day in days])


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
        coming = today + timedelta(days=4)
        recent = today - timedelta(days=2)
        single = today - timedelta(days=20)
        nomads = today - timedelta(days=16)
        wednesday = today - timedelta(days=4)
        tuesday = today - timedelta(days=12)
        thursday = today + timedelta(days=1)

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
            u13 = add_team("Probe Club Page FC", "U13", "boys", "ECNL", east, CLUB_ID)
            u13_rl = add_team("Probe Club Page FC", "U13", "boys", "ECNL-RL", south, CLUB_ID)
            u14 = add_team("Probe Club Page FC", "U14", "boys", "ECNL-RL", south, CLUB_ID)
            u15 = add_team("Probe Club Page FC", "U15", "boys", "ECNL", east, CLUB_ID)
            u16 = add_team("Probe Club Page FC", "U16", "boys", "ECNL", east, CLUB_ID)
            g13 = add_team("Probe Club Page FC", "U13", "girls", "ECNL", west, CLUB_ID)
            g17 = add_team("Probe Club Page FC", "U17", "girls", "ECNL", west, CLUB_ID)
            rival_u13 = add_team("Probe Club Page Rival", "U13", "boys", "ECNL", east, RIVAL_ID)
            rival_u14 = add_team("Probe Club Page Rival", "U14", "boys", "ECNL-RL", south, RIVAL_ID)
            rival_g13 = add_team("Probe Club Page Rival", "U13", "girls", "ECNL", west, RIVAL_ID)
            rival_u16 = add_team("Probe Club Page Rival", "U16", "boys", "ECNL", east, RIVAL_ID)
            other_u15 = add_team("Probe Club Page Other", "U15", "boys", "ECNL", east, OTHER_ID)
            other_u14 = add_team("Probe Club Page Other", "U14", "boys", "ECNL-RL", south, OTHER_ID)
            other_g17 = add_team("Probe Club Page Other", "U17", "girls", "ECNL", west, OTHER_ID)
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
        self.assertEqual(body["id"], CLUB_ID)
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

        self.assertEqual(len(body["weekends"]), 1)
        recent_card = body["weekends"][0]
        self.assertFalse(recent_card["upcoming"])
        self.assertEqual(recent_card["opponent_name"], "Probe Club Page Rival")
        self.assertEqual(recent_card["weekend_start"], recent.isoformat())
        self.assertEqual((recent_card["wins"], recent_card["losses"], recent_card["draws"]), (1, 1, 0))
        self.assertEqual(
            [(row["age_group"], row["gender"], row["tier"], row["result"], row["opponent_squad_name"], row["goals_for"], row["goals_against"], row["played_on"]) for row in recent_card["squads"]],
            [
                ("U13", "boys", "ECNL", "W", "Probe Club Page Rival", 2, 0, recent.isoformat()),
                ("U14", "boys", "ECNL-RL", "L", "Probe Club Page Rival", 0, 1, recent.isoformat()),
            ],
        )
        past_days = [row["played_on"] for card in body["weekends"] for row in card["squads"]]
        self.assertTrue(all(row >= (today - timedelta(days=10)).isoformat() for row in past_days))
        self.assertNotIn(single.isoformat(), past_days)
        self.assertNotIn(tuesday.isoformat(), past_days)

        upcoming = body["upcoming"]
        self.assertEqual([item["opponent_name"] for item in upcoming["opponents"]], ["Probe Club Page Other", "Probe Club Page Rival"])
        self.assertEqual(
            [(row["age_group"], row["gender"], row["tier"]) for row in upcoming["opponents"][0]["squads"]],
            [("U14", "boys", "ECNL-RL"), ("U17", "girls", "ECNL")],
        )
        self.assertEqual(
            [(row["age_group"], row["gender"], row["tier"]) for row in upcoming["opponents"][1]["squads"]],
            [("U13", "boys", "ECNL"), ("U13", "girls", "ECNL"), ("U16", "boys", "ECNL")],
        )
        upcoming_days = [row["game_date"] for item in upcoming["opponents"] for row in item["squads"]]
        self.assertTrue(all(day > today.isoformat() for day in upcoming_days))
        self.assertIn(thursday.isoformat(), upcoming_days)
        self.assertIn(coming.isoformat(), upcoming_days)

        venue_names = [venue["venue_name"] for venue in body["venues"]]
        self.assertEqual(venue_names, ["Probe Annex", "Probe Complex"])
        annex = body["venues"][0]
        self.assertEqual(annex["city"], "Orlando")
        self.assertIsNone(annex["field_name"])
        self.assertIsNone(annex["latitude"])
        complex_row = body["venues"][1]
        self.assertEqual(complex_row["city"], "Jacksonville")
        self.assertIsNone(complex_row["field_name"])
        self.assertEqual(complex_row["latitude"], 30.5)
        self.assertEqual(complex_row["longitude"], -81.25)
        self.assertNotIn("Rival Stadium", venue_names)
        self.assertNotIn("address", body["venues"][0])

        self.assertEqual(found.status_code, 200)
        self.assertEqual(found.json()[0]["id"], CLUB_ID)
        self.assertEqual(found.json()[0]["team_count"], 7)
        self.assertEqual(empty.json(), [])
        self.assertEqual(schedule.status_code, 200)
        self.assertEqual(schedule.json()["club_id"], CLUB_ID)

    def test_distinct_team_names_are_separate_pages_and_case_folds(self) -> None:
        """One stored name is one page. Ages stay together. BLACK and Black share a page."""

        split_id = 8801201
        ages_id = 8801202
        tone_id = 8801203
        today = datetime.now(EASTERN).date()
        played = today - timedelta(days=1)
        older = today - timedelta(days=11)
        coming = today + timedelta(days=1)
        north_slug = f"{split_id}-probe-club-page-north"
        south_slug = f"{split_id}-probe-club-page-south"
        black_slug = f"{tone_id}-probe-club-page-tone-black"
        with Session(engine) as session:
            session.add_all(
                (
                    Club(id=split_id, name="Probe Club Page Split", logo_url="https://example.com/probe-split.png", parent_club_id=None),
                    Club(id=ages_id, name="Probe Club Page Ages", logo_url=None, parent_club_id=None),
                    Club(id=tone_id, name="Probe Club Page Tone Parent", logo_url="https://example.com/probe-tone.png", parent_club_id=None),
                )
            )
            session.flush()

            def add_team(name: str, age: str, club_id: int, gender: str = "boys") -> ScheduleTeam:
                team = ScheduleTeam(
                    name=name,
                    age_group=age,
                    tier="ECNL",
                    conference="ECNL Boys Probe Club Page East",
                    city="St Johns",
                    state="FL",
                    gender=gender,
                    club_id=club_id,
                )
                session.add(team)
                session.flush()
                return team

            north_u13 = add_team("Probe Club Page North", "U13", split_id)
            north_u15 = add_team("Probe Club Page North", "U15", split_id, gender="girls")
            south = add_team("Probe Club Page South", "U14", split_id)
            add_team("Probe Club Page Ages", "U13", ages_id)
            add_team("Probe Club Page Ages", "U15", ages_id, gender="girls")
            black = add_team("Probe Club Page Tone BLACK", "U13", tone_id)
            mixed = add_team("Probe Club Page Tone Black", "U14", tone_id)
            add_team("Probe Club Page Tone", "U15", tone_id)

            def add_game(home: ScheduleTeam, away: ScheduleTeam, day: date, status: str, home_score: int | None, away_score: int | None, venue: str, city: str) -> None:
                session.add(
                    ScheduleGame(
                        home_team_id=int(home.id),
                        away_team_id=int(away.id),
                        starts_at=_kick(day, 11),
                        venue_name=venue,
                        city=city,
                        state="FL",
                        timezone="America/New_York",
                        status=status,
                        home_score=home_score,
                        away_score=away_score,
                        is_conference_game=True,
                        field_name="Pitch 1",
                    )
                )

            add_game(north_u13, south, played, "COMPLETED", 2, 0, "North Park", "Jacksonville")
            add_game(north_u13, south, older, "COMPLETED", 1, 0, "North Park", "Jacksonville")
            add_game(south, north_u15, coming, "SCHEDULED", None, None, "South Park", "Tallahassee")
            session.commit()
            north_ids = {int(north_u13.id), int(north_u15.id)}
            south_id = int(south.id)
            black_ids = {int(black.id), int(mixed.id)}

        with TestClient(app) as client:
            found = client.get("/clubs", params={"q": "Probe Club Page"})
            north_only = client.get("/clubs", params={"q": "Probe Club Page North"})
            ages = client.get("/clubs", params={"q": "Probe Club Page Ages"})
            tones = client.get("/clubs", params={"q": "Probe Club Page Tone"})
            merged = client.get(f"/clubs/{split_id}")
            north_page = client.get(f"/clubs/{north_slug}")
            south_page = client.get(f"/clubs/{south_slug}")
            ages_page = client.get(f"/clubs/{ages_id}")
            ages_slug = client.get(f"/clubs/{ages_id}-probe-club-page-ages")
            black_page = client.get(f"/clubs/{black_slug}")
            tone_bare = client.get(f"/clubs/{tone_id}")

        self.assertEqual(merged.status_code, 404)
        self.assertEqual(tone_bare.status_code, 404)
        self.assertEqual(ages_slug.status_code, 404)
        by_name = {row["name"]: row for row in found.json()}
        self.assertEqual((by_name["Probe Club Page North"]["id"], by_name["Probe Club Page North"]["team_count"]), (north_slug, 2))
        self.assertEqual((by_name["Probe Club Page South"]["id"], by_name["Probe Club Page South"]["team_count"]), (south_slug, 1))
        self.assertEqual(north_only.json()[0]["id"], north_slug)
        self.assertEqual(north_only.json()[0]["logo_url"], "https://example.com/probe-split.png")
        self.assertEqual([(row["id"], row["name"], row["team_count"]) for row in ages.json()], [(ages_id, "Probe Club Page Ages", 2)])
        self.assertEqual(
            [(row["id"], row["name"], row["team_count"]) for row in tones.json()],
            [(f"{tone_id}-probe-club-page-tone", "Probe Club Page Tone", 1), (black_slug, "Probe Club Page Tone Black", 2)],
        )

        self.assertEqual(ages_page.status_code, 200)
        self.assertEqual(ages_page.json()["id"], ages_id)
        self.assertEqual(ages_page.json()["name"], "Probe Club Page Ages")
        self.assertEqual(sorted(squad["age_group"] for squad in ages_page.json()["squads"]), ["U13", "U15"])

        self.assertEqual(north_page.status_code, 200)
        north_body = north_page.json()
        self.assertEqual(north_body["id"], north_slug)
        self.assertEqual(north_body["name"], "Probe Club Page North")
        self.assertEqual(north_body["logo_url"], "https://example.com/probe-split.png")
        self.assertEqual({squad["id"] for squad in north_body["squads"]}, north_ids)
        self.assertEqual(north_body["record"], {"wins": 2, "losses": 0, "draws": 0, "goal_diff": 3})
        self.assertEqual([venue["venue_name"] for venue in north_body["venues"]], ["North Park"])
        self.assertEqual(north_body["weekends"][0]["opponent_name"], "Probe Club Page South")
        self.assertEqual(north_body["weekends"][0]["opponent_club_id"], south_slug)
        self.assertEqual(north_body["weekends"][0]["squads"][0]["played_on"], played.isoformat())
        self.assertNotIn(older.isoformat(), [row["played_on"] for card in north_body["weekends"] for row in card["squads"]])
        self.assertEqual([row["game_date"] for item in north_body["upcoming"]["opponents"] for row in item["squads"]], [coming.isoformat()])

        self.assertEqual(south_page.status_code, 200)
        self.assertEqual(south_page.json()["name"], "Probe Club Page South")
        self.assertEqual([squad["id"] for squad in south_page.json()["squads"]], [south_id])
        self.assertEqual(south_page.json()["weekends"][0]["opponent_name"], "Probe Club Page North")

        self.assertEqual(black_page.status_code, 200)
        black_body = black_page.json()
        self.assertEqual(black_body["name"], "Probe Club Page Tone Black")
        self.assertEqual(black_body["logo_url"], "https://example.com/probe-tone.png")
        self.assertEqual({squad["id"] for squad in black_body["squads"]}, black_ids)
        self.assertEqual(sorted(squad["name"] for squad in black_body["squads"]), ["Probe Club Page Tone BLACK", "Probe Club Page Tone Black"])

    def test_sporting_sa_city_urls_alias_the_name_pages(self) -> None:
        with TestClient(app) as client:
            alias = client.get("/clubs/1353-jax")
            canonical = client.get("/clubs/1353-sporting-sa-jax")
            tlh_alias = client.get("/clubs/1353-tlh")
            tlh = client.get("/clubs/1353-sporting-sa-tlh")
            bare = client.get("/clubs/1353")
        self.assertEqual(bare.status_code, 404)
        self.assertEqual(alias.status_code, 200)
        self.assertEqual(canonical.status_code, 200)
        self.assertEqual(alias.json()["id"], "1353-sporting-sa-jax")
        self.assertEqual(alias.json()["name"], "Sporting SA JAX")
        self.assertEqual(canonical.json(), alias.json())
        self.assertEqual(tlh_alias.status_code, 200)
        self.assertEqual(tlh_alias.json()["id"], "1353-sporting-sa-tlh")
        self.assertEqual(tlh_alias.json()["name"], "Sporting SA TLH")
        self.assertEqual(tlh.json()["id"], tlh_alias.json()["id"])
        self.assertNotEqual(alias.json()["team_count"], tlh_alias.json()["team_count"])

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
                everything = client.get("/clubs", params={"all": "true", "q": "Probe Club Page Cap"})
        finally:
            clubs_module.CLUB_LIST_LIMIT = original

        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.json()), 1)
        self.assertGreaterEqual(listed.json()[0]["team_count"], 1)
        self.assertEqual(len(narrowed.json()), 1)
        self.assertEqual(named.json()[0]["name"], "Probe Club Page Cap 2")
        self.assertEqual(CLUB_LIST_LIMIT, 30)
        self.assertEqual(everything.status_code, 200)
        self.assertGreaterEqual(len(everything.json()), 3)
        self.assertTrue(
            {"Probe Club Page Cap 0", "Probe Club Page Cap 1", "Probe Club Page Cap 2"} <= {row["name"] for row in everything.json()}
        )
