"""Admins can hide, restore, and edit contributions. Public reads omit hidden rows and the flag."""

from __future__ import annotations

import os
import sys
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session
from sqlmodel import SQLModel

from app.database import engine
from app.locations import make_venue_key
from app.main import app
from app.models import Base, VenueRating, VenueRecommendation

SECRET = "probe-review-secret"
VENUE = "Probe Review Park"
CITY = "Probereview"
WRITER = "writer@probe-review.test"
PAGES = "pages@probe-review.test"


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
        "city": CITY,
        "state": "FL",
        "field_quality": field_quality,
        "referees": 3,
        "parent_vibe": 5,
        "parking_access": 2,
        "amenities": 4,
        "surface_vote": "GRASS",
        "comment": comment,
    }


class ContributionReviewTests(unittest.TestCase):
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
                        WHERE venue_name LIKE 'Probe Review%'
                           OR email LIKE '%@probe-review.test'
                        """
                    )
                )
            if connection.execute(text("SELECT to_regclass('public.venue_tip_vote')")).scalar() is not None:
                connection.execute(
                    text(
                        """
                        DELETE FROM venue_tip_vote
                        WHERE recommendation_id IN (
                            SELECT id FROM venue_recommendation
                            WHERE city = :city OR venue_name LIKE 'Probe Review%'
                        )
                        """
                    ),
                    {"city": CITY},
                )
            if connection.execute(text("SELECT to_regclass('public.venue_recommendation')")).scalar() is not None:
                connection.execute(
                    text("DELETE FROM venue_recommendation WHERE city = :city OR venue_name LIKE 'Probe Review%'"),
                    {"city": CITY},
                )
            if connection.execute(text("SELECT to_regclass('public.venue_rating')")).scalar() is not None:
                connection.execute(
                    text("DELETE FROM venue_rating WHERE city = :city OR venue_name LIKE 'Probe Review%'"),
                    {"city": CITY},
                )
            if connection.execute(text("SELECT to_regclass('public.auth_identity')")).scalar() is not None:
                connection.execute(
                    text(
                        """
                        DELETE FROM app_user
                        WHERE id IN (
                            SELECT user_id FROM auth_identity WHERE provider_subject LIKE 'probe-review-%'
                        )
                        """
                    )
                )

    def test_hide_restore_edit_history_and_public_payload(self) -> None:
        with TestClient(app) as client:
            writer, writer_id = _sign_in(client, "probe-review-writer", WRITER, "Review Family")
            rated = client.post("/locations/rate", json=_rating("Original family note"), headers=writer)
            self.assertEqual(rated.status_code, 200, rated.text)
            tip = client.post(
                "/locations/recommendations",
                json={
                    "venue_name": VENUE,
                    "city": CITY,
                    "state": "FL",
                    "category": "HOTEL",
                    "title": "Probe Review Inn",
                    "rating": 5,
                    "review_text": "Across from the original gate.",
                },
                headers=writer,
            )
            self.assertEqual(tip.status_code, 200, tip.text)
            tip_id = tip.json()["id"]
            voted = client.post(f"/locations/recommendations/{tip_id}/vote", json={"choice": "up"}, headers=writer)
            self.assertEqual(voted.status_code, 200, voted.text)
            self.assertEqual(voted.json()["upvotes"], 1)

            locked = client.get("/admin/contributions")
            self.assertEqual(locked.status_code, 401)
            stranger, _stranger_id = _sign_in(client, "probe-review-stranger", "stranger@probe-review.test", "Stranger")
            self.assertEqual(client.get("/admin/contributions", headers=stranger).status_code, 403)
            admin, _admin_id = _sign_in(client, "probe-review-admin", "myuranv97@gmail.com", "Admin")
            listed = client.get("/admin/contributions", params={"email": WRITER, "kind": "rating"}, headers=admin)
            self.assertEqual(listed.status_code, 200, listed.text)
            rating_id = listed.json()["rows"][0]["id"]
            votes = client.get("/admin/contributions", params={"email": WRITER, "kind": "vote"}, headers=admin)
            vote_id = votes.json()["rows"][0]["id"]
            self.assertEqual(client.post(f"/admin/contributions/rating/{rating_id}/hide", headers=stranger).status_code, 403)

            edited = client.post(
                f"/admin/contributions/rating/{rating_id}/edit",
                json={"comment": "Rewritten family note", "field_quality": 1},
                headers=admin,
            )
            self.assertEqual(edited.status_code, 200, edited.text)
            self.assertEqual(edited.json()["comment"], "Rewritten family note")
            self.assertEqual(edited.json()["score"], "3.60")
            tip_edit = client.post(
                f"/admin/contributions/tip/{tip_id}/edit",
                json={"comment": "Meet at the side gate.", "rating": 1},
                headers=admin,
            )
            self.assertEqual(tip_edit.status_code, 200, tip_edit.text)
            self.assertEqual(tip_edit.json()["score"], "5")

            with Session(engine) as session:
                stored_rating = session.get(VenueRating, rating_id)
                stored_tip = session.get(VenueRecommendation, tip_id)
                self.assertIsNotNone(stored_rating)
                self.assertIsNotNone(stored_tip)
                assert stored_rating is not None and stored_tip is not None
                self.assertEqual(stored_rating.field_quality, 4)
                self.assertEqual(stored_rating.referees, 3)
                self.assertEqual(stored_rating.comment, "Rewritten family note")
                self.assertEqual(stored_tip.rating, 5)
                self.assertEqual(stored_tip.review_text, "Meet at the side gate.")

            public = client.get("/locations/detail", params={"venue_name": VENUE, "city": CITY, "state": "FL"}, headers=writer)
            self.assertEqual(public.status_code, 200, public.text)
            body = public.json()
            self.assertEqual(body["my_rating"]["comment"], "Rewritten family note")
            self.assertTrue(body["my_rating"]["edited"])
            self.assertEqual(body["my_rating"]["field_quality"], 4)
            self.assertNotIn("Original family note", public.text)
            shown = next(item for item in body["recommendations"] if item["id"] == tip_id)
            self.assertEqual(shown["review_text"], "Meet at the side gate.")
            self.assertTrue(shown["edited"])
            self.assertEqual(shown["rating"], 5)
            self.assertNotIn("Across from the original gate.", public.text)
            self.assertNotIn("flagged_at", public.text)
            self.assertNotIn("flagged", body["my_rating"])
            self.assertNotIn("flagged", shown)

            rating_history = client.get("/admin/history", params={"venue": VENUE, "kind": "rating"}, headers=admin)
            self.assertEqual(rating_history.status_code, 200, rating_history.text)
            rating_rows = rating_history.json()
            created = next(row for row in rating_rows if row["action"] == "create")
            edited_row = next(row for row in rating_rows if row["action"] == "edit")
            self.assertEqual(created["new"]["comment"], "Original family note")
            self.assertEqual(created["user_id"], writer_id)
            self.assertEqual(edited_row["previous"]["comment"], "Original family note")
            self.assertEqual(edited_row["new"]["comment"], "Rewritten family note")
            self.assertNotIn("field_quality", edited_row["new"])
            tip_history = client.get("/admin/history", params={"venue": VENUE, "kind": "tip"}, headers=admin).json()
            tip_created = next(row for row in tip_history if row["action"] == "create")
            tip_edited = next(row for row in tip_history if row["action"] == "edit")
            self.assertEqual(tip_created["new"]["review_text"], "Across from the original gate.")
            self.assertEqual(tip_edited["previous"]["review_text"], "Across from the original gate.")
            self.assertEqual(tip_edited["new"]["review_text"], "Meet at the side gate.")
            self.assertNotIn("stars", tip_edited["new"])

            hidden_tip = client.post(f"/admin/contributions/tip/{tip_id}/hide", headers=admin)
            self.assertEqual(hidden_tip.status_code, 200, hidden_tip.text)
            self.assertEqual(hidden_tip.json()["status"], "hidden")
            after_hide = client.get("/locations/detail", params={"venue_name": VENUE, "city": CITY, "state": "FL"}, headers=writer)
            self.assertEqual(after_hide.status_code, 200, after_hide.text)
            self.assertNotIn(tip_id, [item["id"] for item in after_hide.json()["recommendations"]])
            self.assertNotIn("Meet at the side gate.", after_hide.text)
            kept_history = client.get("/admin/history", params={"venue": VENUE, "kind": "tip"}, headers=admin).json()
            self.assertEqual(sum(1 for row in kept_history if row["action"] == "create"), 1)
            self.assertEqual(next(row for row in kept_history if row["action"] == "create")["new"]["review_text"], "Across from the original gate.")

            restored_tip = client.post(f"/admin/contributions/tip/{tip_id}/restore", headers=admin)
            self.assertEqual(restored_tip.status_code, 200, restored_tip.text)
            self.assertEqual(restored_tip.json()["status"], "visible")
            restored_public = client.get(
                "/locations/detail", params={"venue_name": VENUE, "city": CITY, "state": "FL"}, headers=writer
            )
            self.assertIn(tip_id, [item["id"] for item in restored_public.json()["recommendations"]])

            hidden_rating = client.post(f"/admin/contributions/rating/{rating_id}/hide", headers=admin)
            self.assertEqual(hidden_rating.json()["status"], "hidden")
            hidden_public = client.get(
                "/locations/detail", params={"venue_name": VENUE, "city": CITY, "state": "FL"}, headers=writer
            )
            self.assertEqual(hidden_public.json()["ratings_count"], 0)
            self.assertIsNone(hidden_public.json()["my_rating"])
            self.assertNotIn("Rewritten family note", hidden_public.text)
            self.assertEqual(hidden_public.json()["overall"], None)
            client.post(f"/admin/contributions/rating/{rating_id}/restore", headers=admin)
            visible_again = client.get(
                "/locations/detail", params={"venue_name": VENUE, "city": CITY, "state": "FL"}, headers=writer
            )
            self.assertEqual(visible_again.json()["ratings_count"], 1)
            self.assertEqual(visible_again.json()["my_rating"]["comment"], "Rewritten family note")

            hidden_vote = client.post(f"/admin/contributions/vote/{vote_id}/hide", headers=admin)
            self.assertEqual(hidden_vote.status_code, 200, hidden_vote.text)
            self.assertEqual(hidden_vote.json()["score"], "up")
            without_vote = client.get(
                "/locations/detail", params={"venue_name": VENUE, "city": CITY, "state": "FL"}, headers=writer
            )
            tip_after = next(item for item in without_vote.json()["recommendations"] if item["id"] == tip_id)
            self.assertEqual(tip_after["upvotes"], 0)
            client.post(f"/admin/contributions/vote/{vote_id}/restore", headers=admin)
            with_vote = client.get(
                "/locations/detail", params={"venue_name": VENUE, "city": CITY, "state": "FL"}, headers=writer
            )
            tip_back = next(item for item in with_vote.json()["recommendations"] if item["id"] == tip_id)
            self.assertEqual(tip_back["upvotes"], 1)
            self.assertEqual(tip_back["my_vote"], "up")

            self.assertEqual(client.get("/auth/me", headers=writer).status_code, 200)
            with Session(engine) as session:
                row = session.get(VenueRating, rating_id)
                self.assertIsNotNone(row)
                assert row is not None
                row.flagged_at = datetime.now(UTC)
                session.commit()
            flagged = client.get("/admin/contributions", params={"email": WRITER, "flagged": "flagged"}, headers=admin)
            self.assertEqual(flagged.status_code, 200, flagged.text)
            flagged_rows = flagged.json()["rows"]
            self.assertTrue(flagged_rows)
            self.assertTrue(all(row["flagged"] for row in flagged_rows))
            self.assertIn(rating_id, [row["id"] for row in flagged_rows if row["kind"] == "rating"])
            self.assertNotIn("flagged_at", with_vote.text)

    def test_second_page_does_not_repeat_the_first_and_flagged_filter(self) -> None:
        with TestClient(app) as client:
            _headers, user_id = _sign_in(client, "probe-review-pages", PAGES, "Page Family")
            admin, _admin_id = _sign_in(client, "probe-review-page-admin", "premiergamedayhq@gmail.com", "Page Admin")
            base = datetime(2026, 1, 1, tzinfo=UTC)
            with Session(engine) as session:
                for index in range(51):
                    session.add(
                        VenueRating(
                            venue_key=make_venue_key(f"Probe Review {index}", CITY, "FL"),
                            venue_name=f"Probe Review {index}",
                            city=CITY,
                            state="FL",
                            author_key=f"user:{user_id}",
                            user_id=str(user_id),
                            author_name="Page Family",
                            field_quality=3,
                            referees=3,
                            parent_vibe=3,
                            parking_access=3,
                            amenities=3,
                            comment=f"page-note-{index}",
                            updated_at=base + timedelta(minutes=index),
                        )
                    )
                session.commit()
                rows = list(session.scalars(select(VenueRating).where(VenueRating.user_id == str(user_id))).all())
                by_comment = {row.comment: row for row in rows}
                by_comment["page-note-0"].flagged_at = datetime.now(UTC)
                by_comment["page-note-50"].flagged_at = datetime.now(UTC)
                session.commit()

            first = client.get("/admin/contributions", params={"email": PAGES, "page": 1}, headers=admin)
            second = client.get("/admin/contributions", params={"email": PAGES, "page": 2}, headers=admin)
            self.assertEqual(first.status_code, 200, first.text)
            self.assertEqual(second.status_code, 200, second.text)
            first_body = first.json()
            second_body = second.json()
            self.assertEqual(first_body["total"], 51)
            self.assertEqual(second_body["total"], 51)
            self.assertEqual(first_body["page"], 1)
            self.assertEqual(second_body["page"], 2)
            self.assertEqual(len(first_body["rows"]), 50)
            self.assertEqual(len(second_body["rows"]), 1)
            first_ids = {(row["kind"], row["id"]) for row in first_body["rows"]}
            second_ids = {(row["kind"], row["id"]) for row in second_body["rows"]}
            self.assertTrue(first_ids.isdisjoint(second_ids))
            self.assertEqual(first_body["rows"][0]["comment"], "page-note-50")
            self.assertEqual(second_body["rows"][0]["comment"], "page-note-0")

            flagged = client.get("/admin/contributions", params={"email": PAGES, "flagged": "flagged"}, headers=admin)
            self.assertEqual(flagged.status_code, 200, flagged.text)
            flagged_body = flagged.json()
            self.assertEqual(flagged_body["total"], 2)
            self.assertEqual(len(flagged_body["rows"]), 2)
            self.assertTrue(all(row["flagged"] for row in flagged_body["rows"]))
            comments = {row["comment"] for row in flagged_body["rows"]}
            self.assertEqual(comments, {"page-note-0", "page-note-50"})
            plain = client.get("/admin/contributions", params={"email": PAGES, "flagged": "unflagged"}, headers=admin)
            self.assertEqual(plain.json()["total"], 49)
            self.assertNotIn("page-note-50", {row["comment"] for row in plain.json()["rows"]})
            self.assertTrue(all(row["flagged"] is False for row in plain.json()["rows"]))
