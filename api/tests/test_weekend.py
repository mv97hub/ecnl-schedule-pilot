"""Website weekend map: stored pins only, and no lookup or overwrite."""

from __future__ import annotations

import os
import sys
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session
from sqlmodel import SQLModel

from app.database import engine
from app.locations import make_venue_key
from app.main import app
from app.models import Base, Club, ScheduleGame, ScheduleTeam, UserHomeAddress, VenueFieldPoint, VenueRating, VenueRecommendation
from app.places import PlacesUnavailable
from app.weekend import default_window, season_end

SECRET = "probe-weekend-secret"
EASTERN = ZoneInfo("America/New_York")
CLUB_ID = 8807701
RIVAL_ID = 8807702
DECOY_LAT = 44.12345


def _sign_in(client: TestClient, subject: str) -> dict[str, str]:
    os.environ["AUTH_INTERNAL_SECRET"] = SECRET
    opened = client.post(
        "/auth/session",
        headers={"X-Internal-Auth": SECRET},
        json={
            "provider": "google",
            "subject": subject,
            "email": f"{subject}@probe-weekend.test",
            "email_verified": True,
            "display_name": "Weekend Family",
            "client": "web",
        },
    )
    assert opened.status_code == 200, opened.text
    return {"Authorization": f"Bearer {opened.json()['token']}"}


def _noon(day_offset: int) -> datetime:
    day = datetime.now(EASTERN).date() + timedelta(days=day_offset)
    return datetime(day.year, day.month, day.day, 12, tzinfo=EASTERN)


class WeekendMapTests(unittest.TestCase):
    def setUp(self) -> None:
        Base.metadata.create_all(engine)
        SQLModel.metadata.create_all(engine)
        os.environ["AUTH_INTERNAL_SECRET"] = SECRET
        self._cleanup()

    def tearDown(self) -> None:
        self._cleanup()

    def _cleanup(self) -> None:
        with engine.begin() as connection:
            prefix = "Probe Weekend%"
            if connection.execute(text("SELECT to_regclass('public.game')")).scalar() is not None:
                connection.execute(text("DELETE FROM game WHERE venue_name LIKE :prefix"), {"prefix": prefix})
            if connection.execute(text("SELECT to_regclass('public.venue_rating')")).scalar() is not None:
                connection.execute(text("DELETE FROM venue_rating WHERE venue_name LIKE :prefix"), {"prefix": prefix})
            if connection.execute(text("SELECT to_regclass('public.venue_recommendation')")).scalar() is not None:
                connection.execute(text("DELETE FROM venue_recommendation WHERE venue_name LIKE :prefix"), {"prefix": prefix})
            if connection.execute(text("SELECT to_regclass('public.venue_field_point')")).scalar() is not None:
                connection.execute(text("DELETE FROM venue_field_point WHERE venue_name LIKE :prefix"), {"prefix": prefix})
            if connection.execute(text("SELECT to_regclass('public.team')")).scalar() is not None:
                connection.execute(
                    text(
                        """
                        DELETE FROM game
                        WHERE home_team_id IN (SELECT id FROM team WHERE name LIKE :prefix)
                           OR away_team_id IN (SELECT id FROM team WHERE name LIKE :prefix)
                        """
                    ),
                    {"prefix": prefix},
                )
                connection.execute(text("DELETE FROM team WHERE name LIKE :prefix"), {"prefix": prefix})
            if connection.execute(text("SELECT to_regclass('public.club')")).scalar() is not None:
                connection.execute(
                    text("DELETE FROM club WHERE id IN (:home, :rival) OR name LIKE :prefix"),
                    {"home": CLUB_ID, "rival": RIVAL_ID, "prefix": prefix},
                )
            if connection.execute(text("SELECT to_regclass('public.auth_identity')")).scalar() is not None:
                connection.execute(
                    text(
                        """
                        DELETE FROM app_user
                        WHERE id IN (
                            SELECT user_id FROM auth_identity
                            WHERE provider_subject LIKE 'probe-weekend-%'
                        )
                        """
                    )
                )

    def test_window_defaults_to_fourteen_days_and_the_slider_reaches_the_last_game(self) -> None:
        today = datetime.now(EASTERN).date()
        window_start, window_end = default_window(today)
        self.assertEqual(window_start, today)
        self.assertEqual((window_end - window_start).days, 13)
        self.assertEqual(season_end(today, None), window_end)
        self.assertEqual(season_end(today, today + timedelta(days=2)), window_end)
        self.assertEqual(season_end(today, today + timedelta(days=40)), today + timedelta(days=40))

    def test_reads_stored_pins_and_leaves_them_alone(self) -> None:
        today = datetime.now(EASTERN).date()
        complex_key = make_venue_key("Probe Weekend Complex", "Probeville", "FL")
        annex_key = make_venue_key("Probe Weekend Annex", "Probeville", "FL")
        tbd_key = make_venue_key("TBD", "Probeville", "FL")
        stamped = datetime(2026, 1, 2, 3, 4, tzinfo=UTC)
        with Session(engine) as session:
            session.add_all(
                (
                    Club(id=CLUB_ID, name="Probe Weekend FC", logo_url=None),
                    Club(id=RIVAL_ID, name="Probe Weekend Rival", logo_url=None),
                )
            )
            session.flush()

            def add_team(name: str, age: str, club_id: int) -> ScheduleTeam:
                team = ScheduleTeam(
                    name=name,
                    age_group=age,
                    tier="ECNL",
                    conference="Probe Weekend Conference",
                    city="Probeville",
                    state="FL",
                    gender="boys",
                    club_id=club_id,
                )
                session.add(team)
                session.flush()
                return team

            ours = add_team("Probe Weekend FC", "U13", CLUB_ID)
            other = add_team("Probe Weekend FC", "U14", CLUB_ID)
            rival = add_team("Probe Weekend Rival", "U13", RIVAL_ID)
            rival_other = add_team("Probe Weekend Rival", "U14", RIVAL_ID)
            ours_id = int(ours.id)
            other_id = int(other.id)
            rival_id = int(rival.id)

            def add_game(
                home: ScheduleTeam,
                away: ScheduleTeam,
                when: datetime,
                venue: str,
                field: str | None,
                status: str = "SCHEDULED",
                lat: float | None = None,
            ) -> None:
                session.add(
                    ScheduleGame(
                        home_team_id=int(home.id),
                        away_team_id=int(away.id),
                        starts_at=when,
                        venue_name=venue,
                        city="Probeville",
                        state="FL",
                        timezone="America/New_York",
                        status=status,
                        is_conference_game=True,
                        field_name=field,
                        field_surface="artificial turf",
                        venue_lat=lat,
                        venue_lng=-81.5 if lat is not None else None,
                    )
                )

            add_game(rival, ours, _noon(1), "Probe Weekend Complex", "Field 2", lat=DECOY_LAT)
            add_game(other, rival_other, _noon(1), "Probe Weekend Complex", "Field 4")
            add_game(ours, rival, _noon(2), "Probe Weekend Complex", "Field 2", status="POSTPONED")
            add_game(ours, rival, _noon(3), "Probe Weekend Annex", None)
            add_game(ours, rival, _noon(4), "TBD", None)
            add_game(ours, rival, _noon(20), "Probe Weekend Complex", "Field 2")
            add_game(ours, rival, _noon(40), "Probe Weekend Complex", "Field 2")
            add_game(ours, rival, _noon(-1), "Probe Weekend Complex", "Field 2")
            session.add(
                VenueFieldPoint(
                    venue_key=complex_key,
                    venue_name="Probe Weekend Complex",
                    city="Probeville",
                    state="FL",
                    status="found",
                    latitude=29.1,
                    longitude=-81.2,
                    pin_rule="manual",
                    fetched_at=stamped,
                )
            )
            session.add(
                VenueRating(
                    venue_key=complex_key,
                    venue_name="Probe Weekend Complex",
                    city="Probeville",
                    state="FL",
                    author_key="probe-weekend-rater",
                    field_quality=4,
                    referees=3,
                    parent_vibe=3,
                    parking_access=4,
                    amenities=3,
                    surface_vote="TURF",
                    updated_at=stamped,
                )
            )
            session.add(
                VenueRecommendation(
                    venue_key=complex_key,
                    venue_name="Probe Weekend Complex",
                    city="Probeville",
                    state="FL",
                    category="SIDELINE_TIP",
                    title="West sideline",
                    rating=5,
                    review_text="Limited cover along the west side.",
                    tags="Bring Shade, Paid Parking",
                    author_name="Weekend Family",
                    author_key="probe-weekend-tip",
                    upvotes=2,
                    downvotes=0,
                    created_at=stamped,
                )
            )
            session.add(
                VenueRecommendation(
                    venue_key=complex_key,
                    venue_name="Probe Weekend Complex",
                    city="Probeville",
                    state="FL",
                    category="HOTEL",
                    title="Probe Weekend Inn",
                    rating=5,
                    review_text="This hotel note must stay off the home.",
                    tags="Free Breakfast",
                    author_name="Weekend Family",
                    author_key="probe-weekend-hotel",
                    upvotes=9,
                    downvotes=0,
                    created_at=stamped,
                )
            )
            session.commit()

        with TestClient(app) as client:
            refused = client.get("/me/weekend")
            self.assertEqual(refused.status_code, 401)

            headers = _sign_in(client, "probe-weekend-owner")
            saved = client.put(
                "/me/favorites",
                json={"club_id": str(CLUB_ID), "team_ids": [ours_id]},
                headers=headers,
            )
            self.assertEqual(saved.status_code, 200, saved.text)
            with Session(engine) as session:
                before = session.scalar(select(func.count()).select_from(VenueFieldPoint))
            body = client.get("/me/weekend", headers=headers)
            self.assertEqual(body.status_code, 200, body.text)
            payload = body.json()
            self.assertNotIn(str(DECOY_LAT), body.text)
            self.assertNotIn("verified", body.text.casefold())

        with Session(engine) as session:
            after = session.scalar(select(func.count()).select_from(VenueFieldPoint))
            self.assertEqual(before, after)
            self.assertIsNone(session.get(VenueFieldPoint, annex_key))
            self.assertIsNone(session.get(VenueFieldPoint, tbd_key))
            stored = session.get(VenueFieldPoint, complex_key)
            self.assertIsNotNone(stored)
            assert stored is not None
            self.assertEqual(stored.latitude, 29.1)
            self.assertEqual(stored.longitude, -81.2)
            self.assertEqual(stored.pin_rule, "manual")
            self.assertEqual(stored.status, "found")
            self.assertEqual(stored.fetched_at, stamped)

        self.assertTrue(payload["has_favorites"])
        self.assertFalse(payload["club_games"])
        self.assertEqual(payload["club_name"], "Probe Weekend FC")
        self.assertEqual(payload["lead_team_id"], ours_id)
        self.assertEqual(payload["window_start"], today.isoformat())
        self.assertEqual(payload["window_end"], (today + timedelta(days=13)).isoformat())
        self.assertEqual(payload["range_start"], today.isoformat())
        self.assertEqual(payload["range_end"], (today + timedelta(days=40)).isoformat())
        self.assertIsNone(payload["home"])
        days = {game["day"] for game in payload["games"]}
        self.assertIn((today + timedelta(days=1)).isoformat(), days)
        self.assertIn((today + timedelta(days=20)).isoformat(), days)
        self.assertIn((today + timedelta(days=40)).isoformat(), days)
        self.assertNotIn((today - timedelta(days=1)).isoformat(), days)
        self.assertTrue(all(game["squad"]["id"] == ours_id for game in payload["games"]))
        self.assertNotIn(other_id, [game["squad"]["id"] for game in payload["games"]])

        by_day = {}
        for game in payload["games"]:
            by_day.setdefault(game["day"], []).append(game)
        played = by_day[(today + timedelta(days=1)).isoformat()]
        self.assertEqual(len(played), 1)
        self.assertEqual(played[0]["field_name"], "Field 2")
        self.assertEqual(played[0]["pin"], {"latitude": 29.1, "longitude": -81.2})
        self.assertFalse(played[0]["pin_missing"])
        self.assertEqual(played[0]["opponent_id"], rival_id)
        self.assertEqual(played[0]["opponent_club_name"], "Probe Weekend Rival")
        self.assertEqual(played[0]["note"]["surface"], "Turf")
        self.assertEqual(played[0]["note"]["parking"], 4.0)
        self.assertIn("Bring Shade", played[0]["note"]["line"])
        self.assertNotIn("hotel", played[0]["note"]["line"].casefold())

        postponed = by_day[(today + timedelta(days=2)).isoformat()][0]
        self.assertEqual(postponed["status"], "POSTPONED")
        self.assertIsNone(postponed["pin"])
        self.assertFalse(postponed["pin_missing"])

        missing = by_day[(today + timedelta(days=3)).isoformat()][0]
        self.assertIsNone(missing["pin"])
        self.assertTrue(missing["pin_missing"])

        tbd = by_day[(today + timedelta(days=4)).isoformat()][0]
        self.assertIsNone(tbd["pin"])
        self.assertTrue(tbd["pin_missing"])

        with TestClient(app) as client:
            headers = _sign_in(client, "probe-weekend-club")
            club_only = client.put("/me/favorites", json={"club_id": str(CLUB_ID), "team_ids": []}, headers=headers)
            self.assertEqual(club_only.status_code, 200, club_only.text)
            body = client.get("/me/weekend", headers=headers)
            self.assertEqual(body.status_code, 200, body.text)
            payload = body.json()
            self.assertTrue(payload["club_games"])
            squads = {game["squad"]["id"] for game in payload["games"] if game["day"] == (today + timedelta(days=1)).isoformat()}
            self.assertEqual(squads, {ours_id, other_id})

    def test_home_star_is_geocoded_once_and_field_pins_stay_put(self) -> None:
        complex_key = make_venue_key("Probe Weekend Complex", "Probeville", "FL")
        stamped = datetime(2026, 1, 2, 3, 4, tzinfo=UTC)
        with Session(engine) as session:
            session.add_all(
                (
                    Club(id=CLUB_ID, name="Probe Weekend FC", logo_url=None),
                    Club(id=RIVAL_ID, name="Probe Weekend Rival", logo_url=None),
                )
            )
            session.flush()
            ours = ScheduleTeam(
                name="Probe Weekend FC",
                age_group="U13",
                tier="ECNL",
                conference="Probe Weekend Conference",
                city="Probeville",
                state="FL",
                gender="boys",
                club_id=CLUB_ID,
            )
            rival = ScheduleTeam(
                name="Probe Weekend Rival",
                age_group="U13",
                tier="ECNL",
                conference="Probe Weekend Conference",
                city="Probeville",
                state="FL",
                gender="boys",
                club_id=RIVAL_ID,
            )
            session.add_all((ours, rival))
            session.flush()
            ours_id = int(ours.id)
            session.add(
                ScheduleGame(
                    home_team_id=ours_id,
                    away_team_id=int(rival.id),
                    starts_at=_noon(1),
                    venue_name="Probe Weekend Complex",
                    city="Probeville",
                    state="FL",
                    timezone="America/New_York",
                    status="SCHEDULED",
                    is_conference_game=True,
                    field_name="Field 2",
                )
            )
            session.add(
                VenueFieldPoint(
                    venue_key=complex_key,
                    venue_name="Probe Weekend Complex",
                    city="Probeville",
                    state="FL",
                    latitude=29.1,
                    longitude=-81.2,
                    status="found",
                    pin_rule="manual",
                    fetched_at=stamped,
                )
            )
            session.commit()

        address = {
            "street": "10 Oak Street",
            "unit": "",
            "city": "Probeville",
            "state": "FL",
            "postal_code": "32000",
        }
        with TestClient(app) as client:
            headers = _sign_in(client, "probe-weekend-home")
            saved = client.put("/me/favorites", json={"club_id": str(CLUB_ID), "team_ids": [ours_id]}, headers=headers)
            self.assertEqual(saved.status_code, 200, saved.text)
            with patch("app.weekend.geocode_street_address") as geo:
                bare = client.get("/me/weekend", headers=headers)
                self.assertEqual(bare.status_code, 200, bare.text)
                self.assertIsNone(bare.json()["home"])
                self.assertEqual(geo.call_count, 0)

            written = client.put("/me/home-address", json=address, headers=headers)
            self.assertEqual(written.status_code, 200, written.text)
            with patch("app.weekend.geocode_street_address", return_value=None) as missed:
                empty = client.get("/me/weekend", headers=headers)
                self.assertIsNone(empty.json()["home"])
                self.assertEqual(missed.call_count, 1)
            with patch("app.weekend.geocode_street_address", side_effect=PlacesUnavailable()) as down:
                quiet = client.get("/me/weekend", headers=headers)
                self.assertEqual(quiet.status_code, 200, quiet.text)
                self.assertIsNone(quiet.json()["home"])
                self.assertEqual(down.call_count, 1)
            with patch("app.weekend.geocode_street_address", return_value=(30.25, -81.4)) as found:
                first = client.get("/me/weekend", headers=headers)
                self.assertEqual(first.json()["home"], {"latitude": 30.25, "longitude": -81.4})
                self.assertNotIn("Oak Street", first.text)
                self.assertEqual(found.call_count, 1)
                second = client.get("/me/weekend", headers=headers)
                self.assertEqual(second.json()["home"], {"latitude": 30.25, "longitude": -81.4})
                self.assertEqual(found.call_count, 1)

        with Session(engine) as session:
            stored = session.get(VenueFieldPoint, complex_key)
            self.assertIsNotNone(stored)
            assert stored is not None
            self.assertEqual(stored.latitude, 29.1)
            self.assertEqual(stored.longitude, -81.2)
            self.assertEqual(stored.pin_rule, "manual")
            self.assertEqual(stored.fetched_at, stamped)
            homes = list(session.scalars(select(UserHomeAddress)).all())
            self.assertEqual(len(homes), 1)
            self.assertEqual(homes[0].latitude, 30.25)
            self.assertEqual(homes[0].longitude, -81.4)
            self.assertEqual(homes[0].street, "10 Oak Street")
