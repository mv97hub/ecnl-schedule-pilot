"""Admins can hide and restore contributions. Rewrites are closed. Public reads omit hidden rows and flags."""

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
from app.models import AppUser, Base, ContentFlag, LocationWriteEvent, VenueRating, VenueRecommendation

SECRET = "probe-review-secret"
VENUE = "Probe Review Park"
CITY = "Probereview"
WRITER = "writer@probe-review.test"
PAGES = "pages@probe-review.test"


def _sign_in(
    client: TestClient, subject: str, email: str, name: str, *, accept_terms: bool = True, provider: str = "google"
) -> tuple[dict[str, str], int]:
    os.environ["AUTH_INTERNAL_SECRET"] = SECRET
    opened = client.post(
        "/auth/session",
        headers={"X-Internal-Auth": SECRET},
        json={
            "provider": provider,
            "subject": subject,
            "email": email,
            "email_verified": True,
            "display_name": name,
            "client": "web",
        },
    )
    assert opened.status_code == 200, opened.text
    body = opened.json()
    headers = {"Authorization": f"Bearer {body['token']}"}
    if accept_terms:
        accepted = client.post("/auth/terms", json={"version": "ugc-1"}, headers=headers)
        assert accepted.status_code == 200, accepted.text
    return headers, int(body["user"]["id"])


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
            if connection.execute(text("SELECT to_regclass('public.content_flag')")).scalar() is not None:
                connection.execute(
                    text(
                        """
                        DELETE FROM content_flag
                        WHERE user_id IN (SELECT id FROM app_user WHERE email LIKE '%@probe-review.test')
                           OR target_id IN (
                                SELECT id FROM venue_recommendation
                                WHERE city = :city OR venue_name LIKE 'Probe Review%'
                           )
                        """
                    ),
                    {"city": CITY},
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
            self.assertEqual(edited.status_code, 405, edited.text)
            tip_edit = client.post(
                f"/admin/contributions/tip/{tip_id}/edit",
                json={"comment": "Meet at the side gate.", "rating": 1},
                headers=admin,
            )
            self.assertEqual(tip_edit.status_code, 405, tip_edit.text)

            with Session(engine) as session:
                stored_rating = session.get(VenueRating, rating_id)
                stored_tip = session.get(VenueRecommendation, tip_id)
                self.assertIsNotNone(stored_rating)
                self.assertIsNotNone(stored_tip)
                assert stored_rating is not None and stored_tip is not None
                self.assertEqual(stored_rating.field_quality, 4)
                self.assertEqual(stored_rating.referees, 3)
                self.assertEqual(stored_rating.comment, "Original family note")
                self.assertIsNone(stored_rating.edited_at)
                self.assertEqual(stored_tip.rating, 5)
                self.assertEqual(stored_tip.review_text, "Across from the original gate.")
                self.assertIsNone(stored_tip.edited_at)

            public = client.get("/locations/detail", params={"venue_name": VENUE, "city": CITY, "state": "FL"}, headers=writer)
            self.assertEqual(public.status_code, 200, public.text)
            body = public.json()
            self.assertEqual(body["my_rating"]["comment"], "Original family note")
            self.assertFalse(body["my_rating"]["edited"])
            self.assertEqual(body["my_rating"]["field_quality"], 4)
            self.assertNotIn("Rewritten family note", public.text)
            shown = next(item for item in body["recommendations"] if item["id"] == tip_id)
            self.assertEqual(shown["review_text"], "Across from the original gate.")
            self.assertFalse(shown["edited"])
            self.assertEqual(shown["rating"], 5)
            self.assertNotIn("Meet at the side gate.", public.text)
            self.assertNotIn("flagged_at", public.text)
            self.assertNotIn("flagged", body["my_rating"])
            self.assertNotIn("flagged", shown)

            rating_history = client.get("/admin/history", params={"venue": VENUE, "kind": "rating"}, headers=admin)
            self.assertEqual(rating_history.status_code, 200, rating_history.text)
            rating_rows = rating_history.json()
            created = next(row for row in rating_rows if row["action"] == "create")
            self.assertEqual(created["new"]["comment"], "Original family note")
            self.assertEqual(created["user_id"], writer_id)
            self.assertFalse(any(row["action"] == "edit" for row in rating_rows))
            tip_history = client.get("/admin/history", params={"venue": VENUE, "kind": "tip"}, headers=admin).json()
            tip_created = next(row for row in tip_history if row["action"] == "create")
            self.assertEqual(tip_created["new"]["review_text"], "Across from the original gate.")
            self.assertFalse(any(row["action"] == "edit" for row in tip_history))

            hidden_tip = client.post(f"/admin/contributions/tip/{tip_id}/hide", headers=admin)
            self.assertEqual(hidden_tip.status_code, 200, hidden_tip.text)
            self.assertEqual(hidden_tip.json()["status"], "hidden")
            after_hide = client.get("/locations/detail", params={"venue_name": VENUE, "city": CITY, "state": "FL"}, headers=writer)
            self.assertEqual(after_hide.status_code, 200, after_hide.text)
            self.assertNotIn(tip_id, [item["id"] for item in after_hide.json()["recommendations"]])
            self.assertNotIn("Across from the original gate.", after_hide.text)
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
            self.assertNotIn("Original family note", hidden_public.text)
            self.assertEqual(hidden_public.json()["overall"], None)
            client.post(f"/admin/contributions/rating/{rating_id}/restore", headers=admin)
            visible_again = client.get(
                "/locations/detail", params={"venue_name": VENUE, "city": CITY, "state": "FL"}, headers=writer
            )
            self.assertEqual(visible_again.json()["ratings_count"], 1)
            self.assertEqual(visible_again.json()["my_rating"]["comment"], "Original family note")

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

    def test_terms_one_report_and_two_reports_hide_until_accepted(self) -> None:
        with TestClient(app) as client:
            writer, writer_id = _sign_in(client, "probe-review-terms", WRITER, "Review Family", accept_terms=False)
            refused = client.post("/locations/rate", json=_rating("Blocked note"), headers=writer)
            self.assertEqual(refused.status_code, 403, refused.text)
            refused_tip = client.post(
                "/locations/recommendations",
                json={
                    "venue_name": VENUE,
                    "city": CITY,
                    "state": "FL",
                    "category": "HOTEL",
                    "title": "Blocked Inn",
                    "rating": 4,
                    "review_text": "Not yet.",
                },
                headers=writer,
            )
            self.assertEqual(refused_tip.status_code, 403, refused_tip.text)
            posted = _sign_in(client, "probe-review-terms-host", "host@probe-review.test", "Host Family")
            host_headers, _host_id = posted
            host_tip = client.post(
                "/locations/recommendations",
                json={
                    "venue_name": VENUE,
                    "city": CITY,
                    "state": "FL",
                    "category": "HOTEL",
                    "title": "Host Inn",
                    "rating": 4,
                    "review_text": "Host wrote this.",
                },
                headers=host_headers,
            )
            self.assertEqual(host_tip.status_code, 200, host_tip.text)
            refused_vote = client.post(
                f"/locations/recommendations/{host_tip.json()['id']}/vote",
                json={"choice": "up"},
                headers=writer,
            )
            self.assertEqual(refused_vote.status_code, 403, refused_vote.text)
            account = client.get("/auth/me", headers=writer)
            self.assertEqual(account.status_code, 200, account.text)
            self.assertFalse(account.json()["terms_accepted"])
            self.assertEqual(client.post("/auth/terms", json={"version": "older"}, headers=writer).status_code, 400)

            accepted = client.post("/auth/terms", json={"version": "ugc-1"}, headers=writer)
            self.assertEqual(accepted.status_code, 200, accepted.text)
            self.assertTrue(accepted.json()["terms_accepted"])
            with Session(engine) as session:
                stored_user = session.get(AppUser, writer_id)
                assert stored_user is not None and stored_user.terms_accepted_at is not None
                first_stamp = stored_user.terms_accepted_at
            repeat = client.post("/auth/terms", json={"version": "ugc-1"}, headers=writer)
            self.assertEqual(repeat.status_code, 200, repeat.text)
            with Session(engine) as session:
                stored_user = session.get(AppUser, writer_id)
                assert stored_user is not None and stored_user.terms_accepted_at is not None
                second_stamp = stored_user.terms_accepted_at
            if first_stamp.tzinfo is None:
                first_stamp = first_stamp.replace(tzinfo=UTC)
            if second_stamp.tzinfo is None:
                second_stamp = second_stamp.replace(tzinfo=UTC)
            self.assertEqual(second_stamp, first_stamp)

            rated = client.post("/locations/rate", json=_rating("Original family note"), headers=writer)
            self.assertEqual(rated.status_code, 200, rated.text)
            updated = client.post("/locations/rate", json=_rating("Original family note"), headers=writer)
            self.assertEqual(updated.status_code, 200, updated.text)
            tip = client.post(
                "/locations/recommendations",
                json={
                    "venue_name": VENUE,
                    "city": CITY,
                    "state": "FL",
                    "category": "RESTAURANT",
                    "title": "Probe Review Grill",
                    "rating": 5,
                    "review_text": "Across from the original gate.",
                },
                headers=writer,
            )
            self.assertEqual(tip.status_code, 200, tip.text)
            tip_id = tip.json()["id"]
            voted = client.post(f"/locations/recommendations/{tip_id}/vote", json={"choice": "up"}, headers=writer)
            self.assertEqual(voted.status_code, 200, voted.text)

            own = client.post(f"/locations/recommendations/{tip_id}/flag", headers=writer)
            self.assertEqual(own.status_code, 403, own.text)
            missing = client.post("/locations/recommendations/999999999/flag", headers=writer)
            self.assertEqual(missing.status_code, 404, missing.text)
            with Session(engine) as session:
                self.assertEqual(
                    session.scalar(select(ContentFlag).where(ContentFlag.target_id == tip_id)),
                    None,
                )

            reporter, reporter_id = _sign_in(client, "probe-review-reporter", "reporter@probe-review.test", "Reporter")
            apple, apple_id = _sign_in(
                client,
                "probe-review-reporter-apple",
                "reporter@probe-review.test",
                "Reporter",
                provider="apple",
            )
            self.assertEqual(reporter_id, apple_id)
            first = client.post(f"/locations/recommendations/{tip_id}/flag", headers=reporter)
            self.assertEqual(first.status_code, 200, first.text)
            self.assertFalse(first.json()["already_reported"])
            self.assertNotIn("reporter@probe-review.test", first.text)
            duplicate = client.post(f"/locations/recommendations/{tip_id}/flag", headers=apple)
            self.assertEqual(duplicate.status_code, 200, duplicate.text)
            self.assertTrue(duplicate.json()["already_reported"])
            self.assertEqual(duplicate.json()["message"], "You already reported this tip.")
            with Session(engine) as session:
                stored = list(session.scalars(select(ContentFlag).where(ContentFlag.target_id == tip_id)).all())
                self.assertEqual(len(stored), 1)
                tip_row = session.get(VenueRecommendation, tip_id)
                assert tip_row is not None
                self.assertIsNotNone(tip_row.flagged_at)
                self.assertIsNone(tip_row.hidden_at)

            visible = client.get("/locations/detail", params={"venue_name": VENUE, "city": CITY, "state": "FL"})
            self.assertIn(tip_id, [item["id"] for item in visible.json()["recommendations"]])
            self.assertNotIn("flagged_at", visible.text)
            self.assertNotIn("auto_hidden", visible.text)
            self.assertNotIn("reporter", visible.text)
            self.assertNotIn("terms_accepted", visible.text)
            shown = next(item for item in visible.json()["recommendations"] if item["id"] == tip_id)
            self.assertNotIn("flagged", shown)

            other, _other_id = _sign_in(client, "probe-review-other", "other@probe-review.test", "Other Family")
            second = client.post(f"/locations/recommendations/{tip_id}/flag", headers=other)
            self.assertEqual(second.status_code, 200, second.text)
            self.assertTrue(second.json()["hidden"])
            hidden_public = client.get("/locations/detail", params={"venue_name": VENUE, "city": CITY, "state": "FL"}, headers=writer)
            self.assertNotIn(tip_id, [item["id"] for item in hidden_public.json()["recommendations"]])
            self.assertNotIn("flagged_at", hidden_public.text)
            self.assertNotIn("auto_hidden_at", hidden_public.text)
            self.assertNotIn("reporter@probe-review.test", hidden_public.text)
            self.assertNotIn("other@probe-review.test", hidden_public.text)

            admin, admin_id = _sign_in(client, "probe-review-flag-admin", "myuranv97@gmail.com", "Admin")
            stranger, _stranger_id = _sign_in(client, "probe-review-flag-stranger", "stranger-flag@probe-review.test", "Stranger")
            self.assertEqual(client.get("/admin/flags", params={"state": "hidden"}, headers=stranger).status_code, 403)
            self.assertEqual(client.get("/admin/flags", headers=admin).status_code, 400)
            listed = client.get("/admin/contributions", params={"email": WRITER, "kind": "tip"}, headers=admin)
            current = next(row for row in listed.json()["rows"] if row["id"] == tip_id)
            self.assertEqual(current["status"], "auto_flagged")
            self.assertEqual(current["comment"], "Across from the original gate.")
            blocked = client.post(f"/admin/contributions/tip/{tip_id}/restore", headers=admin)
            self.assertEqual(blocked.status_code, 409, blocked.text)
            closed = client.post(
                f"/locations/recommendations/{tip_id}/flag",
                headers=_sign_in(client, "probe-review-late", "late@probe-review.test", "Late Family")[0],
            )
            self.assertEqual(closed.status_code, 409, closed.text)

            hidden_flags = client.get("/admin/flags", params={"state": "hidden"}, headers=admin)
            self.assertEqual(hidden_flags.status_code, 200, hidden_flags.text)
            hidden_row = next(row for row in hidden_flags.json()["rows"] if row["id"] == tip_id)
            self.assertEqual(hidden_row["comment"], "Across from the original gate.")
            self.assertEqual(hidden_row["author_name"], "Review Family")
            self.assertEqual(hidden_row["author_email"], WRITER)
            self.assertEqual(hidden_row["status"], "auto_flagged")
            self.assertCountEqual(hidden_row["reporter_emails"], ["reporter@probe-review.test", "other@probe-review.test"])
            self.assertIsNotNone(hidden_row["auto_hidden_at"])

            removed = client.delete("/auth/account", headers=other)
            self.assertEqual(removed.status_code, 200, removed.text)
            still_hidden = client.get("/locations/detail", params={"venue_name": VENUE, "city": CITY, "state": "FL"})
            self.assertNotIn(tip_id, [item["id"] for item in still_hidden.json()["recommendations"]])
            with Session(engine) as session:
                tip_row = session.get(VenueRecommendation, tip_id)
                assert tip_row is not None
                self.assertIsNotNone(tip_row.hidden_at)
                self.assertIsNotNone(tip_row.auto_hidden_at)

            accepted_tip = client.post(f"/admin/contributions/tip/{tip_id}/accept", headers=admin)
            self.assertEqual(accepted_tip.status_code, 200, accepted_tip.text)
            self.assertEqual(accepted_tip.json()["status"], "reenabled")
            self.assertEqual(accepted_tip.json()["comment"], "Across from the original gate.")
            shown_again = client.get("/locations/detail", params={"venue_name": VENUE, "city": CITY, "state": "FL"}, headers=writer)
            self.assertIn(tip_id, [item["id"] for item in shown_again.json()["recommendations"]])
            self.assertNotIn("flagged", next(item for item in shown_again.json()["recommendations"] if item["id"] == tip_id))
            reenabled = client.get("/admin/flags", params={"state": "reenabled"}, headers=admin)
            self.assertIn(tip_id, [row["id"] for row in reenabled.json()["rows"]])
            quiet = client.get("/admin/flags", params={"state": "hidden"}, headers=admin)
            self.assertNotIn(tip_id, [row["id"] for row in quiet.json()["rows"]])

            later_headers, _later_id = _sign_in(client, "probe-review-after", "after@probe-review.test", "After Family")
            later = client.post(f"/locations/recommendations/{tip_id}/flag", headers=later_headers)
            self.assertEqual(later.status_code, 200, later.text)
            self.assertFalse(later.json()["hidden"])
            after_public = client.get("/locations/detail", params={"venue_name": VENUE, "city": CITY, "state": "FL"})
            self.assertIn(tip_id, [item["id"] for item in after_public.json()["recommendations"]])
            with Session(engine) as session:
                tip_row = session.get(VenueRecommendation, tip_id)
                assert tip_row is not None
                self.assertIsNone(tip_row.hidden_at)
                self.assertIsNotNone(tip_row.accepted_at)
                self.assertEqual(tip_row.review_text, "Across from the original gate.")
                kept = client.get(f"/admin/contributions/tip/{tip_id}/history", headers=admin).json()
            self.assertIn("auto_hide", [row["action"] for row in kept])
            self.assertIn("accept", [row["action"] for row in kept])
            auto_row = next(row for row in kept if row["action"] == "auto_hide")
            self.assertEqual(auto_row["previous"]["review_text"], "Across from the original gate.")
            self.assertEqual(auto_row["new"]["review_text"], "Across from the original gate.")

            with Session(engine) as session:
                rating = session.scalar(select(VenueRating).where(VenueRating.user_id == str(writer_id)))
                assert rating is not None
                session.add(
                    LocationWriteEvent(
                        created_at=datetime.now(UTC),
                        user_id=admin_id,
                        email="myuranv97@gmail.com",
                        display_name="Admin",
                        kind="rating",
                        venue_key=rating.venue_key,
                        venue_name=rating.venue_name,
                        rating_id=rating.id,
                        tip_id=None,
                        action="edit",
                        previous_values={"comment": "Original family note"},
                        new_values={"comment": "Rewritten family note"},
                    )
                )
                session.commit()
                rating_id = rating.id
            history = client.get(f"/admin/contributions/rating/{rating_id}/history", headers=admin)
            self.assertEqual(history.status_code, 200, history.text)
            original = next(row for row in history.json() if row["action"] == "create")
            legacy = next(row for row in history.json() if row["action"] == "edit")
            self.assertEqual(original["new"]["comment"], "Original family note")
            self.assertEqual(legacy["previous"]["comment"], "Original family note")
            unchanged = client.post(
                f"/admin/contributions/rating/{rating_id}/edit",
                json={"comment": "Another rewrite"},
                headers=admin,
            )
            self.assertEqual(unchanged.status_code, 405, unchanged.text)
            with Session(engine) as session:
                rating = session.get(VenueRating, rating_id)
                assert rating is not None
                self.assertEqual(rating.comment, "Original family note")
                self.assertIsNone(rating.edited_at)

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
