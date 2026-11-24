"""Website accounts. The API stores the person and a hashed session token.

The website checks Google or Apple, then calls ``POST /auth/session`` with
``AUTH_INTERNAL_SECRET``. The raw token is returned once. Location writes
send it back as ``Authorization: Bearer``.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import Depends, Header, HTTPException
from sqlalchemy import delete, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    AppSession,
    AppUser,
    AuthIdentity,
    UserCalendar,
    UserFavorite,
    UserHomeAddress,
    VenueRating,
    VenueRecommendation,
    VenueTipVote,
)

ADMIN_EMAILS = frozenset({"myuranv97@gmail.com", "premiergamedayhq@gmail.com"})
SESSION_DAYS = 30
RELAY_DOMAIN = "privaterelay.appleid.com"
PROVIDERS = frozenset({"google", "apple"})
CLIENTS = frozenset({"web", "ios", "android"})


def internal_secret() -> str:
    return os.environ.get("AUTH_INTERNAL_SECRET", "").strip()


def require_internal(x_internal_auth: Annotated[str | None, Header()] = None) -> None:
    """The website process proves it checked the provider. There is no fallback secret."""

    secret = internal_secret()
    if not secret:
        raise HTTPException(status_code=503, detail="AUTH_INTERNAL_SECRET is not set")
    provided = (x_internal_auth or "").strip()
    if not provided:
        raise HTTPException(status_code=401, detail="Sign-in is not authorized")
    left = hashlib.sha256(provided.encode()).digest()
    right = hashlib.sha256(secret.encode()).digest()
    if not hmac.compare_digest(left, right):
        raise HTTPException(status_code=401, detail="Sign-in is not authorized")


def bearer_token(authorization: Annotated[str | None, Header()] = None) -> str | None:
    if not authorization:
        return None
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer":
        return None
    token = value.strip()
    return token or None


def require_bearer(token: Annotated[str | None, Depends(bearer_token)]) -> str:
    if not token:
        raise HTTPException(status_code=401, detail="Sign in required")
    return token


def token_hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _normalize_email(email: str | None) -> str | None:
    if email is None:
        return None
    text = email.strip().lower()
    return text or None


def is_private_relay(email: str | None) -> bool:
    """Apple Hide My Email addresses do not match a Google address."""

    normalized = _normalize_email(email)
    if not normalized or "@" not in normalized:
        return False
    return normalized.rsplit("@", 1)[1] == RELAY_DOMAIN


def public_display_name(name: str | None) -> str:
    """The name shown on a tip. An email address is never used."""

    text = " ".join((name or "").split())
    if not text or "@" in text:
        return "ECNL Family"
    return text[:80]


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def user_from_token(db: Session, raw: str | None) -> AppUser | None:
    if not raw:
        return None
    row = db.scalar(select(AppSession).where(AppSession.token_hash == token_hash(raw)))
    if row is None:
        return None
    if _as_utc(row.expires_at) <= datetime.now(UTC):
        return None
    return db.get(AppUser, row.user_id)


def require_user(db: Session, raw: str) -> AppUser:
    user = user_from_token(db, raw)
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in required")
    return user


def require_admin(db: Session, raw: str) -> AppUser:
    user = require_user(db, raw)
    email = (user.email or "").strip().lower()
    if email not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="This account cannot open issue reports")
    return user


def author_for(user: AppUser) -> tuple[str, str, str]:
    """``user_id``, ``author_key``, and the public name for one account."""

    return str(user.id), f"user:{user.id}", public_display_name(user.display_name)


def _apply_display_name(user: AppUser, provided: str | None, *, creating: bool) -> None:
    text = " ".join((provided or "").split())
    if text and "@" not in text:
        user.display_name = text[:80]
        return
    if creating or not (user.display_name or "").strip():
        user.display_name = "ECNL Family"


def _apply_account_email(user: AppUser, email: str | None) -> None:
    if not email:
        return
    if not user.email or is_private_relay(user.email):
        if not is_private_relay(email) or not user.email:
            user.email = email


def _find_verified_user(db: Session, email: str) -> AppUser | None:
    if is_private_relay(email):
        return None
    identity = db.scalar(
        select(AuthIdentity).where(
            AuthIdentity.email == email,
            AuthIdentity.email_verified.is_(True),
        )
    )
    if identity is None or is_private_relay(identity.email):
        return None
    return db.get(AppUser, identity.user_id)


def providers_for(db: Session, user_id: int) -> list[str]:
    rows = db.scalars(
        select(AuthIdentity.provider).where(AuthIdentity.user_id == user_id).order_by(AuthIdentity.id)
    ).all()
    seen: list[str] = []
    for provider in rows:
        if provider not in seen:
            seen.append(provider)
    return seen


def open_identity(
    db: Session,
    *,
    provider: str,
    subject: str,
    email: str | None,
    email_verified: bool,
    display_name: str | None,
    client: str,
) -> tuple[AppUser, str]:
    """Find or create the person, then issue one raw session token."""

    if provider not in PROVIDERS:
        raise HTTPException(status_code=400, detail="provider must be google or apple")
    if client not in CLIENTS:
        raise HTTPException(status_code=400, detail="client must be web, ios, or android")
    subject_text = subject.strip()
    if not subject_text or len(subject_text) > 255:
        raise HTTPException(status_code=400, detail="provider subject is required")
    normalized = _normalize_email(email)
    if normalized and (len(normalized) > 254 or "@" not in normalized):
        raise HTTPException(status_code=400, detail="email is not valid")

    identity = db.scalar(
        select(AuthIdentity).where(
            AuthIdentity.provider == provider,
            AuthIdentity.provider_subject == subject_text,
        )
    )
    if identity is None and email_verified and normalized:
        user = _find_verified_user(db, normalized)
    else:
        user = db.get(AppUser, identity.user_id) if identity is not None else None

    if user is None:
        user = AppUser(email=normalized, created_at=datetime.now(UTC), display_name="ECNL Family")
        _apply_display_name(user, display_name, creating=True)
        db.add(user)
        db.flush()
    else:
        _apply_display_name(user, display_name, creating=False)
        _apply_account_email(user, normalized)

    if identity is None:
        identity = AuthIdentity(
            user_id=user.id,
            provider=provider,
            provider_subject=subject_text,
            email=normalized,
            email_verified=bool(email_verified and normalized),
        )
        db.add(identity)
    else:
        if normalized:
            identity.email = normalized
            identity.email_verified = bool(email_verified)
        identity.user_id = user.id

    raw = secrets.token_urlsafe(32)
    db.add(
        AppSession(
            user_id=user.id,
            token_hash=token_hash(raw),
            client=client,
            expires_at=datetime.now(UTC) + timedelta(days=SESSION_DAYS),
            created_at=datetime.now(UTC),
        )
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Sign-in could not be saved. Try again.") from None
    db.refresh(user)
    return user, raw


def logout(db: Session, raw: str) -> None:
    hashed = token_hash(raw)
    db.execute(delete(AppSession).where(AppSession.token_hash == hashed))
    db.commit()


def delete_account(db: Session, user: AppUser) -> None:
    """Remove the person, their sign-ins, sessions, favorites, home address, calendar links, ratings, tips, and votes.

    Location history rows stay. They already hold the email and display name from the write.
    Calendar links are not copied into that history.
    """

    user_id = str(user.id)
    author_key = f"user:{user.id}"
    own_tip_ids = set(
        db.scalars(
            select(VenueRecommendation.id).where(
                or_(VenueRecommendation.user_id == user_id, VenueRecommendation.author_key == author_key)
            )
        ).all()
    )
    votes = list(db.scalars(select(VenueTipVote).where(VenueTipVote.author_key == author_key)).all())
    for vote in votes:
        if vote.recommendation_id in own_tip_ids or vote.hidden_at is not None:
            continue
        tip = db.get(VenueRecommendation, vote.recommendation_id)
        if tip is None:
            continue
        if vote.choice == "up":
            tip.upvotes = max(0, int(tip.upvotes or 0) - 1)
        elif vote.choice == "down":
            tip.downvotes = max(0, int(tip.downvotes or 0) - 1)
    if own_tip_ids:
        db.execute(delete(VenueTipVote).where(VenueTipVote.recommendation_id.in_(own_tip_ids)))
        db.execute(delete(VenueRecommendation).where(VenueRecommendation.id.in_(own_tip_ids)))
    db.execute(delete(VenueTipVote).where(VenueTipVote.author_key == author_key))
    db.execute(delete(VenueRating).where(or_(VenueRating.user_id == user_id, VenueRating.author_key == author_key)))
    db.execute(delete(UserCalendar).where(UserCalendar.user_id == user.id))
    db.execute(delete(UserHomeAddress).where(UserHomeAddress.user_id == user.id))
    db.execute(delete(UserFavorite).where(UserFavorite.user_id == user.id))
    db.execute(delete(AppSession).where(AppSession.user_id == user.id))
    db.execute(delete(AuthIdentity).where(AuthIdentity.user_id == user.id))
    db.delete(user)
    db.commit()
