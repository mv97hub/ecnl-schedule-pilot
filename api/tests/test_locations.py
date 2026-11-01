"""Complex identity and profile ratings for the locations guide."""

from __future__ import annotations

import sys
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session
from sqlmodel import SQLModel

from app.database import engine
from app.locations import make_venue_key
from app.main import app
from app.models import Base, ScheduleGame, ScheduleTeam, VenueRating, VenueRecommendation

PROFILE = "probe-location-same"
OTHER = "probe-location-other"


def _rating(venue_name: str, field_quality: int, comment: str, surface: str) -> dict[str, object]:
    return {
        "venue_name": venue_name,
        "city": "Probeville",
        "state": "FL",
        "field_quality": field_quality,
        "referees": 3,
        "parent_vibe": 5,
        "parking_access": 2,
        "amenities": 4,
        "surface_vote": surface,
        "comment": comment,
        "author_name": "U14 Parent",
    }


class LocationGuideTests(unittest.TestCase):
    def setUp(self) -> None:
        Base.metadata.create_all(engine)
        SQLModel.metadata.create_all(engine)
        self._cleanup()

    def tearDown(self) -> None:
        self._cleanup()

    def _cleanup(self) -> None:
        with engine.begin() as connection:
            if connection.execute(text("SELECT to_regclass('public.venue_rating')")).scalar() is not None:
                connection.execute(
                    text("DELETE FROM venue_rating WHERE city = 'Probeville' OR author_key LIKE 'probe-location-%'")
                )
            if connection.execute(text("SELECT to_regclass('public.venue_recommendation')")).scalar() is not None:
                connection.execute(
                    text(
                        "DELETE FROM venue_recommendation WHERE city = 'Probeville' OR author_key LIKE 'probe-location-%'"
                    )
                )
            if connection.execute(text("SELECT to_regclass('public.game')")).scalar() is not None:
                connection.execute(
                    text(
                        """
                        DELETE FROM game
                        WHERE city = 'Probeville'
                           OR home_team_id IN (SELECT id FROM team WHERE name LIKE 'Probe Location %')
                           OR away_team_id IN (SELECT id FROM team WHERE name LIKE 'Probe Location %')
                        """
                    )
                )
            if connection.execute(text("SELECT to_regclass('public.team')")).scalar() is not None:
                connection.execute(text("DELETE FROM team WHERE name LIKE 'Probe Location %'"))

    def test_api_starts(self) -> None:
        with TestClient(app) as client:
            health = client.get("/health")
            listed = client.get("/locations")
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.json()["status"], "ok")
        self.assertEqual(listed.status_code, 200)
        self.assertIsInstance(listed.json(), list)

    def test_second_rating_updates_the_same_profile(self) -> None:
        with TestClient(app) as client:
            first = client.post("/locations/rate", json=_rating("Davis Park - Field 1", 4, "First", "GRASS"), headers={"X-Profile-Key": PROFILE})
            self.assertEqual(first.status_code, 200, first.text)
            second = client.post(
                "/locations/rate",
                json=_rating("Davis Park - Field 2", 2, "Updated", "TURF"),
                headers={"X-Profile-Key": PROFILE},
            )
            self.assertEqual(second.status_code, 200, second.text)
            body = second.json()
            self.assertEqual(body["ratings_count"], 1)
            self.assertEqual(body["field_quality"], 2)
            self.assertEqual(body["dominant_surface"], "TURF")
            self.assertEqual(body["venue_name"], "Davis Park")
            self.assertEqual(
                body["venue_key"],
                make_venue_key("Davis Park - Field 1", "Probeville", "FL"),
            )
            with Session(engine) as session:
                rows = list(session.scalars(select(VenueRating).where(VenueRating.author_key == PROFILE)).all())
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0].field_quality, 2)
            self.assertEqual(rows[0].comment, "Updated")
            self.assertEqual(rows[0].venue_name, "Davis Park")
            self.assertIsNone(rows[0].user_id)

            other = client.post("/locations/rate", json=_rating("Davis Park - Field 1", 5, "Other family", "GRASS"), headers={"X-Profile-Key": OTHER})
            self.assertEqual(other.status_code, 200, other.text)
            self.assertEqual(other.json()["ratings_count"], 2)
            with Session(engine) as session:
                count = session.scalar(
                    select(func.count()).select_from(VenueRating).where(VenueRating.author_key.in_([PROFILE, OTHER]))
                )
                kept = session.scalar(select(VenueRating).where(VenueRating.author_key == PROFILE))
            self.assertEqual(count, 2)
            self.assertIsNotNone(kept)
            assert kept is not None
            self.assertEqual(kept.field_quality, 2)

    def test_field_numbers_roll_into_one_complex(self) -> None:
        self.assertEqual(
            make_venue_key("Davis Park - Field 1", "Probeville", "FL"),
            make_venue_key("Davis Park - Field 2", "Probeville", "FL"),
        )
        self.assertNotEqual(
            make_venue_key("Davis Park - Field 1", "Probeville", "FL"),
            make_venue_key("Other Park", "Probeville", "FL"),
        )
        future = datetime.now(UTC) + timedelta(days=14)
        past = datetime.now(UTC) - timedelta(days=14)
        with Session(engine) as session:
            home = ScheduleTeam(
                name="Probe Location Home",
                age_group="U14",
                tier="ECNL",
                conference="Probe Location East",
                city="Probeville",
                state="FL",
                gender="boys",
            )
            away = ScheduleTeam(
                name="Probe Location Away",
                age_group="U14",
                tier="ECNL",
                conference="Probe Location East",
                city="Probeville",
                state="FL",
                gender="boys",
            )
            session.add_all((home, away))
            session.flush()

            def add_game(venue: str, starts: datetime, status: str, lat: float) -> None:
                session.add(
                    ScheduleGame(
                        home_team_id=home.id,
                        away_team_id=away.id,
                        starts_at=starts,
                        venue_name=venue,
                        city="Probeville",
                        state="FL",
                        timezone="America/New_York",
                        status=status,
                        home_score=1 if status == "COMPLETED" else None,
                        away_score=0 if status == "COMPLETED" else None,
                        venue_lat=lat,
                        venue_lng=-81.66,
                        field_surface="natural grass",
                    )
                )

            add_game("Davis Park - Field 1", future, "SCHEDULED", 30.33)
            add_game("Davis Park - Field 2", past, "COMPLETED", 30.33)
            add_game("Other Park", future, "SCHEDULED", 30.2)
            session.commit()

        with TestClient(app) as client:
            listed = client.get("/locations", params={"search": "Field 2", "state": "FL"})
            self.assertEqual(listed.status_code, 200, listed.text)
            matches = [row for row in listed.json() if row["city"] == "Probeville"]
            self.assertEqual([row["venue_name"] for row in matches], ["Davis Park"])
            card = matches[0]
            self.assertEqual(card["total_games"], 2)
            self.assertEqual(card["upcoming_games"], 1)
            self.assertIsNone(card["drive_minutes"])

            timed = client.get(
                "/locations",
                params={"search": "Davis Park", "state": "FL", "home_lat": 30.4, "home_lng": -81.6},
            )
            timed_card = next(row for row in timed.json() if row["city"] == "Probeville" and row["venue_name"] == "Davis Park")
            self.assertGreater(timed_card["drive_minutes"], 0)

            detail = client.get(
                "/locations/detail",
                params={"venue_name": "Davis Park - Field 1", "city": "Probeville", "state": "FL"},
            )
            self.assertEqual(detail.status_code, 200, detail.text)
            body = detail.json()
            self.assertEqual(body["venue_key"], card["venue_key"])
            self.assertEqual(body["venue_name"], "Davis Park")
            self.assertEqual(body["total_games"], 2)
            played = body["upcoming"] + body["recent"]
            self.assertEqual(len(played), 2)
            self.assertIn("directions", body["links"])
            self.assertIn("hotels", body["links"])
            self.assertIn("restaurants", body["links"])
            by_key = client.get("/locations/detail", params={"venue_key": card["venue_key"]})
            self.assertEqual(by_key.status_code, 200)
            self.assertEqual(by_key.json()["total_games"], 2)

    def test_tip_is_created_and_upvoted_without_a_user(self) -> None:
        with TestClient(app) as client:
            created = client.post(
                "/locations/recommendations",
                json={
                    "venue_name": "Davis Park - Field 2",
                    "city": "Probeville",
                    "state": "FL",
                    "category": "HOTEL",
                    "title": "Hampton Inn",
                    "rating": 4,
                    "review_text": "Free breakfast and a short drive.",
                    "tags": ["Free Breakfast", "Within 10 minutes of Fields"],
                },
                headers={"X-Profile-Key": "probe-location-tip"},
            )
            self.assertEqual(created.status_code, 200, created.text)
            tip = created.json()
            self.assertEqual(tip["author_name"], "ECNL Family")
            self.assertEqual(tip["venue_key"], make_venue_key("Davis Park - Field 1", "Probeville", "FL"))
            voted = client.post(f"/locations/recommendations/{tip['id']}/upvote")
            self.assertEqual(voted.status_code, 200, voted.text)
            self.assertEqual(voted.json()["upvotes"], 1)
            with Session(engine) as session:
                row = session.get(VenueRecommendation, tip["id"])
            self.assertIsNotNone(row)
            assert row is not None
            self.assertIsNone(row.user_id)
            self.assertEqual(row.upvotes, 1)


if __name__ == "__main__":
    unittest.main()
