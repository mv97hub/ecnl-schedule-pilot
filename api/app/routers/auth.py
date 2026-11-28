from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth import (
    TERMS_VERSION,
    bearer_token,
    delete_account,
    has_current_terms,
    logout,
    open_identity,
    providers_for,
    require_bearer,
    require_internal,
    require_user,
)
from app.provider_tokens import ProviderTokenError, verify_identity_token
from app.database import get_session
from app.favorites import read_favorites, replace_favorites
from app.models import AppUser
from app.profile import (
    clear_calendar,
    clear_home_address,
    read_calendars,
    read_home_address,
    save_calendar,
    save_home_address,
)
from app.weekend import WeekendMapOut, weekend_map

router = APIRouter(tags=["auth"])


class SessionIn(BaseModel):
    provider: Literal["google", "apple"]
    subject: str = Field(min_length=1, max_length=255)
    email: str | None = Field(default=None, max_length=254)
    email_verified: bool = False
    display_name: str | None = Field(default=None, max_length=80)
    client: Literal["web", "ios", "android"] = "web"
    terms_version: str | None = Field(default=None, max_length=32)


class UserOut(BaseModel):
    id: int
    display_name: str
    email: str | None
    providers: list[str]


class SessionOut(BaseModel):
    token: str
    user: UserOut


class ProviderIn(BaseModel):
    provider: Literal["google", "apple"]
    identity_token: str = Field(min_length=20, max_length=20000)
    nonce: str | None = Field(default=None, max_length=256)
    display_name: str | None = Field(default=None, max_length=80)
    client: str = Field(min_length=1, max_length=32)


class MeOut(BaseModel):
    id: int
    display_name: str
    email: str | None
    providers: list[str]
    club_id: str | None
    team_ids: list[int]


class FavoritesIn(BaseModel):
    club_id: str | None = None
    team_ids: list[int] = Field(default_factory=list)


class HomeAddressIn(BaseModel):
    street: str = Field(default="", max_length=200)
    unit: str = Field(default="", max_length=80)
    city: str = Field(default="", max_length=120)
    state: str = Field(default="", max_length=8)
    postal_code: str = Field(default="", max_length=32)


class CalendarIn(BaseModel):
    team_id: int
    source: str = Field(min_length=1, max_length=32)
    url: str = Field(min_length=1, max_length=2000)


class TermsIn(BaseModel):
    version: str = Field(min_length=1, max_length=32)


def _auth_me_body(db: Session, user: AppUser) -> dict[str, object]:
    """The existing account fields, plus `home_address` only when one is saved."""

    body: dict[str, object] = {
        "id": int(user.id),
        "display_name": user.display_name,
        "email": user.email,
        "providers": providers_for(db, int(user.id)),
        "terms_accepted": has_current_terms(user),
    }
    address = read_home_address(db, int(user.id))
    if address is not None:
        body["home_address"] = address
    return body


def _me_out(db: Session, user: AppUser) -> MeOut:
    club_id, team_ids = read_favorites(db, int(user.id))
    return MeOut(
        id=int(user.id),
        display_name=user.display_name,
        email=user.email,
        providers=providers_for(db, int(user.id)),
        club_id=club_id,
        team_ids=team_ids,
    )


def _optional_name(value: str | None) -> str | None:
    text = " ".join((value or "").split())
    if not text or "@" in text:
        return None
    return text[:80]


def _user_out(db: Session, user: AppUser) -> UserOut:
    return UserOut(
        id=user.id,
        display_name=user.display_name,
        email=user.email,
        providers=providers_for(db, user.id),
    )


@router.post("/auth/session", response_model=SessionOut)
def create_session(
    body: SessionIn,
    session: Annotated[Session, Depends(get_session)],
    _: Annotated[None, Depends(require_internal)],
) -> SessionOut:
    """Open a session. A current terms version is stored in that same save."""

    if body.terms_version is not None and body.terms_version != TERMS_VERSION:
        raise HTTPException(status_code=400, detail="Terms version is not current")
    user, raw = open_identity(
        session,
        provider=body.provider,
        subject=body.subject,
        email=body.email,
        email_verified=body.email_verified,
        display_name=body.display_name,
        client=body.client,
        accept_terms=body.terms_version == TERMS_VERSION,
    )
    return SessionOut(token=raw, user=_user_out(session, user))


@router.post("/auth/terms")
def accept_terms(
    body: TermsIn,
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
) -> dict[str, object]:
    """Record agreement to the current terms. The same version again leaves the timestamp as it is."""

    if body.version != TERMS_VERSION:
        raise HTTPException(status_code=400, detail="Terms version is not current")
    user = require_user(session, token)
    if not has_current_terms(user):
        user.terms_accepted_at = datetime.now(UTC)
        user.terms_version = TERMS_VERSION
        session.commit()
        session.refresh(user)
    return _auth_me_body(session, user)


@router.post("/auth/provider", response_model=SessionOut)
def create_provider_session(
    body: ProviderIn,
    session: Annotated[Session, Depends(get_session)],
) -> SessionOut:
    """Phone sign-in. The website stays on ``POST /auth/session`` and its internal secret."""

    client = body.client.strip().lower()
    if client == "web":
        raise HTTPException(status_code=400, detail="client must be ios or android")
    if client not in {"ios", "android"}:
        raise HTTPException(status_code=400, detail="client must be ios or android")
    if body.provider == "apple" and not (body.nonce or "").strip():
        raise HTTPException(status_code=400, detail="nonce is required for Apple")
    try:
        verified = verify_identity_token(
            provider=body.provider,
            identity_token=body.identity_token,
            nonce=body.nonce,
        )
    except ProviderTokenError as exc:
        if exc.unavailable:
            raise HTTPException(status_code=503, detail="Sign-in could not be verified") from None
        raise HTTPException(status_code=401, detail="Sign-in could not be verified") from None
    name = verified.display_name or _optional_name(body.display_name)
    user, raw = open_identity(
        session,
        provider=body.provider,
        subject=verified.subject,
        email=verified.email,
        email_verified=verified.email_verified,
        display_name=name,
        client=client,
    )
    return SessionOut(token=raw, user=_user_out(session, user))


@router.get("/auth/me")
def current_user(
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
) -> dict[str, object]:
    user = require_user(session, token)
    return _auth_me_body(session, user)


@router.post("/auth/logout")
def end_session(
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str | None, Depends(bearer_token)],
) -> dict[str, bool]:
    if token:
        logout(session, token)
    return {"ok": True}


@router.get("/me/weekend", response_model=WeekendMapOut)
def read_weekend_map(
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
) -> WeekendMapOut:
    """Coming-month games for the signed-in family. Reads stored field pins and does not look any up."""

    user = require_user(session, token)
    if user.id is None:
        raise HTTPException(status_code=401, detail="Sign in required")
    return weekend_map(session, int(user.id))


@router.get("/me", response_model=MeOut)
def read_me(
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
) -> MeOut:
    user = require_user(session, token)
    return _me_out(session, user)


@router.put("/me/favorites", response_model=MeOut)
def save_favorites(
    body: FavoritesIn,
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
) -> MeOut:
    user = require_user(session, token)
    replace_favorites(session, int(user.id), body.club_id, body.team_ids)
    return _me_out(session, user)


@router.put("/me/home-address")
def put_home_address(
    body: HomeAddressIn,
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
) -> dict[str, object]:
    user = require_user(session, token)
    save_home_address(
        session,
        int(user.id),
        street=body.street,
        unit=body.unit,
        city=body.city,
        state=body.state,
        postal_code=body.postal_code,
    )
    return _auth_me_body(session, user)


@router.delete("/me/home-address")
def delete_home_address(
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
) -> dict[str, bool]:
    user = require_user(session, token)
    clear_home_address(session, int(user.id))
    return {"ok": True}


@router.get("/me/calendars")
def list_calendars(
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
) -> dict[str, object]:
    user = require_user(session, token)
    return {"calendars": read_calendars(session, int(user.id))}


@router.put("/me/calendars")
def put_calendar(
    body: CalendarIn,
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
) -> dict[str, object]:
    user = require_user(session, token)
    return save_calendar(session, int(user.id), team_id=body.team_id, source=body.source, url=body.url)


@router.delete("/me/calendars/{team_id}")
def delete_calendar(
    team_id: int,
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
) -> dict[str, bool]:
    user = require_user(session, token)
    clear_calendar(session, int(user.id), team_id)
    return {"ok": True}


@router.delete("/auth/account")
def remove_account(
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
) -> dict[str, bool]:
    user = require_user(session, token)
    if user.id is None:
        raise HTTPException(status_code=401, detail="Sign in required")
    delete_account(session, user)
    return {"ok": True}
