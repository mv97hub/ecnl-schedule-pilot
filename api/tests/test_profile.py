"""Home address and one calendar link per favorite team stay on the account."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session
from sqlmodel import SQLModel

from app.database import engine
from app.main import app
from app.models import Base, ScheduleTeam, UserCalendar, UserHomeAddress

SECRET = "probe-profile-secret"
ADDRESS = {
    "street": "1 Probe Street",
    "unit": "Apt 2",
    "city": "Jacksonville",
    "state": "FL",
    "postal_code": "32202",
}


def _sign_in(client: TestClient, subject: str, email: str) -> dict[str, str]:
    os.environ["AUTH_INTERNAL_SECRET"] = SECRET
    opened = client.post(
        "/auth/session",
        headers={"X-Internal-Auth": SECRET},
        json={
            "provider": "google",
            "subject": subject,
            "email": email,
            "email_verified": True,
            "display_name": "Probe Profile",
            "client": "web",
        },
    )
    assert opened.status_code == 200, opened.text
    return {"Authorization": f"Bearer {opened.json()['token']}"}


class ProfileTests(unittest.TestCase):
    def setUp(self) -> None:
        Base.metadata.create_all(engine)
        SQLModel.metadata.create_all(engine)
        os.environ["AUTH_INTERNAL_SECRET"] = SECRET
        self._cleanup()

    def tearDown(self) -> None:
        self._cleanup()

    def _cleanup(self) -> None:
        with engine.begin() as connection:
            if connection.execute(text("SELECT to_regclass('public.auth_identity')")).scalar() is not None:
                connection.execute(
                    text(
                        """
                        DELETE FROM app_user
                        WHERE id IN (
                            SELECT user_id FROM auth_identity
                            WHERE provider_subject LIKE 'probe-profile-%'
                        )
                        OR email LIKE '%@probe-profile.test'
                        """
                    )
                )
            if connection.execute(text("SELECT to_regclass('public.team')")).scalar() is not None:
                connection.execute(text("DELETE FROM team WHERE name LIKE 'Probe Profile %'"))

    def _seed_teams(self) -> dict[str, int]:
        with Session(engine) as session:
            ids: dict[str, int] = {}
            for key, age in (("a", "U13"), ("b", "U14"), ("c", "U15")):
                team = ScheduleTeam(
                    name=f"Probe Profile {key}",
                    age_group=age,
                    tier="ECNL",
                    conference="Probe Profile Conference",
                    city="Jacksonville",
                    state="FL",
                    gender="boys",
                )
                session.add(team)
                session.flush()
                ids[key] = int(team.id)
            session.commit()
        return ids

    def test_home_address_save_read_and_clear(self) -> None:
        with TestClient(app) as client:
            headers = _sign_in(client, "probe-profile-address", "address@probe-profile.test")
            before = client.get("/auth/me", headers=headers)
            self.assertEqual(before.status_code, 200, before.text)
            self.assertEqual(set(before.json()), {"id", "display_name", "email", "providers"})
            self.assertEqual(before.json()["display_name"], "Probe Profile")
            self.assertEqual(before.json()["email"], "address@probe-profile.test")
            self.assertEqual(before.json()["providers"], ["google"])

            refused = client.put("/me/home-address", json=ADDRESS)
            self.assertEqual(refused.status_code, 401)

            saved = client.put("/me/home-address", json=ADDRESS, headers=headers)
            self.assertEqual(saved.status_code, 200, saved.text)
            self.assertEqual(saved.json()["home_address"], ADDRESS)
            self.assertEqual(set(saved.json()) - {"home_address"}, {"id", "display_name", "email", "providers"})

            again = client.get("/auth/me", headers=headers)
            self.assertEqual(again.status_code, 200, again.text)
            self.assertEqual(again.json()["home_address"], ADDRESS)
            favorites = client.get("/me", headers=headers)
            self.assertEqual(favorites.status_code, 200, favorites.text)
            self.assertEqual(set(favorites.json()), {"id", "display_name", "email", "providers", "club_id", "team_ids"})

            with Session(engine) as session:
                row = session.scalar(select(UserHomeAddress).where(UserHomeAddress.city == "Jacksonville", UserHomeAddress.street == "1 Probe Street"))
                assert row is not None
                self.assertIsNone(row.latitude)
                self.assertIsNone(row.longitude)

            cleared = client.delete("/me/home-address", headers=headers)
            self.assertEqual(cleared.status_code, 200, cleared.text)
            after = client.get("/auth/me", headers=headers)
            self.assertEqual(after.status_code, 200, after.text)
            self.assertNotIn("home_address", after.json())
            self.assertEqual(set(after.json()), {"id", "display_name", "email", "providers"})

    def test_calendar_link_one_per_team_rejected_link_and_delete_account(self) -> None:
        ids = self._seed_teams()
        with TestClient(app) as client:
            headers = _sign_in(client, "probe-profile-calendar", "calendar@probe-profile.test")
            other_headers = _sign_in(client, "probe-profile-other", "other@probe-profile.test")
            saved_teams = client.put(
                "/me/favorites",
                json={"club_id": None, "team_ids": [ids["a"], ids["b"]]},
                headers=headers,
            )
            self.assertEqual(saved_teams.status_code, 200, saved_teams.text)
            self.assertEqual(saved_teams.json()["team_ids"], [ids["a"], ids["b"]])
            other_teams = client.put(
                "/me/favorites",
                json={"club_id": None, "team_ids": [ids["c"]]},
                headers=other_headers,
            )
            self.assertEqual(other_teams.status_code, 200, other_teams.text)

            rejected = client.put(
                "/me/calendars",
                json={"team_id": ids["a"], "source": "playmetrics", "url": "http://calendar.example.com/a.ics"},
                headers=headers,
            )
            self.assertEqual(rejected.status_code, 400, rejected.text)
            self.assertNotIn("http://calendar.example.com/a.ics", rejected.text)
            empty = client.get("/me/calendars", headers=headers)
            self.assertEqual(empty.status_code, 200, empty.text)
            self.assertEqual(empty.json()["calendars"], [])

            first = client.put(
                "/me/calendars",
                json={"team_id": ids["a"], "source": "PlayMetrics", "url": "webcal://calendar.example.com/a.ics"},
                headers=headers,
            )
            self.assertEqual(first.status_code, 200, first.text)
            self.assertEqual(first.json()["source"], "playmetrics")
            self.assertEqual(first.json()["url"], "https://calendar.example.com/a.ics")

            replaced = client.put(
                "/me/calendars",
                json={"team_id": ids["a"], "source": "playmetrics", "url": "https://calendar.example.com/a-new.ics"},
                headers=headers,
            )
            self.assertEqual(replaced.status_code, 200, replaced.text)
            second = client.put(
                "/me/calendars",
                json={"team_id": ids["b"], "source": "teamsnap", "url": "https://calendar.example.com/b.ics"},
                headers=headers,
            )
            self.assertEqual(second.status_code, 200, second.text)
            listed = client.get("/me/calendars", headers=headers)
            self.assertEqual(
                listed.json()["calendars"],
                [
                    {"team_id": ids["a"], "source": "playmetrics", "url": "https://calendar.example.com/a-new.ics"},
                    {"team_id": ids["b"], "source": "teamsnap", "url": "https://calendar.example.com/b.ics"},
                ],
            )
            with Session(engine) as session:
                owner = session.scalars(select(UserCalendar).where(UserCalendar.url.like("%calendar.example.com%"))).all()
                owner_rows = [(row.team_id, row.source, row.url) for row in owner]
            self.assertEqual(len(owner_rows), 2)

            missing_team = client.put(
                "/me/calendars",
                json={"team_id": ids["c"], "source": "playmetrics", "url": "https://calendar.example.com/c.ics"},
                headers=headers,
            )
            self.assertEqual(missing_team.status_code, 400, missing_team.text)
            self.assertEqual(len(client.get("/me/calendars", headers=headers).json()["calendars"]), 2)

            other_link = client.put(
                "/me/calendars",
                json={"team_id": ids["c"], "source": "teamsnap", "url": "https://calendar.example.com/other.ics"},
                headers=other_headers,
            )
            self.assertEqual(other_link.status_code, 200, other_link.text)

            dropped = client.put(
                "/me/favorites",
                json={"club_id": None, "team_ids": [ids["b"]]},
                headers=headers,
            )
            self.assertEqual(dropped.status_code, 200, dropped.text)
            remaining = client.get("/me/calendars", headers=headers)
            self.assertEqual(
                remaining.json()["calendars"],
                [{"team_id": ids["b"], "source": "teamsnap", "url": "https://calendar.example.com/b.ics"}],
            )

            address = client.put("/me/home-address", json=ADDRESS, headers=headers)
            self.assertEqual(address.status_code, 200, address.text)
            removed = client.delete("/auth/account", headers=headers)
            self.assertEqual(removed.status_code, 200, removed.text)
            self.assertEqual(client.get("/auth/me", headers=headers).status_code, 401)
            with Session(engine) as session:
                leftover_calendars = session.scalars(
                    select(UserCalendar).where(UserCalendar.url.like("%calendar.example.com%"))
                ).all()
                leftover_urls = [row.url for row in leftover_calendars]
                leftover_address = session.scalar(
                    select(UserHomeAddress).where(UserHomeAddress.street == "1 Probe Street")
                )
            self.assertEqual(leftover_urls, ["https://calendar.example.com/other.ics"])
            self.assertIsNone(leftover_address)
