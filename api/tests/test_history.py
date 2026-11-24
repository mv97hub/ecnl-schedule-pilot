"""Location writes append a history row, and only the two admin accounts can read it."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session
from sqlmodel import SQLModel

from app.database import engine
from app.locations import make_venue_key
from app.main import app
from app.models import Base, LocationWriteEvent, VenueRating

SECRET = "probe-history-secret"
VENUE = "Probe History Park"


def _sign_in(client: TestClient, subject: str, email: str, name: str) -> tuple[dict[str, str], int]:
    os.environ["AUTH_INTERNAL_SECRET"] = SECRET
    opened = client.post(
        "/auth/session",
        headers={"X-Internal-Auth": SECRET},
        json={
            "provider": "google",
            "subject": subject,
            "email": email,
            "email_verified": True,
            "display_name": name,
            "client": "web",
        },
    )
    assert opened.status_code == 200, opened.text
    body = opened.json()
    return {"Authorization": f"Bearer {body['token']}"}, int(body["user"]["id"])


def _rating(comment: str, field_quality: int = 4) -> dict[str, object]:
    return {
        "venue_name": VENUE,
        "city": "Probehistory",
        "state": "FL",
        "field_quality": field_quality,
        "referees": 3,
        "parent_vibe": 5,
        "parking_access": 2,
        "amenities": 4,
        "surface_vote": "GRASS",
        "comment": comment,
    }


class HistoryTests(unittest.TestCase):
    def setUp(self) -> None:
        Base.metadata.create_all(engine)
        SQLModel.metadata.create_all(engine)
        os.environ["AUTH_INTERNAL_SECRET"] = SECRET
        self._cleanup()

    def tearDown(self) -> None:
        self._cleanup()

    def _cleanup(self) -> None:
        with engine.begin() as connection:
            if connection.execute(text("SELECT to_regclass('public.location_write_event')")).scalar() is not None:
                connection.execute(
                    text(
                        """
                        DELETE FROM location_write_event
                        WHERE venue_name = :venue
                           OR email LIKE '%@probe-history.test'
                        """
                    ),
                    {"venue": VENUE},
                )
            if connection.execute(text("SELECT to_regclass('public.venue_tip_vote')")).scalar() is not None:
                connection.execute(
                    text(
                        """
                        DELETE FROM venue_tip_vote
                        WHERE recommendation_id IN (
                            SELECT id FROM venue_recommendation WHERE venue_name = :venue
                        )
                        """
                    ),
                    {"venue": VENUE},
                )
            if connection.execute(text("SELECT to_regclass('public.venue_recommendation')")).scalar() is not None:
                connection.execute(text("DELETE FROM venue_recommendation WHERE venue_name = :venue"), {"venue": VENUE})
            if connection.execute(text("SELECT to_regclass('public.venue_rating')")).scalar() is not None:
                connection.execute(text("DELETE FROM venue_rating WHERE venue_name = :venue"), {"venue": VENUE})
            if connection.execute(text("SELECT to_regclass('public.auth_identity')")).scalar() is not None:
                connection.execute(
                    text(
                        """
                        DELETE FROM app_user
                        WHERE id IN (
                            SELECT user_id FROM auth_identity WHERE provider_subject LIKE 'probe-history-%'
                        )
                        """
                    )
                )

    def test_writes_append_history_and_admin_reads_newest_first(self) -> None:
        with TestClient(app) as client:
            headers, user_id = _sign_in(client, "probe-history-writer", "writer@probe-history.test", "History Family")
            first = client.post("/locations/rate", json=_rating("First note", 4), headers=headers)
            self.assertEqual(first.status_code, 200, first.text)
            second = client.post("/locations/rate", json=_rating("Updated note", 2), headers=headers)
            self.assertEqual(second.status_code, 200, second.text)
            self.assertEqual(second.json()["ratings_count"], 1)
            self.assertNotIn("history", second.json())
            self.assertNotIn("email", second.json())

            tip = client.post(
                "/locations/recommendations",
                json={
                    "venue_name": VENUE,
                    "city": "Probehistory",
                    "state": "FL",
                    "category": "HOTEL",
                    "title": "Probe History Inn",
                    "rating": 5,
                    "review_text": "Across the street.",
                    "tags": ["Close to Fields"],
                },
                headers=headers,
            )
            self.assertEqual(tip.status_code, 200, tip.text)
            tip_id = tip.json()["id"]
            self.assertNotIn("email", tip.json())

            voted = client.post(f"/locations/recommendations/{tip_id}/vote", json={"choice": "up"}, headers=headers)
            self.assertEqual(voted.status_code, 200, voted.text)
            again = client.post(f"/locations/recommendations/{tip_id}/vote", json={"choice": "up"}, headers=headers)
            self.assertEqual(again.status_code, 200, again.text)
            self.assertEqual(again.json()["upvotes"], 1)
            changed = client.post(f"/locations/recommendations/{tip_id}/vote", json={"choice": "down"}, headers=headers)
            self.assertEqual(changed.status_code, 200, changed.text)
            self.assertEqual(changed.json()["downvotes"], 1)
            self.assertEqual(changed.json()["upvotes"], 0)

            detail = client.get("/locations/detail", params={"venue_name": VENUE, "city": "Probehistory", "state": "FL"})
            self.assertEqual(detail.status_code, 200, detail.text)
            body = detail.json()
            self.assertNotIn("history", body)
            self.assertNotIn("email", body)
            self.assertNotIn("email", body.get("my_rating") or {})
            for recommendation in body["recommendations"]:
                self.assertNotIn("email", recommendation)

            with Session(engine) as session:
                rows = list(
                    session.scalars(
                        select(LocationWriteEvent)
                        .where(LocationWriteEvent.venue_name == VENUE)
                        .order_by(LocationWriteEvent.id)
                    ).all()
                )
                rating = session.scalar(select(VenueRating).where(VenueRating.venue_name == VENUE))
            self.assertEqual([row.kind for row in rows], ["rating", "rating", "tip", "vote", "vote", "vote"])
            self.assertEqual(rows[0].action, "create")
            self.assertIsNone(rows[0].previous_values)
            self.assertEqual(rows[0].new_values["comment"], "First note")
            self.assertEqual(rows[0].new_values["surface"], "GRASS")
            self.assertEqual(rows[1].action, "update")
            self.assertEqual(rows[1].previous_values["field_quality"], 4)
            self.assertEqual(rows[1].previous_values["comment"], "First note")
            self.assertEqual(rows[1].new_values["field_quality"], 2)
            self.assertEqual(rows[1].new_values["comment"], "Updated note")
            self.assertEqual(rows[1].rating_id, rating.id if rating is not None else None)
            self.assertEqual(rows[2].kind, "tip")
            self.assertEqual(rows[2].action, "create")
            self.assertEqual(rows[2].tip_id, tip_id)
            self.assertEqual(rows[2].new_values["category"], "HOTEL")
            self.assertEqual(rows[2].new_values["title"], "Probe History Inn")
            self.assertEqual(rows[2].new_values["stars"], 5)
            self.assertEqual(rows[2].new_values["review_text"], "Across the street.")
            self.assertIn("Close to Fields", rows[2].new_values["tags"])
            self.assertEqual([row.new_values["choice"] for row in rows if row.kind == "vote"], ["up", "up", "down"])
            self.assertEqual(rows[4].previous_values["choice"], "up")
            self.assertIsNone(rows[3].previous_values)
            self.assertTrue(all(row.user_id == user_id and row.email == "writer@probe-history.test" for row in rows))
            self.assertTrue(all(row.display_name == "History Family" for row in rows))
            self.assertEqual(rows[0].venue_key, make_venue_key(VENUE, "Probehistory", "FL"))

            locked = client.get("/admin/history")
            self.assertEqual(locked.status_code, 401)
            stranger, _stranger_id = _sign_in(client, "probe-history-stranger", "stranger@probe-history.test", "Stranger")
            denied = client.get("/admin/history", headers=stranger)
            self.assertEqual(denied.status_code, 403, denied.text)

            admin, _admin_id = _sign_in(client, "probe-history-admin", "myuranv97@gmail.com", "Admin")
            listed = client.get("/admin/history", params={"venue": "Probe History", "email": "writer@probe-history.test"}, headers=admin)
            self.assertEqual(listed.status_code, 200, listed.text)
            payload = listed.json()
            self.assertEqual([row["kind"] for row in payload], ["vote", "vote", "vote", "tip", "rating", "rating"])
            self.assertEqual(payload[0]["new"]["choice"], "down")
            self.assertEqual(payload[0]["previous"]["choice"], "up")
            self.assertEqual(payload[0]["email"], "writer@probe-history.test")
            self.assertEqual(payload[0]["user_id"], user_id)
            self.assertEqual(payload[0]["display_name"], "History Family")
            ratings_only = client.get("/admin/history", params={"kind": "rating", "venue": VENUE}, headers=admin)
            self.assertEqual([row["action"] for row in ratings_only.json()], ["update", "create"])
            bad_kind = client.get("/admin/history", params={"kind": "comment"}, headers=admin)
            self.assertEqual(bad_kind.status_code, 400)

            removed = client.delete("/auth/account", headers=headers)
            self.assertEqual(removed.status_code, 200, removed.text)
            with Session(engine) as session:
                kept = session.scalar(
                    select(func.count()).select_from(LocationWriteEvent).where(LocationWriteEvent.email == "writer@probe-history.test")
                )
                gone = session.scalar(select(func.count()).select_from(VenueRating).where(VenueRating.venue_name == VENUE))
            self.assertEqual(kept, 6)
            self.assertEqual(gone, 0)
            still = client.get("/admin/history", params={"email": "writer@probe-history.test"}, headers=admin)
            self.assertEqual(still.status_code, 200, still.text)
            self.assertEqual(still.json()[0]["email"], "writer@probe-history.test")
            self.assertEqual(still.json()[0]["user_id"], user_id)
