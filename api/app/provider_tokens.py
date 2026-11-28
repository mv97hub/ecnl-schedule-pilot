"""Check an Apple or Google identity token before opening a phone session.

The website still proves itself with ``AUTH_INTERNAL_SECRET`` on
``POST /auth/session``. The phone cannot hold that secret, so
``POST /auth/provider`` checks the provider signature instead.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from dataclasses import dataclass

import httpx
import jwt
from jwt.algorithms import RSAAlgorithm

APPLE_ISSUER = "https://appleid.apple.com"
APPLE_KEYS = "https://appleid.apple.com/auth/keys"
APPLE_AUDIENCE = "com.mv97.soccerawayday"
GOOGLE_ISSUERS = frozenset({"https://accounts.google.com", "accounts.google.com"})
GOOGLE_KEYS = "https://www.googleapis.com/oauth2/v3/certs"
_KEYS_TTL_SECONDS = 60 * 60
_cache: dict[str, tuple[float, list[dict[str, object]]]] = {}


class ProviderTokenError(Exception):
    def __init__(self, message: str, *, unavailable: bool = False) -> None:
        super().__init__(message)
        self.unavailable = unavailable


@dataclass(frozen=True)
class VerifiedIdentity:
    subject: str
    email: str | None
    email_verified: bool
    display_name: str | None


def clear_key_cache() -> None:
    _cache.clear()


def fetch_jwks(url: str) -> list[dict[str, object]]:
    now = time.time()
    cached = _cache.get(url)
    if cached is not None and now - cached[0] < _KEYS_TTL_SECONDS:
        return cached[1]
    try:
        response = httpx.get(url, timeout=10)
    except httpx.HTTPError as exc:
        raise ProviderTokenError("signing keys are unavailable", unavailable=True) from exc
    if response.status_code != 200:
        raise ProviderTokenError("signing keys are unavailable", unavailable=True)
    try:
        body = response.json()
    except ValueError as exc:
        raise ProviderTokenError("signing keys are unavailable", unavailable=True) from exc
    keys = body.get("keys") if isinstance(body, dict) else None
    if not isinstance(keys, list) or not keys:
        raise ProviderTokenError("signing keys are unavailable", unavailable=True)
    parsed = [key for key in keys if isinstance(key, dict)]
    if not parsed:
        raise ProviderTokenError("signing keys are unavailable", unavailable=True)
    _cache[url] = (now, parsed)
    return parsed


def google_audiences() -> list[str]:
    """iOS tokens use the iOS client id. Android tokens use the web client id.

    The web client id is the same public ``GOOGLE_CLIENT_ID`` the website
    already uses. The client secret stays on the website and is not read here.
    """

    found: list[str] = []
    for name in ("GOOGLE_IOS_CLIENT_ID", "GOOGLE_CLIENT_ID"):
        value = os.environ.get(name, "").strip()
        if value and value not in found:
            found.append(value)
    if not found:
        raise ProviderTokenError("Google sign-in is not configured", unavailable=True)
    return found


def _name_from_claims(claims: dict[str, object]) -> str | None:
    raw = claims.get("name")
    if not isinstance(raw, str):
        given = claims.get("given_name")
        family = claims.get("family_name")
        parts = [part.strip() for part in (given, family) if isinstance(part, str) and part.strip()]
        raw = " ".join(parts)
    text = " ".join(raw.split()) if isinstance(raw, str) else ""
    if not text or "@" in text:
        return None
    return text[:80]


def _email_from_claims(claims: dict[str, object]) -> tuple[str | None, bool]:
    raw = claims.get("email")
    email = raw.strip().lower() if isinstance(raw, str) else ""
    if not email or "@" not in email or len(email) > 254:
        email = ""
    verified = claims.get("email_verified")
    if isinstance(verified, str):
        flag = verified.strip().lower() == "true"
    else:
        flag = verified is True
    return (email or None), bool(flag and email)


def _signing_key(token: str, keys: list[dict[str, object]]):
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise ProviderTokenError("token could not be read") from exc
    if header.get("alg") != "RS256":
        raise ProviderTokenError("token algorithm is not RS256")
    kid = header.get("kid")
    if not isinstance(kid, str) or not kid:
        raise ProviderTokenError("token key is missing")
    for key in keys:
        if key.get("kid") != kid or key.get("kty") != "RSA":
            continue
        if key.get("alg") not in (None, "RS256"):
            continue
        try:
            return RSAAlgorithm.from_jwk(json.dumps(key))
        except (jwt.PyJWTError, ValueError, TypeError) as exc:
            raise ProviderTokenError("token key could not be read") from exc
    raise ProviderTokenError("token key was not found")


def _decode(token: str, key: object, *, audience: str | list[str]) -> dict[str, object]:
    try:
        claims = jwt.decode(
            token,
            key,  # type: ignore[arg-type]
            algorithms=["RS256"],
            audience=audience,
            options={"require": ["exp", "sub"]},
            leeway=30,
        )
    except jwt.PyJWTError as exc:
        raise ProviderTokenError("token was rejected") from exc
    if not isinstance(claims, dict):
        raise ProviderTokenError("token was rejected")
    return claims


def verify_identity_token(*, provider: str, identity_token: str, nonce: str | None) -> VerifiedIdentity:
    """Signature, issuer, audience, and expiry. Apple also checks the nonce."""

    token = identity_token.strip()
    if provider == "apple":
        keys = fetch_jwks(APPLE_KEYS)
        claims = _decode(token, _signing_key(token, keys), audience=APPLE_AUDIENCE)
        issuer = claims.get("iss")
        if issuer != APPLE_ISSUER:
            raise ProviderTokenError("token issuer was rejected")
        expected = hashlib.sha256((nonce or "").encode()).hexdigest()
        presented = claims.get("nonce")
        if not isinstance(presented, str) or presented.lower() != expected:
            raise ProviderTokenError("token nonce was rejected")
    elif provider == "google":
        keys = fetch_jwks(GOOGLE_KEYS)
        claims = _decode(token, _signing_key(token, keys), audience=google_audiences())
        issuer = claims.get("iss")
        if not isinstance(issuer, str) or issuer not in GOOGLE_ISSUERS:
            raise ProviderTokenError("token issuer was rejected")
    else:
        raise ProviderTokenError("provider must be google or apple")

    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject.strip() or len(subject.strip()) > 255:
        raise ProviderTokenError("token subject is missing")
    email, email_verified = _email_from_claims(claims)
    return VerifiedIdentity(
        subject=subject.strip(),
        email=email,
        email_verified=email_verified,
        display_name=_name_from_claims(claims),
    )
