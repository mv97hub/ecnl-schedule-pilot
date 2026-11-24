"""Public issue reports and the signed-in admin inbox."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.database import engine
from app.issues import ISSUE_LIMIT, reset_issue_rate_limit
from app.main import app
from app.models import Base
from sqlmodel import SQLModel


def _report(description: str, **extra: object) -> dict[str, object]:
    body: dict[str, object] = {
        "category": "data",
        "description": description,
        "app_version": "1.0.0",
        "screen": "Preferences",
    }
    body.update(extra)
    return body


SECRET = "probe-issue-secret"


def _sign_in(client: TestClient, subject: str, email: str) -> str:
    os.environ["AUTH_INTERNAL_SECRET"] = SECRET
    opened = client.post(
        "/auth/session",
        headers={"X-Internal-Auth": SECRET},
        json={
            "provider": "google",
            "subject": subject,
            "email": email,
            "email_verified": True,
            "display_name": "Probe Admin",
            "client": "web",
        },
    )
    assert opened.status_code == 200, opened.text
    return opened.json()["token"]


class IssueReportTests(unittest.TestCase):
    def setUp(self) -> None:
        Base.metadata.create_all(engine)
        SQLModel.metadata.create_all(engine)
        reset_issue_rate_limit()
        os.environ["AUTH_INTERNAL_SECRET"] = SECRET
        self._cleanup()

    def tearDown(self) -> None:
        self._cleanup()
        reset_issue_rate_limit()

    def _cleanup(self) -> None:
        with engine.begin() as connection:
            if connection.execute(text("SELECT to_regclass('public.issue')")).scalar() is not None:
                connection.execute(text("DELETE FROM issue WHERE description LIKE 'Probe issue%'"))
            if connection.execute(text("SELECT to_regclass('public.auth_identity')")).scalar() is not None:
                connection.execute(
                    text(
                        """
                        DELETE FROM app_user
                        WHERE id IN (
                            SELECT user_id FROM auth_identity WHERE provider_subject LIKE 'probe-issue-%'
                        )
                        """
                    )
                )

    def test_create_issue(self) -> None:
        with TestClient(app) as client:
            missing = client.post("/issues", json=_report("Probe issue kickoff is wrong", category="nope"))
            self.assertEqual(missing.status_code, 422)
            blank = client.post("/issues", json=_report("   "))
            self.assertEqual(blank.status_code, 422)

            created = client.post("/issues", json=_report("Probe issue kickoff is wrong"))
            self.assertEqual(created.status_code, 201)
            body = created.json()
            self.assertEqual(body["category"], "data")
            self.assertEqual(body["description"], "Probe issue kickoff is wrong")
            self.assertIsNone(body["email"])
            self.assertEqual(body["app_version"], "1.0.0")
            self.assertEqual(body["screen"], "Preferences")
            self.assertEqual(body["status"], "open")
            self.assertIsNone(body["completed_at"])
            self.assertIsNotNone(body["created_at"])

            with_email = client.post(
                "/issues",
                json=_report("Probe issue score missing", category="app", email="family@example.com"),
            )
            self.assertEqual(with_email.status_code, 201)
            self.assertEqual(with_email.json()["email"], "family@example.com")
            self.assertEqual(with_email.json()["category"], "app")

    def test_rate_limit_by_ip(self) -> None:
        with TestClient(app) as client:
            for index in range(ISSUE_LIMIT):
                response = client.post("/issues", json=_report(f"Probe issue rate {index}"))
                self.assertEqual(response.status_code, 201, response.text)
            blocked = client.post("/issues", json=_report("Probe issue rate blocked"))
            self.assertEqual(blocked.status_code, 429)
            self.assertIn("Too many reports", blocked.json()["detail"])

            other = client.post(
                "/issues",
                json=_report("Probe issue rate other network"),
                headers={"X-Forwarded-For": "203.0.113.50"},
            )
            self.assertEqual(other.status_code, 201)
            still_blocked = client.post("/issues", json=_report("Probe issue rate still blocked"))
            self.assertEqual(still_blocked.status_code, 429)

    def test_inbox_requires_an_allowed_account(self) -> None:
        with TestClient(app) as client:
            self.assertEqual(client.post("/admin/login", json={"password": "anything"}).status_code, 404)
            self.assertEqual(client.get("/admin/issues").status_code, 401)
            self.assertEqual(client.patch("/admin/issues/1", json={"done": True}).status_code, 401)

            other = _sign_in(client, "probe-issue-other", "someone@example.com")
            denied = client.get("/admin/issues", headers={"Authorization": f"Bearer {other}"})
            self.assertEqual(denied.status_code, 403)

            saved = os.environ.pop("AUTH_INTERNAL_SECRET")
            try:
                missing = client.post(
                    "/auth/session",
                    headers={"X-Internal-Auth": "anything"},
                    json={
                        "provider": "google",
                        "subject": "probe-issue-missing",
                        "email": "missing@example.com",
                        "email_verified": True,
                        "display_name": "Missing",
                        "client": "web",
                    },
                )
                self.assertEqual(missing.status_code, 503)
                self.assertEqual(missing.json()["detail"], "AUTH_INTERNAL_SECRET is not set")
            finally:
                os.environ["AUTH_INTERNAL_SECRET"] = saved

    def test_status_checkbox_sets_and_clears_completed_at(self) -> None:
        with TestClient(app) as client:
            denied = client.patch("/admin/issues/1", json={"done": True})
            self.assertEqual(denied.status_code, 401)

            first = client.post("/issues", json=_report("Probe issue older"))
            second = client.post("/issues", json=_report("Probe issue newer", category="other", email="coach@example.com"))
            self.assertEqual(first.status_code, 201)
            self.assertEqual(second.status_code, 201)
            first_id = first.json()["id"]
            second_id = second.json()["id"]

            token = _sign_in(client, "probe-issue-admin", "myuranv97@gmail.com")
            headers = {"Authorization": f"Bearer {token}"}
            open_rows = client.get("/admin/issues", headers=headers).json()
            self.assertEqual([row["id"] for row in open_rows], [second_id, first_id])
            self.assertTrue(all(row["status"] == "open" and row["completed_at"] is None for row in open_rows))

            marked = client.patch(f"/admin/issues/{second_id}", json={"done": True}, headers=headers)
            self.assertEqual(marked.status_code, 200)
            self.assertEqual(marked.json()["status"], "done")
            self.assertIsNotNone(marked.json()["completed_at"])

            still_open = client.get("/admin/issues", headers=headers).json()
            self.assertEqual([row["id"] for row in still_open], [first_id])
            done_rows = client.get("/admin/issues?status=done", headers=headers).json()
            self.assertEqual([row["id"] for row in done_rows], [second_id])
            self.assertEqual(done_rows[0]["status"], "done")
            self.assertIsNotNone(done_rows[0]["completed_at"])

            reopened = client.patch(f"/admin/issues/{second_id}", json={"done": False}, headers=headers)
            self.assertEqual(reopened.status_code, 200)
            self.assertEqual(reopened.json()["status"], "open")
            self.assertIsNone(reopened.json()["completed_at"])
            self.assertEqual(client.get("/admin/issues?status=done", headers=headers).json(), [])
            self.assertEqual(client.get("/admin/issues", headers=headers).json()[0]["id"], second_id)

            client.post("/auth/logout", headers=headers)
            self.assertEqual(client.get("/admin/issues", headers=headers).status_code, 401)
