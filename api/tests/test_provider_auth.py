"""The phone checks an Apple or Google identity token. The website secret stays on /auth/session."""

from __future__ import annotations

import hashlib
import json
import os
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from jwt.algorithms import RSAAlgorithm
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app import provider_tokens
from app.database import engine
from app.main import app
from app.models import AppSession, AppUser, Base
from app.provider_tokens import APPLE_AUDIENCE
from sqlmodel import SQLModel

SECRET = "probe-provider-secret"
GOOGLE_AUDIENCE = "probe-ios.apps.googleusercontent.com"
KID = "probe-provider-key"


def _pem_and_jwk() -> tuple[bytes, dict[str, object]]:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    jwk = json.loads(RSAAlgorithm.to_jwk(key.public_key()))
    jwk["kid"] = KID
    jwk["alg"] = "RS256"
    jwk["use"] = "sig"
    return private, jwk


def _token(private: bytes, claims: dict[str, object]) -> str:
    encoded = jwt.encode(claims, private, algorithm="RS256", headers={"kid": KID})
    return encoded if isinstance(encoded, str) else encoded.decode()


class ProviderAuthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.private, cls.jwk = _pem_and_jwk()

    def setUp(self) -> None:
        Base.metadata.create_all(engine)
        SQLModel.metadata.create_all(engine)
        os.environ["AUTH_INTERNAL_SECRET"] = SECRET
        os.environ["GOOGLE_IOS_CLIENT_ID"] = GOOGLE_AUDIENCE
        os.environ.pop("GOOGLE_CLIENT_ID", None)
        self._fetch = provider_tokens.fetch_jwks
        provider_tokens.fetch_jwks = lambda _url: [self.jwk]  # type: ignore[assignment]
        provider_tokens.clear_key_cache()
        self._cleanup()

    def tearDown(self) -> None:
        provider_tokens.fetch_jwks = self._fetch
        provider_tokens.clear_key_cache()
        os.environ.pop("GOOGLE_CLIENT_ID", None)
        self._cleanup()

    def _cleanup(self) -> None:
        with engine.begin() as connection:
            if connection.execute(text("SELECT to_regclass('public.auth_identity')")).scalar() is not None:
                connection.execute(
                    text(
                        """
                        DELETE FROM app_user
                        WHERE id IN (
                            SELECT user_id FROM auth_identity WHERE provider_subject LIKE 'probe-provider-%'
                        )
                        OR email LIKE '%@probe-provider.test'
                        """
                    )
                )

    def _apple(self, subject: str, **overrides: object) -> str:
        now = int(time.time())
        raw = str(overrides.pop("nonce_raw", "probe-nonce"))
        claims: dict[str, object] = {
            "iss": "https://appleid.apple.com",
            "aud": APPLE_AUDIENCE,
            "exp": now + 600,
            "sub": subject,
            "email": "fan@probe-provider.test",
            "email_verified": True,
            "nonce": hashlib.sha256(raw.encode()).hexdigest(),
        }
        claims.update(overrides)
        return _token(self.private, claims)

    def _google(self, subject: str, **overrides: object) -> str:
        now = int(time.time())
        claims: dict[str, object] = {
            "iss": "https://accounts.google.com",
            "aud": GOOGLE_AUDIENCE,
            "exp": now + 600,
            "sub": subject,
            "email": "fan@probe-provider.test",
            "email_verified": True,
            "name": "Token Family",
        }
        claims.update(overrides)
        return _token(self.private, claims)

    def _post(self, api: TestClient, **body: object):
        payload = {
            "provider": "apple",
            "identity_token": body.get("identity_token", "x" * 20),
            "nonce": body.get("nonce", "probe-nonce"),
            "client": body.get("client", "ios"),
        }
        if "display_name" in body:
            payload["display_name"] = body["display_name"]
        if body.get("provider"):
            payload["provider"] = body["provider"]
        return api.post("/auth/provider", json=payload)

    def test_apple_ios_session_stores_only_the_hash(self) -> None:
        with TestClient(app) as client:
            opened = self._post(
                client,
                identity_token=self._apple("probe-provider-apple"),
            )
            self.assertEqual(opened.status_code, 200, opened.text)
            body = opened.json()
            self.assertEqual(body["user"]["display_name"], "ECNL Family")
            self.assertEqual(body["user"]["providers"], ["apple"])
            self.assertNotIn("X-Internal-Auth", opened.request.headers)
            me = client.get("/me", headers={"Authorization": f"Bearer {body['token']}"})
            self.assertEqual(me.status_code, 200)
            self.assertEqual(me.json()["email"], "fan@probe-provider.test")
            with Session(engine) as session:
                row = session.scalar(select(AppSession).where(AppSession.user_id == body["user"]["id"]))
                self.assertIsNotNone(row)
                assert row is not None
                self.assertEqual(row.client, "ios")
                self.assertNotEqual(row.token_hash, body["token"])
                self.assertEqual(row.token_hash, hashlib.sha256(body["token"].encode()).hexdigest())

    def test_web_client_is_rejected_and_android_is_accepted(self) -> None:
        with TestClient(app) as client:
            rejected = self._post(client, client="web", identity_token=self._apple("probe-provider-web"))
            self.assertEqual(rejected.status_code, 400)
            self.assertEqual(rejected.json()["detail"], "client must be ios or android")
            self.assertIsNone(
                client.get("/me", headers={"Authorization": "Bearer not-a-session"}).json().get("id")
            )
            accepted = self._post(
                client,
                client="android",
                identity_token=self._apple("probe-provider-android"),
            )
            self.assertEqual(accepted.status_code, 200, accepted.text)
            with Session(engine) as session:
                user = session.scalar(select(AppUser).where(AppUser.email == "fan@probe-provider.test"))
                self.assertIsNotNone(user)
                assert user is not None
                row = session.scalar(select(AppSession).where(AppSession.user_id == user.id, AppSession.client == "android"))
                self.assertIsNotNone(row)

    def test_apple_nonce_name_and_rejected_tokens(self) -> None:
        with TestClient(app) as client:
            missing = self._post(client, identity_token=self._apple("probe-provider-nonce"), nonce="")
            self.assertEqual(missing.status_code, 400)
            mismatch = self._post(
                client,
                identity_token=self._apple("probe-provider-nonce"),
                nonce="other-nonce",
            )
            self.assertEqual(mismatch.status_code, 401)
            expired = self._post(
                client,
                identity_token=self._apple("probe-provider-expired", exp=int(time.time()) - 120),
            )
            self.assertEqual(expired.status_code, 401)
            wrong_audience = self._post(
                client,
                identity_token=self._apple("probe-provider-aud", aud="com.example.other"),
            )
            self.assertEqual(wrong_audience.status_code, 401)
            named = self._post(
                client,
                identity_token=self._apple("probe-provider-named"),
                display_name="Sam Family",
            )
            self.assertEqual(named.status_code, 200, named.text)
            self.assertEqual(named.json()["user"]["display_name"], "Sam Family")
            again = self._post(client, identity_token=self._apple("probe-provider-named"))
            self.assertEqual(again.status_code, 200, again.text)
            self.assertEqual(again.json()["user"]["display_name"], "Sam Family")
            self.assertEqual(again.json()["user"]["id"], named.json()["user"]["id"])

    def test_google_audience_and_token_name(self) -> None:
        with TestClient(app) as client:
            opened = self._post(
                client,
                provider="google",
                identity_token=self._google("probe-provider-google"),
                display_name="Body Name",
                nonce=None,
            )
            self.assertEqual(opened.status_code, 200, opened.text)
            self.assertEqual(opened.json()["user"]["display_name"], "Token Family")
            self.assertEqual(opened.json()["user"]["providers"], ["google"])
            wrong = self._post(
                client,
                provider="google",
                identity_token=self._google("probe-provider-google-aud", aud="other.apps.googleusercontent.com"),
            )
            self.assertEqual(wrong.status_code, 401)
            os.environ.pop("GOOGLE_IOS_CLIENT_ID", None)
            os.environ.pop("GOOGLE_CLIENT_ID", None)
            missing = self._post(
                client,
                provider="google",
                identity_token=self._google("probe-provider-google-config"),
            )
            self.assertEqual(missing.status_code, 503)

    def test_android_google_token_uses_the_web_client_audience(self) -> None:
        web_audience = "probe-web.apps.googleusercontent.com"
        with TestClient(app) as client:
            rejected = self._post(
                client,
                provider="google",
                client="android",
                identity_token=self._google("probe-provider-google-web", aud=web_audience),
                nonce=None,
            )
            self.assertEqual(rejected.status_code, 401, rejected.text)
            os.environ["GOOGLE_CLIENT_ID"] = web_audience
            opened = self._post(
                client,
                provider="google",
                client="android",
                identity_token=self._google("probe-provider-google-web", aud=web_audience),
                nonce=None,
            )
            self.assertEqual(opened.status_code, 200, opened.text)
            self.assertEqual(opened.json()["user"]["providers"], ["google"])
            with Session(engine) as session:
                row = session.scalar(
                    select(AppSession).where(AppSession.user_id == opened.json()["user"]["id"], AppSession.client == "android")
                )
                self.assertIsNotNone(row)

    def test_internal_session_route_still_requires_the_secret(self) -> None:
        with TestClient(app) as client:
            opened = client.post(
                "/auth/session",
                json={
                    "provider": "google",
                    "subject": "probe-provider-secret-route",
                    "email": "secret@probe-provider.test",
                    "email_verified": True,
                    "display_name": "Secret Family",
                    "client": "web",
                },
            )
            self.assertEqual(opened.status_code, 401)


if __name__ == "__main__":
    unittest.main()
