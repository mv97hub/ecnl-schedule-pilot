"""Google and Apple identities share one account. The raw session token is not stored."""

from __future__ import annotations

import hashlib
import os
import sys
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.database import engine
from app.main import app
from app.models import AppSession, AppUser, AuthIdentity, Base, VenueRating, VenueRecommendation, VenueTipVote
from sqlmodel import SQLModel

SECRET = "probe-auth-secret"


def _body(
    provider: str,
    subject: str,
    email: str,
    *,
    verified: bool = True,
    name: str = "Probe Family",
    client: str = "web",
) -> dict[str, object]:
    return {
        "provider": provider,
        "subject": subject,
        "email": email,
        "email_verified": verified,
        "display_name": name,
        "client": client,
    }


class AccountTests(unittest.TestCase):
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
                        WHERE email LIKE '%@probe-auth.test'
                           OR venue_name = 'Probe Auth Park'
                        """
                    )
                )
            if connection.execute(text("SELECT to_regclass('public.venue_tip_vote')")).scalar() is not None:
                connection.execute(text("DELETE FROM venue_tip_vote WHERE author_key LIKE 'user:%' OR author_key = 'probe-auth-browser'"))
            if connection.execute(text("SELECT to_regclass('public.venue_recommendation')")).scalar() is not None:
                connection.execute(
                    text("DELETE FROM venue_recommendation WHERE city = 'Probeauth' OR author_key = 'probe-auth-browser'")
                )
            if connection.execute(text("SELECT to_regclass('public.venue_rating')")).scalar() is not None:
                connection.execute(text("DELETE FROM venue_rating WHERE city = 'Probeauth' OR author_key = 'probe-auth-browser'"))
            if connection.execute(text("SELECT to_regclass('public.auth_identity')")).scalar() is not None:
                connection.execute(
                    text(
                        """
                        DELETE FROM app_user
                        WHERE id IN (
                            SELECT user_id FROM auth_identity WHERE provider_subject LIKE 'probe-auth-%'
                        )
                        OR email LIKE '%@probe-auth.test'
                        """
                    )
                )

    def _open(self, client: TestClient, **kwargs: object) -> tuple[dict[str, object], str]:
        provider = str(kwargs.get("provider", "google"))
        subject = str(kwargs["subject"])
        email = str(kwargs["email"])
        opened = client.post(
            "/auth/session",
            headers={"X-Internal-Auth": SECRET},
            json=_body(
                provider,
                subject,
                email,
                verified=bool(kwargs.get("verified", True)),
                name=str(kwargs.get("name", "Probe Family")),
                client=str(kwargs.get("client", "web")),
            ),
        )
        self.assertEqual(opened.status_code, 200, opened.text)
        body = opened.json()
        return body, body["token"]

    def test_secret_must_be_set_and_must_match(self) -> None:
        with TestClient(app) as client:
            saved = os.environ.pop("AUTH_INTERNAL_SECRET")
            try:
                missing = client.post(
                    "/auth/session",
                    headers={"X-Internal-Auth": SECRET},
                    json=_body("google", "probe-auth-missing", "missing@probe-auth.test"),
                )
            finally:
                os.environ["AUTH_INTERNAL_SECRET"] = saved
            self.assertEqual(missing.status_code, 503)
            self.assertEqual(missing.json()["detail"], "AUTH_INTERNAL_SECRET is not set")
            wrong = client.post(
                "/auth/session",
                headers={"X-Internal-Auth": "not-the-secret"},
                json=_body("google", "probe-auth-wrong", "wrong@probe-auth.test"),
            )
            self.assertEqual(wrong.status_code, 401)
            self.assertNotIn(SECRET, wrong.text)

    def test_verified_email_links_providers_and_relay_does_not(self) -> None:
        with TestClient(app) as client:
            google, google_token = self._open(
                client,
                subject="probe-auth-google",
                email="family@probe-auth.test",
                name="Alex Family",
            )
            apple, _apple_token = self._open(
                client,
                provider="apple",
                subject="probe-auth-apple",
                email="Family@probe-auth.test",
                name="Alex Family",
            )
            self.assertEqual(apple["user"]["id"], google["user"]["id"])
            self.assertEqual(sorted(apple["user"]["providers"]), ["apple", "google"])

            relay, _relay_token = self._open(
                client,
                provider="apple",
                subject="probe-auth-relay",
                email="hide@privaterelay.appleid.com",
                name="Relay Family",
            )
            self.assertNotEqual(relay["user"]["id"], google["user"]["id"])

            unverified, _unverified_token = self._open(
                client,
                provider="apple",
                subject="probe-auth-unverified",
                email="other@probe-auth.test",
                verified=False,
            )
            again, _again_token = self._open(
                client,
                provider="google",
                subject="probe-auth-other-google",
                email="other@probe-auth.test",
            )
            self.assertNotEqual(unverified["user"]["id"], again["user"]["id"])

            me = client.get("/auth/me", headers={"Authorization": f"Bearer {google_token}"})
            self.assertEqual(me.status_code, 200)
            self.assertEqual(me.json()["email"], "family@probe-auth.test")
            self.assertNotIn("token", me.json())

            with Session(engine) as session:
                stored = list(session.scalars(select(AppSession.token_hash)).all())
                self.assertTrue(stored)
                self.assertNotIn(google_token, stored)
                self.assertIn(hashlib.sha256(google_token.encode()).hexdigest(), stored)
                row = session.scalar(select(AppSession).where(AppSession.token_hash == stored[0]))
                assert row is not None
                expires = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=UTC)
                self.assertGreater(expires, datetime.now(UTC) + timedelta(days=29))
                self.assertLess(expires, datetime.now(UTC) + timedelta(days=31))

    def test_delete_account_removes_writes_and_keeps_anonymous_rows(self) -> None:
        with TestClient(app) as client:
            _owner, owner_token = self._open(client, subject="probe-auth-owner", email="owner@probe-auth.test", name="Owner Family")
            _other, other_token = self._open(client, subject="probe-auth-other", email="other-family@probe-auth.test", name="Other Family")
            owner_headers = {"Authorization": f"Bearer {owner_token}"}
            other_headers = {"Authorization": f"Bearer {other_token}"}
            self.assertEqual(client.post("/auth/terms", json={"version": "ugc-1"}, headers=owner_headers).status_code, 200)
            self.assertEqual(client.post("/auth/terms", json={"version": "ugc-1"}, headers=other_headers).status_code, 200)
            rated = client.post(
                "/locations/rate",
                json={
                    "venue_name": "Probe Auth Park",
                    "city": "Probeauth",
                    "state": "FL",
                    "field_quality": 4,
                    "referees": 4,
                    "parent_vibe": 4,
                    "parking_access": 4,
                    "amenities": 4,
                    "author_name": "Typed Name",
                },
                headers=owner_headers,
            )
            self.assertEqual(rated.status_code, 200, rated.text)
            tip = client.post(
                "/locations/recommendations",
                json={
                    "venue_name": "Probe Auth Park",
                    "city": "Probeauth",
                    "state": "FL",
                    "category": "HOTEL",
                    "title": "Owner Inn",
                    "rating": 4,
                    "review_text": "Close to the fields.",
                },
                headers=owner_headers,
            )
            self.assertEqual(tip.status_code, 200, tip.text)
            other_tip = client.post(
                "/locations/recommendations",
                json={
                    "venue_name": "Probe Auth Park",
                    "city": "Probeauth",
                    "state": "FL",
                    "category": "RESTAURANT",
                    "title": "Other Grill",
                    "rating": 5,
                    "review_text": "Quick dinner.",
                },
                headers=other_headers,
            )
            self.assertEqual(other_tip.status_code, 200, other_tip.text)
            voted = client.post(
                f"/locations/recommendations/{other_tip.json()['id']}/vote",
                json={"choice": "up"},
                headers=owner_headers,
            )
            self.assertEqual(voted.status_code, 200, voted.text)
            self.assertEqual(voted.json()["upvotes"], 1)

            with Session(engine) as session:
                session.add(
                    VenueRating(
                        venue_key="probe auth park|probeauth|FL",
                        venue_name="Probe Auth Park",
                        city="Probeauth",
                        state="FL",
                        author_key="probe-auth-browser",
                        user_id=None,
                        author_name="Browser Family",
                        field_quality=2,
                        referees=2,
                        parent_vibe=2,
                        parking_access=2,
                        amenities=2,
                        updated_at=datetime.now(UTC),
                    )
                )
                session.commit()

            removed = client.delete("/auth/account", headers=owner_headers)
            self.assertEqual(removed.status_code, 200, removed.text)
            self.assertEqual(client.get("/auth/me", headers=owner_headers).status_code, 401)

            with Session(engine) as session:
                anonymous = session.scalar(select(VenueRating).where(VenueRating.author_key == "probe-auth-browser"))
                owner_ratings = session.scalars(select(VenueRating).where(VenueRating.author_key.like("user:%"))).all()
                owner_tips = session.scalars(
                    select(VenueRecommendation).where(VenueRecommendation.title == "Owner Inn")
                ).all()
                other = session.scalar(select(VenueRecommendation).where(VenueRecommendation.title == "Other Grill"))
                users = session.scalars(select(AppUser).where(AppUser.email == "owner@probe-auth.test")).all()
                identities = session.scalars(
                    select(AuthIdentity).where(AuthIdentity.provider_subject == "probe-auth-owner")
                ).all()
                kept_user = session.scalar(select(AppUser).where(AppUser.email == "other-family@probe-auth.test"))
                leftover_votes = session.scalars(
                    select(VenueTipVote).where(VenueTipVote.recommendation_id == other_tip.json()["id"])
                ).all()
                self.assertIsNotNone(anonymous)
                assert anonymous is not None
                anonymous_name = anonymous.author_name
                anonymous_user = anonymous.user_id
                owner_rating_count = len(list(owner_ratings))
                owner_tip_count = len(list(owner_tips))
                other_upvotes = None if other is None else other.upvotes
                kept = kept_user is not None
                user_count = len(list(users))
                identity_count = len(list(identities))
                vote_count = len(list(leftover_votes))
            self.assertEqual(anonymous_name, "Browser Family")
            self.assertIsNone(anonymous_user)
            self.assertEqual(owner_rating_count, 0)
            self.assertEqual(owner_tip_count, 0)
            self.assertEqual(other_upvotes, 0)
            self.assertEqual(vote_count, 0)
            self.assertEqual(user_count, 0)
            self.assertEqual(identity_count, 0)
            self.assertTrue(kept)

            ios = client.post(
                "/auth/session",
                headers={"X-Internal-Auth": SECRET},
                json=_body("google", "probe-auth-ios", "ios@probe-auth.test", client="ios"),
            )
            self.assertEqual(ios.status_code, 200, ios.text)
            with Session(engine) as session:
                stored = session.scalar(select(AppSession).where(AppSession.user_id == ios.json()["user"]["id"]))
                assert stored is not None
                self.assertEqual(stored.client, "ios")
                self.assertNotEqual(stored.token_hash, ios.json()["token"])
