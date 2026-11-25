"""Admin users list, last_login_at, and one contribution's history."""

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

from app.database import engine, ensure_account_columns
from app.main import app
from app.models import (
    AppSession,
    AppUser,
    AuthIdentity,
    Base,
    Club,
    ScheduleTeam,
    UserCalendar,
    UserFavorite,
    UserHomeAddress,
)
from sqlmodel import SQLModel

SECRET = "probe-users-secret"
VENUE = "Probe Users Park"
CITY = "Probeusers"
PAGE_DOMAIN = "probe-users-page.test"
CLUB_ID = 910000771
TEAM_SOURCE = 910000772
CALENDAR_URL = "https://playmetrics.example/probe-users-secret"


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _sign_in(client: TestClient, subject: str, email: str, name: str, provider: str = "google") -> tuple[dict[str, str], int]:
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
    assert "last_login_at" not in body["user"]
    return {"Authorization": f"Bearer {body['token']}"}, int(body["user"]["id"])


def _rating(comment: str, venue: str = VENUE) -> dict[str, object]:
    return {
        "venue_name": venue,
        "city": CITY,
        "state": "FL",
        "field_quality": 4,
        "referees": 3,
        "parent_vibe": 5,
        "parking_access": 2,
        "amenities": 4,
        "comment": comment,
    }


class AdminUserTests(unittest.TestCase):
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
            if connection.execute(text("SELECT to_regclass('public.location_write_event')")).scalar() is not None:
                connection.execute(
                    text(
                        """
                        DELETE FROM location_write_event
                        WHERE venue_name = :venue
                           OR venue_name = 'Probe Users Other'
                           OR email LIKE '%@probe-users.test'
                           OR email LIKE :page_email
                        """
                    ),
                    {"venue": VENUE, "page_email": f"%@{PAGE_DOMAIN}"},
                )
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
            if connection.execute(text("SELECT to_regclass('public.venue_recommendation')")).scalar() is not None:
                connection.execute(text("DELETE FROM venue_recommendation WHERE city = :city"), {"city": CITY})
            if connection.execute(text("SELECT to_regclass('public.venue_rating')")).scalar() is not None:
                connection.execute(text("DELETE FROM venue_rating WHERE city = :city"), {"city": CITY})
            if connection.execute(text("SELECT to_regclass('public.app_user')")).scalar() is not None:
                connection.execute(
                    text(
                        """
                        DELETE FROM app_user
                        WHERE email LIKE '%@probe-users.test'
                           OR email LIKE :page_email
                        """
                    ),
                    {"page_email": f"%@{PAGE_DOMAIN}"},
                )
            if connection.execute(text("SELECT to_regclass('public.team')")).scalar() is not None:
                connection.execute(text("DELETE FROM team WHERE source_id = :source OR name = 'Probe Users 15B'"), {"source": TEAM_SOURCE})
            if connection.execute(text("SELECT to_regclass('public.club')")).scalar() is not None:
                connection.execute(text("DELETE FROM club WHERE id = :club"), {"club": CLUB_ID})

    def test_new_session_sets_last_login_without_changing_public_reads(self) -> None:
        with TestClient(app) as client:
            headers, user_id = _sign_in(client, "probe-users-writer", "writer@probe-users.test", "Writer Family")
            me = client.get("/me", headers=headers)
            self.assertEqual(me.status_code, 200, me.text)
            self.assertEqual(set(me.json()), {"id", "display_name", "email", "providers", "club_id", "team_ids"})
            self.assertNotIn("last_login_at", me.json())
            account = client.get("/auth/me", headers=headers)
            self.assertEqual(account.status_code, 200, account.text)
            self.assertNotIn("last_login_at", account.json())
            self.assertNotIn("home_address", account.json())

            with Session(engine) as session:
                user = session.get(AppUser, user_id)
                stored = session.scalar(select(AppSession).where(AppSession.user_id == user_id))
                self.assertIsNotNone(user)
                self.assertIsNotNone(stored)
                assert user is not None and stored is not None
                self.assertIsNotNone(user.last_login_at)
                self.assertEqual(_utc(user.last_login_at), _utc(stored.created_at))
                user.last_login_at = datetime(2020, 1, 1, tzinfo=UTC)
                stored.created_at = datetime(2020, 1, 1, tzinfo=UTC)
                session.commit()

            again, _again_id = _sign_in(client, "probe-users-writer", "writer@probe-users.test", "Writer Family")
            self.assertEqual(again["Authorization"].startswith("Bearer "), True)
            with Session(engine) as session:
                user = session.get(AppUser, user_id)
                assert user is not None and user.last_login_at is not None
                self.assertGreater(_utc(user.last_login_at), datetime(2024, 1, 1, tzinfo=UTC))
                kept = _utc(user.last_login_at)

            logged_out = client.post("/auth/logout", headers=again)
            self.assertEqual(logged_out.status_code, 200, logged_out.text)
            with Session(engine) as session:
                user = session.get(AppUser, user_id)
                assert user is not None and user.last_login_at is not None
                self.assertEqual(_utc(user.last_login_at), kept)

    def test_backfill_copies_newest_session_once(self) -> None:
        older = datetime(2024, 1, 1, tzinfo=UTC)
        newer = datetime(2024, 6, 1, tzinfo=UTC)
        with Session(engine) as session:
            signed_in = AppUser(display_name="Backfill Family", email="backfill@probe-users.test", created_at=older, last_login_at=None)
            quiet = AppUser(display_name="Quiet Family", email="quiet@probe-users.test", created_at=older, last_login_at=None)
            session.add_all((signed_in, quiet))
            session.flush()
            session.add_all(
                (
                    AppSession(
                        user_id=signed_in.id,
                        token_hash=hashlib.sha256(b"probe-users-backfill-old").hexdigest(),
                        client="web",
                        expires_at=newer + timedelta(days=30),
                        created_at=older,
                    ),
                    AppSession(
                        user_id=signed_in.id,
                        token_hash=hashlib.sha256(b"probe-users-backfill-new").hexdigest(),
                        client="web",
                        expires_at=newer + timedelta(days=30),
                        created_at=newer,
                    ),
                )
            )
            session.commit()
            signed_in_id = int(signed_in.id)
            quiet_id = int(quiet.id)

        ensure_account_columns()
        with Session(engine) as session:
            signed_in = session.get(AppUser, signed_in_id)
            quiet = session.get(AppUser, quiet_id)
            assert signed_in is not None and quiet is not None
            self.assertEqual(_utc(signed_in.last_login_at), newer)
            self.assertIsNone(quiet.last_login_at)
            signed_in.last_login_at = datetime(2023, 3, 1, tzinfo=UTC)
            session.add(
                AppSession(
                    user_id=signed_in_id,
                    token_hash=hashlib.sha256(b"probe-users-backfill-later").hexdigest(),
                    client="web",
                    expires_at=newer + timedelta(days=40),
                    created_at=datetime(2024, 12, 1, tzinfo=UTC),
                )
            )
            session.commit()

        ensure_account_columns()
        with TestClient(app) as client:
            admin, _admin_id = _sign_in(client, "probe-users-admin", "myuranv97@gmail.com", "Admin")
            listed = client.get("/admin/users", params={"q": "backfill@probe-users.test"}, headers=admin)
            self.assertEqual(listed.status_code, 200, listed.text)
            self.assertEqual(listed.json()["rows"][0]["last_login_at"], "2023-03-01T00:00:00Z")
            blank = client.get("/admin/users", params={"q": "quiet@probe-users.test"}, headers=admin)
            self.assertEqual(blank.status_code, 200, blank.text)
            self.assertIsNone(blank.json()["rows"][0]["last_login_at"])
            self.assertNotIn(CALENDAR_URL, listed.text)
            self.assertNotIn("token", listed.json()["rows"][0])

    def test_second_users_page_and_saved_account_fields(self) -> None:
        with TestClient(app) as client:
            admin, _admin_id = _sign_in(client, "probe-users-page-admin", "premiergamedayhq@gmail.com", "Page Admin")
            base = datetime(2025, 1, 1, tzinfo=UTC)
            with Session(engine) as session:
                club = Club(id=CLUB_ID, name="Probe Users FC", parent_club_id=None, logo_url=None)
                session.add(club)
                session.flush()
                team = ScheduleTeam(
                    name="Probe Users 15B",
                    age_group="U15",
                    tier="ECNL",
                    conference="Probe Users Conference",
                    city="Jacksonville",
                    state="FL",
                    source_id=TEAM_SOURCE,
                    gender="boys",
                    club_id=CLUB_ID,
                )
                session.add(team)
                session.flush()
                featured = AppUser(
                    display_name="Alex Rivera",
                    email="alex@probe-users.test",
                    created_at=base + timedelta(days=2),
                    last_login_at=base + timedelta(days=3),
                )
                session.add(featured)
                session.flush()
                session.add_all(
                    (
                        AuthIdentity(
                            user_id=featured.id,
                            provider="apple",
                            provider_subject="probe-users-alex-apple",
                            email="alex@probe-users.test",
                            email_verified=True,
                        ),
                        AuthIdentity(
                            user_id=featured.id,
                            provider="google",
                            provider_subject="probe-users-alex-google",
                            email="alex@probe-users.test",
                            email_verified=True,
                        ),
                        UserFavorite(user_id=featured.id, kind="club", ref=str(CLUB_ID), position=0),
                        UserFavorite(user_id=featured.id, kind="team", ref=str(team.id), position=1),
                        UserHomeAddress(
                            user_id=featured.id,
                            street="123 Main St",
                            unit="Apt 4",
                            city="Jacksonville",
                            state="FL",
                            postal_code="32202",
                        ),
                        UserCalendar(user_id=featured.id, team_id=team.id, source="playmetrics", url=CALENDAR_URL),
                    )
                )
                for index in range(51):
                    session.add(
                        AppUser(
                            display_name=f"Page Family {index:02d}",
                            email=f"user-{index:02d}@{PAGE_DOMAIN}",
                            created_at=base + timedelta(minutes=index),
                            last_login_at=None,
                        )
                    )
                session.commit()

            stranger, _stranger_id = _sign_in(client, "probe-users-stranger", "stranger@probe-users.test", "Stranger")
            self.assertEqual(client.get("/admin/users").status_code, 401)
            self.assertEqual(client.get("/admin/users", headers=stranger).status_code, 403)

            first = client.get("/admin/users", params={"q": PAGE_DOMAIN, "page": 1}, headers=admin)
            second = client.get("/admin/users", params={"q": PAGE_DOMAIN, "page": 2}, headers=admin)
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
            first_ids = {row["id"] for row in first_body["rows"]}
            second_ids = {row["id"] for row in second_body["rows"]}
            self.assertTrue(first_ids.isdisjoint(second_ids))
            self.assertEqual(first_body["rows"][0]["email"], f"user-50@{PAGE_DOMAIN}")
            self.assertEqual(second_body["rows"][0]["email"], f"user-00@{PAGE_DOMAIN}")
            self.assertIsNone(second_body["rows"][0]["last_login_at"])
            named = client.get("/admin/users", params={"q": "Family 07"}, headers=admin)
            self.assertEqual(named.status_code, 200, named.text)
            self.assertEqual([row["display_name"] for row in named.json()["rows"]], ["Page Family 07"])

            featured = client.get("/admin/users", params={"q": "alex@probe-users.test"}, headers=admin)
            self.assertEqual(featured.status_code, 200, featured.text)
            row = featured.json()["rows"][0]
            self.assertEqual(
                set(row),
                {
                    "id",
                    "display_name",
                    "email",
                    "providers",
                    "created_at",
                    "last_login_at",
                    "club",
                    "teams",
                    "home_address",
                },
            )
            self.assertEqual(row["display_name"], "Alex Rivera")
            self.assertEqual(row["providers"], ["apple", "google"])
            self.assertEqual(row["club"], "Probe Users FC")
            self.assertEqual(row["teams"], ["Probe Users 15B"])
            self.assertEqual(
                row["home_address"],
                {"street": "123 Main St", "unit": "Apt 4", "city": "Jacksonville", "state": "FL", "postal_code": "32202"},
            )
            self.assertNotIn("latitude", featured.text)
            self.assertNotIn("longitude", featured.text)
            self.assertNotIn(CALENDAR_URL, featured.text)
            self.assertNotIn("token", row)

    def test_contribution_history_keeps_the_original_comment(self) -> None:
        with TestClient(app) as client:
            writer, _writer_id = _sign_in(client, "probe-users-note", "note@probe-users.test", "Note Family")
            rated = client.post("/locations/rate", json=_rating("Original family note"), headers=writer)
            self.assertEqual(rated.status_code, 200, rated.text)
            other = client.post("/locations/rate", json=_rating("Other park note", "Probe Users Other"), headers=writer)
            self.assertEqual(other.status_code, 200, other.text)
            stranger, _stranger_id = _sign_in(client, "probe-users-note-stranger", "note-stranger@probe-users.test", "Stranger")
            admin, _admin_id = _sign_in(client, "probe-users-note-admin", "myuranv97@gmail.com", "Admin")
            listed = client.get("/admin/contributions", params={"email": "note@probe-users.test", "kind": "rating", "venue": VENUE}, headers=admin)
            self.assertEqual(listed.status_code, 200, listed.text)
            rating_id = listed.json()["rows"][0]["id"]
            edited = client.post(
                f"/admin/contributions/rating/{rating_id}/edit",
                json={"comment": "Rewritten family note"},
                headers=admin,
            )
            self.assertEqual(edited.status_code, 200, edited.text)
            hidden = client.post(f"/admin/contributions/rating/{rating_id}/hide", headers=admin)
            self.assertEqual(hidden.status_code, 200, hidden.text)
            restored = client.post(f"/admin/contributions/rating/{rating_id}/restore", headers=admin)
            self.assertEqual(restored.status_code, 200, restored.text)

            self.assertEqual(client.get(f"/admin/contributions/rating/{rating_id}/history").status_code, 401)
            self.assertEqual(client.get(f"/admin/contributions/rating/{rating_id}/history", headers=stranger).status_code, 403)
            history = client.get(f"/admin/contributions/rating/{rating_id}/history", headers=admin)
            self.assertEqual(history.status_code, 200, history.text)
            rows = history.json()
            self.assertEqual([row["action"] for row in rows], ["create", "edit", "hide", "restore"])
            self.assertEqual(rows[0]["new"]["comment"], "Original family note")
            self.assertEqual(rows[1]["previous"]["comment"], "Original family note")
            self.assertEqual(rows[1]["new"]["comment"], "Rewritten family note")
            self.assertNotIn("Other park note", history.text)

            public = client.get("/locations/detail", params={"venue_name": VENUE, "city": CITY, "state": "FL"})
            self.assertEqual(public.status_code, 200, public.text)
            self.assertNotIn("Original family note", public.text)
            self.assertNotIn("note@probe-users.test", public.text)
            self.assertNotIn("history", public.json())
            self.assertEqual(public.json()["my_rating"], None)
            visible = client.get(
                "/locations/detail",
                params={"venue_name": VENUE, "city": CITY, "state": "FL"},
                headers=writer,
            )
            self.assertEqual(visible.json()["my_rating"]["comment"], "Rewritten family note")
            self.assertNotIn("email", visible.json()["my_rating"])
            self.assertNotIn("history", visible.json())
