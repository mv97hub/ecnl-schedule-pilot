from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth import (
    bearer_token,
    delete_account,
    logout,
    open_identity,
    providers_for,
    require_bearer,
    require_internal,
    require_user,
)
from app.database import get_session
from app.models import AppUser

router = APIRouter(tags=["auth"])


class SessionIn(BaseModel):
    provider: Literal["google", "apple"]
    subject: str = Field(min_length=1, max_length=255)
    email: str | None = Field(default=None, max_length=254)
    email_verified: bool = False
    display_name: str | None = Field(default=None, max_length=80)
    client: Literal["web", "ios", "android"] = "web"


class UserOut(BaseModel):
    id: int
    display_name: str
    email: str | None
    providers: list[str]


class SessionOut(BaseModel):
    token: str
    user: UserOut


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
    user, raw = open_identity(
        session,
        provider=body.provider,
        subject=body.subject,
        email=body.email,
        email_verified=body.email_verified,
        display_name=body.display_name,
        client=body.client,
    )
    return SessionOut(token=raw, user=_user_out(session, user))


@router.get("/auth/me", response_model=UserOut)
def current_user(
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
) -> UserOut:
    user = require_user(session, token)
    return _user_out(session, user)


@router.post("/auth/logout")
def end_session(
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str | None, Depends(bearer_token)],
) -> dict[str, bool]:
    if token:
        logout(session, token)
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
