"""Admin terms list and revoke.

Revoke clears terms_accepted_at and terms_version. The same account must
agree to ugc-1 again before the next review or tip.
"""

from __future__ import annotations

import os
import sys
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session
from sqlmodel import SQLModel

from app.database import engine, ensure_account_columns
from app.main import app
from app.models import AppUser, Base

SECRET = "probe-terms-secret"
VENUE = "Probe Terms Park"
CITY = "Probeterms"
PAGE_DOMAIN = "probe-terms-page.test"


def _sign_in(client: TestClient, subject: str, email: str, name: str, *, accept_terms: bool = False) -> tuple[dict[str, str], int]:
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
    headers = {"Authorization": f"Bearer {body['token']}"}
    if accept_terms:
        accepted = client.post("/auth/terms", json={"version": "ugc-1"}, headers=headers)
        assert accepted.status_code == 200, accepted.text
    return headers, int(body["user"]["id"])


def _rating(comment: str) -> dict[str, object]:
    return {
        "venue_name": VENUE,
        "city": CITY,
        "state": "FL",
        "field_quality": 4,
        "referees": 3,
        "parent_vibe": 5,
        "parking_access": 2,
        "amenities": 4,
        "comment": comment,
    }


def _tip(title: str) -> dict[str, object]:
    return {
        "venue_name": VENUE,
        "city": CITY,
        "state": "FL",
        "category": "HOTEL",
        "title": title,
        "rating": 4,
        "review_text": "A place to stay.",
    }


class AdminTermsTests(unittest.TestCase):
    def setUp(self) -> None:
        Base.metadata.create_all(engine)
        SQLModel.metadata.create_all(engine)
        ensure_account_columns()
        os.environ["AUTH_INTERNAL_SECRET"] = SECRET
        self._cleanup()

    def tearDown(self) -> None:
        self._cleanup()

    def _cleanup(self) -> None:
        with engine.begin() as connection:
            if connection.execute(text("SELECT to_regclass('public.venue_tip_vote')")).scalar() is not None:
                connection.execute(
                    text(
                        """
                        DELETE FROM venue_tip_vote
                        WHERE recommendation_id IN (
                            SELECT id FROM venue_recommendation WHERE city = :city
                        )
                        """
                    ),
                    {"city": CITY},
                )
            if connection.execute(text("SELECT to_regclass('public.location_write_event')")).scalar() is not None:
                connection.execute(
                    text(
                        """
                        DELETE FROM location_write_event
                        WHERE venue_name = :venue
                           OR email LIKE '%@probe-terms.test'
                           OR email LIKE :page_email
                        """
                    ),
                    {"venue": VENUE, "page_email": f"%@{PAGE_DOMAIN}"},
                )
            if connection.execute(text("SELECT to_regclass('public.venue_recommendation')")).scalar() is not None:
                connection.execute(text("DELETE FROM venue_recommendation WHERE city = :city"), {"city": CITY})
            if connection.execute(text("SELECT to_regclass('public.venue_rating')")).scalar() is not None:
                connection.execute(text("DELETE FROM venue_rating WHERE city = :city"), {"city": CITY})
            if connection.execute(text("SELECT to_regclass('public.app_user')")).scalar() is not None:
                connection.execute(
                    text(
                        """
                        DELETE FROM app_user
                        WHERE email LIKE '%@probe-terms.test'
                           OR email LIKE :page_email
                           OR display_name LIKE 'Terms Page %'
                        """
                    ),
                    {"page_email": f"%@{PAGE_DOMAIN}"},
                )

    def test_revoke_clears_acceptance_until_the_account_agrees_again(self) -> None:
        with TestClient(app) as client:
            writer, writer_id = _sign_in(client, "probe-terms-writer", "writer@probe-terms.test", "Writer Family")
            stranger, _stranger_id = _sign_in(client, "probe-terms-stranger", "stranger@probe-terms.test", "Stranger Family")
            admin, _admin_id = _sign_in(client, "probe-terms-admin", "myuranv97@gmail.com", "Admin", accept_terms=True)
            other, other_id = _sign_in(client, "probe-terms-other", "premiergamedayhq@gmail.com", "Other Admin", accept_terms=True)

            self.assertEqual(client.get("/admin/terms").status_code, 401)
            self.assertEqual(client.get("/admin/terms", headers=stranger).status_code, 403)
            self.assertEqual(client.post(f"/admin/terms/{writer_id}/revoke", headers=stranger).status_code, 403)
            self.assertEqual(client.get("/admin/terms", params={"accepted": "later"}, headers=admin).status_code, 400)

            before = client.get("/admin/terms", params={"q": "writer@probe-terms.test"}, headers=admin)
            self.assertEqual(before.status_code, 200, before.text)
            self.assertEqual(before.json()["terms_version"], "ugc-1")
            self.assertEqual(before.json()["total"], 1)
            waiting = before.json()["rows"][0]
            self.assertEqual(
                set(waiting),
                {"id", "display_name", "email", "terms_accepted_at", "terms_version", "terms_accepted"},
            )
            self.assertEqual(waiting["id"], writer_id)
            self.assertFalse(waiting["terms_accepted"])
            self.assertIsNone(waiting["terms_accepted_at"])
            self.assertIsNone(waiting["terms_version"])
            self.assertNotIn("token", before.text)

            blocked = client.post("/locations/rate", json=_rating("Before agreement"), headers=writer)
            self.assertEqual(blocked.status_code, 403, blocked.text)
            accepted = client.post("/auth/terms", json={"version": "ugc-1"}, headers=writer)
            self.assertEqual(accepted.status_code, 200, accepted.text)
            self.assertTrue(accepted.json()["terms_accepted"])
            rated = client.post("/locations/rate", json=_rating("After agreement"), headers=writer)
            self.assertEqual(rated.status_code, 200, rated.text)
            tipped = client.post("/locations/recommendations", json=_tip("Agreed Inn"), headers=writer)
            self.assertEqual(tipped.status_code, 200, tipped.text)

            listed = client.get("/admin/terms", params={"q": "Writer Family", "accepted": "yes"}, headers=admin)
            self.assertEqual(listed.status_code, 200, listed.text)
            current = listed.json()["rows"][0]
            self.assertTrue(current["terms_accepted"])
            self.assertEqual(current["terms_version"], "ugc-1")
            self.assertIsNotNone(current["terms_accepted_at"])
            missing = client.get("/admin/terms", params={"q": "writer@probe-terms.test", "accepted": "no"}, headers=admin)
            self.assertEqual(missing.json()["rows"], [])

            revoked = client.post(f"/admin/terms/{writer_id}/revoke", headers=admin)
            self.assertEqual(revoked.status_code, 200, revoked.text)
            self.assertFalse(revoked.json()["terms_accepted"])
            self.assertIsNone(revoked.json()["terms_accepted_at"])
            self.assertIsNone(revoked.json()["terms_version"])
            with Session(engine) as session:
                stored = session.get(AppUser, writer_id)
                assert stored is not None
                self.assertIsNone(stored.terms_accepted_at)
                self.assertIsNone(stored.terms_version)
            account = client.get("/auth/me", headers=writer)
            self.assertFalse(account.json()["terms_accepted"])
            refused_rating = client.post("/locations/rate", json=_rating("After revoke"), headers=writer)
            self.assertEqual(refused_rating.status_code, 403, refused_rating.text)
            self.assertIn("Terms of Use", refused_rating.text)
            refused_tip = client.post("/locations/recommendations", json=_tip("Revoked Inn"), headers=writer)
            self.assertEqual(refused_tip.status_code, 403, refused_tip.text)

            again = client.post("/auth/terms", json={"version": "ugc-1"}, headers=writer)
            self.assertEqual(again.status_code, 200, again.text)
            self.assertTrue(again.json()["terms_accepted"])
            restored = client.post("/locations/rate", json=_rating("Agreed again"), headers=writer)
            self.assertEqual(restored.status_code, 200, restored.text)
            restored_tip = client.post("/locations/recommendations", json=_tip("Agreed Again Inn"), headers=writer)
            self.assertEqual(restored_tip.status_code, 200, restored_tip.text)

            kept = client.get("/admin/terms", params={"q": "premiergamedayhq@gmail.com"}, headers=other)
            self.assertEqual(kept.status_code, 200, kept.text)
            kept_row = next(row for row in kept.json()["rows"] if row["id"] == other_id)
            self.assertTrue(kept_row["terms_accepted"])
            cleared = client.post(f"/admin/terms/{writer_id}/revoke", headers=admin)
            self.assertEqual(cleared.status_code, 200, cleared.text)
            second = client.post(f"/admin/terms/{writer_id}/revoke", headers=admin)
            self.assertEqual(second.status_code, 200, second.text)
            self.assertIsNone(second.json()["terms_version"])
            self.assertEqual(client.post("/admin/terms/999999991/revoke", headers=admin).status_code, 404)

            with Session(engine) as session:
                stale = session.get(AppUser, writer_id)
                assert stale is not None
                stale.terms_accepted_at = datetime.now(UTC)
                stale.terms_version = "older"
                session.commit()
            older = client.get("/admin/terms", params={"q": "writer@probe-terms.test"}, headers=admin)
            self.assertEqual(older.status_code, 200, older.text)
            self.assertFalse(older.json()["rows"][0]["terms_accepted"])
            self.assertEqual(older.json()["rows"][0]["terms_version"], "older")
            client.post(f"/admin/terms/{writer_id}/revoke", headers=admin)
            after_older = client.get("/auth/me", headers=writer)
            self.assertFalse(after_older.json()["terms_accepted"])

    def test_terms_list_pages_newest_accounts_first(self) -> None:
        with TestClient(app) as client:
            admin, _admin_id = _sign_in(client, "probe-terms-page-admin", "myuranv97@gmail.com", "Page Admin")
            base = datetime(2025, 2, 1, tzinfo=UTC)
            with Session(engine) as session:
                for index in range(51):
                    session.add(
                        AppUser(
                            display_name=f"Terms Page {index:02d}",
                            email=f"user-{index:02d}@{PAGE_DOMAIN}",
                            created_at=base + timedelta(minutes=index),
                            terms_accepted_at=base if index % 2 == 0 else None,
                            terms_version="ugc-1" if index % 2 == 0 else None,
                        )
                    )
                session.commit()

            first = client.get("/admin/terms", params={"q": PAGE_DOMAIN, "page": 1}, headers=admin)
            second = client.get("/admin/terms", params={"q": PAGE_DOMAIN, "page": 2}, headers=admin)
            self.assertEqual(first.status_code, 200, first.text)
            self.assertEqual(second.status_code, 200, second.text)
            self.assertEqual(first.json()["total"], 51)
            self.assertEqual(len(first.json()["rows"]), 50)
            self.assertEqual(len(second.json()["rows"]), 1)
            self.assertEqual(first.json()["rows"][0]["email"], f"user-50@{PAGE_DOMAIN}")
            self.assertEqual(second.json()["rows"][0]["email"], f"user-00@{PAGE_DOMAIN}")
            accepted = client.get("/admin/terms", params={"q": PAGE_DOMAIN, "accepted": "yes"}, headers=admin)
            self.assertEqual(accepted.json()["total"], 26)
            self.assertTrue(all(row["terms_accepted"] for row in accepted.json()["rows"]))
            open_rows = client.get("/admin/terms", params={"q": PAGE_DOMAIN, "accepted": "no"}, headers=admin)
            self.assertEqual(open_rows.json()["total"], 25)
            self.assertTrue(all(not row["terms_accepted"] for row in open_rows.json()["rows"]))
