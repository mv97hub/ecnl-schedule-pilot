"""Issue reports: validation, per-IP limit, and the admin session cookie.

The session cookie is an expiry and an HMAC. It does not contain the password.
Login fails closed when ADMIN_PASSWORD is unset or blank.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import threading
import time
from datetime import UTC, datetime

from fastapi import HTTPException, Request

CATEGORIES = ("data", "app", "other")
ISSUE_LIMIT = 5
ISSUE_WINDOW_SECONDS = 60 * 60
SESSION_MAX_AGE = 4 * 60 * 60
SESSION_COOKIE = "admin_session"
SESSION_PATH = "/admin"
DESCRIPTION_LIMIT = 4000
EMAIL_LIMIT = 254
VERSION_LIMIT = 40
SCREEN_LIMIT = 80

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_LOCK = threading.Lock()
_HITS: dict[str, list[float]] = {}


def admin_password() -> str:
    return os.environ.get("ADMIN_PASSWORD", "").strip()


def passwords_match(provided: str, secret: str) -> bool:
    if not secret:
        return False
    left = hashlib.sha256(provided.encode()).digest()
    right = hashlib.sha256(secret.encode()).digest()
    return hmac.compare_digest(left, right)


def issue_session(secret: str, now: float | None = None) -> str:
    expiry = int((time.time() if now is None else now) + SESSION_MAX_AGE)
    payload = str(expiry)
    signature = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{signature}"


def session_is_valid(token: str | None, secret: str, now: float | None = None) -> bool:
    if not secret or not token:
        return False
    payload, separator, signature = token.partition(".")
    if not separator or not payload.isdigit() or not signature:
        return False
    expected = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        return False
    current = time.time() if now is None else now
    return int(payload) > current


def cookie_secure(request: Request) -> bool:
    forwarded = request.headers.get("x-forwarded-proto", "")
    proto = forwarded.split(",")[0].strip().lower() if forwarded else request.url.scheme
    return proto == "https"


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        hop = forwarded.split(",")[0].strip()
        if hop:
            return hop[:80]
    if request.client is not None and request.client.host:
        return request.client.host[:80]
    return "unknown"


def reset_issue_rate_limit() -> None:
    with _LOCK:
        _HITS.clear()


def claim_issue_slot(ip: str) -> int | None:
    """Record one report for this IP. Return retry-after seconds when the window is full."""

    moment = time.monotonic()
    with _LOCK:
        recent = [stamp for stamp in _HITS.get(ip, []) if moment - stamp < ISSUE_WINDOW_SECONDS]
        if len(recent) >= ISSUE_LIMIT:
            _HITS[ip] = recent
            oldest = min(recent)
            return max(1, int(ISSUE_WINDOW_SECONDS - (moment - oldest)) + 1)
        recent.append(moment)
        _HITS[ip] = recent
        return None


def clean_issue(payload: object) -> dict[str, str | None]:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail="Description is required.")
    category = payload.get("category")
    description = payload.get("description")
    email = payload.get("email")
    app_version = payload.get("app_version")
    screen = payload.get("screen")
    if not isinstance(category, str) or category not in CATEGORIES:
        raise HTTPException(status_code=422, detail="Category must be data, app, or other.")
    if not isinstance(description, str) or not description.strip():
        raise HTTPException(status_code=422, detail="Description is required.")
    description = description.strip()
    if len(description) > DESCRIPTION_LIMIT:
        raise HTTPException(status_code=422, detail="Description is too long.")
    if email is None or (isinstance(email, str) and not email.strip()):
        cleaned_email: str | None = None
    elif isinstance(email, str):
        cleaned_email = email.strip()
        if len(cleaned_email) > EMAIL_LIMIT or _EMAIL.fullmatch(cleaned_email) is None:
            raise HTTPException(status_code=422, detail="Enter a valid email or leave it blank.")
    else:
        raise HTTPException(status_code=422, detail="Enter a valid email or leave it blank.")
    if not isinstance(app_version, str) or not app_version.strip() or len(app_version.strip()) > VERSION_LIMIT:
        raise HTTPException(status_code=422, detail="App version is required.")
    if not isinstance(screen, str) or not screen.strip() or len(screen.strip()) > SCREEN_LIMIT:
        raise HTTPException(status_code=422, detail="Screen name is required.")
    return {
        "category": category,
        "description": description,
        "email": cleaned_email,
        "app_version": app_version.strip(),
        "screen": screen.strip(),
    }


def require_admin(request: Request) -> str:
    secret = admin_password()
    token = request.cookies.get(SESSION_COOKIE)
    if not session_is_valid(token, secret):
        raise HTTPException(status_code=401, detail="Sign in required")
    return secret


def utc_now() -> datetime:
    return datetime.now(UTC)
