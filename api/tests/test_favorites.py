"""Account favorites: one club and up to four ordered teams."""

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
from app.models import Base, Club, ScheduleTeam, UserFavorite

SECRET = "probe-favorite-secret"
CLUB_ID = 8804501
OTHER_CLUB = 8804502


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
            "display_name": "Favorite Family",
            "client": "web",
        },
    )
    assert opened.status_code == 200, opened.text
    return {"Authorization": f"Bearer {opened.json()['token']}"}


class FavoriteTests(unittest.TestCase):
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
                            WHERE provider_subject LIKE 'probe-favorite-%'
                        )
                        """
                    )
                )
            if connection.execute(text("SELECT to_regclass('public.team')")).scalar() is not None:
                connection.execute(text("DELETE FROM team WHERE name LIKE 'Probe Favorite %'"))
            if connection.execute(text("SELECT to_regclass('public.club')")).scalar() is not None:
                connection.execute(
                    text("DELETE FROM club WHERE id IN (:home, :other) OR name LIKE 'Probe Favorite %'"),
                    {"home": CLUB_ID, "other": OTHER_CLUB},
                )

    def _seed(self) -> dict[str, int]:
        with Session(engine) as session:
            session.add_all(
                (
                    Club(id=CLUB_ID, name="Probe Favorite FC", logo_url=None),
                    Club(id=OTHER_CLUB, name="Probe Favorite Other", logo_url=None),
                )
            )
            session.flush()
            ids: dict[str, int] = {}
            for key, age, club_id in (
                ("a", "U13", CLUB_ID),
                ("b", "U14", CLUB_ID),
                ("c", "U15", CLUB_ID),
                ("d", "U16", CLUB_ID),
                ("e", "U17", CLUB_ID),
                ("gone", "U13", OTHER_CLUB),
            ):
                team = ScheduleTeam(
                    name="Probe Favorite FC" if club_id == CLUB_ID else "Probe Favorite Other",
                    age_group=age,
                    tier="ECNL",
                    conference="Probe Favorite Conference",
                    city="Jacksonville",
                    state="FL",
                    gender="boys",
                    club_id=club_id,
                )
                session.add(team)
                session.flush()
                ids[key] = int(team.id)
            session.commit()
        return ids

    def test_save_replaces_order_and_drops_missing_rows(self) -> None:
        ids = self._seed()
        with TestClient(app) as client:
            refused = client.put("/me/favorites", json={"club_id": str(CLUB_ID), "team_ids": [ids["a"]]})
            self.assertEqual(refused.status_code, 401)

            headers = _sign_in(client, "probe-favorite-owner", "owner@probe-favorite.test")
            saved = client.put(
                "/me/favorites",
                json={"club_id": str(CLUB_ID), "team_ids": [ids["b"], ids["a"], ids["c"]]},
                headers=headers,
            )
            self.assertEqual(saved.status_code, 200, saved.text)
            self.assertEqual(saved.json()["club_id"], str(CLUB_ID))
            self.assertEqual(saved.json()["team_ids"], [ids["b"], ids["a"], ids["c"]])

            again = client.get("/me", headers=headers)
            self.assertEqual(again.status_code, 200, again.text)
            self.assertEqual(again.json()["team_ids"], [ids["b"], ids["a"], ids["c"]])
            self.assertEqual(again.json()["display_name"], "Favorite Family")

            too_many = client.put(
                "/me/favorites",
                json={"club_id": str(CLUB_ID), "team_ids": [ids["a"], ids["b"], ids["c"], ids["d"], ids["e"]]},
                headers=headers,
            )
            self.assertEqual(too_many.status_code, 400, too_many.text)
            self.assertEqual(client.get("/me", headers=headers).json()["team_ids"], [ids["b"], ids["a"], ids["c"]])

            duplicate = client.put(
                "/me/favorites",
                json={"club_id": str(CLUB_ID), "team_ids": [ids["a"], ids["a"]]},
                headers=headers,
            )
            self.assertEqual(duplicate.status_code, 400, duplicate.text)

            missing = client.put("/me/favorites", json={"club_id": "8804599", "team_ids": []}, headers=headers)
            self.assertEqual(missing.status_code, 400, missing.text)

            replaced = client.put(
                "/me/favorites",
                json={"club_id": str(OTHER_CLUB), "team_ids": [ids["gone"], ids["d"]]},
                headers=headers,
            )
            self.assertEqual(replaced.status_code, 200, replaced.text)

            with Session(engine) as session:
                session.execute(text("DELETE FROM team WHERE id = :team_id"), {"team_id": ids["gone"]})
                session.execute(text("DELETE FROM club WHERE id = :club_id"), {"club_id": OTHER_CLUB})
                session.commit()

            dropped = client.get("/me", headers=headers)
            self.assertEqual(dropped.status_code, 200, dropped.text)
            self.assertIsNone(dropped.json()["club_id"])
            self.assertEqual(dropped.json()["team_ids"], [ids["d"]])

            dashboard = client.get(f"/mobile/dashboard?team_ids={ids['d']}&club_id={CLUB_ID}")
            self.assertEqual(dashboard.status_code, 200, dashboard.text)
            self.assertEqual(set(dashboard.json()), {"teams", "club"})

            removed = client.delete("/auth/account", headers=headers)
            self.assertEqual(removed.status_code, 200, removed.text)
            with Session(engine) as session:
                leftover = session.scalars(select(UserFavorite)).all()
                leftover = [row for row in leftover if row.ref in {str(CLUB_ID), str(OTHER_CLUB), str(ids["d"])}]
            self.assertEqual(leftover, [])

    def test_auth_me_shape_is_unchanged(self) -> None:
        with TestClient(app) as client:
            headers = _sign_in(client, "probe-favorite-shape", "shape@probe-favorite.test")
            me = client.get("/auth/me", headers=headers)
            self.assertEqual(me.status_code, 200, me.text)
            self.assertEqual(set(me.json()), {"id", "display_name", "email", "providers"})
