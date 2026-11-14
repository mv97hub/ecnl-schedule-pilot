from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_session
from app.issues import (
    SESSION_COOKIE,
    SESSION_MAX_AGE,
    SESSION_PATH,
    admin_password,
    claim_issue_slot,
    clean_issue,
    client_ip,
    cookie_secure,
    issue_session,
    passwords_match,
    require_admin,
    utc_now,
)
from app.models import Issue

router = APIRouter()


class IssueOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    category: str
    description: str
    email: str | None
    app_version: str
    screen: str
    status: str
    completed_at: datetime | None


class IssueCreate(BaseModel):
    category: str
    description: str
    email: str | None = None
    app_version: str
    screen: str


class AdminLogin(BaseModel):
    password: str


class IssueStatusUpdate(BaseModel):
    done: bool


def _set_session_cookie(response: Response, request: Request, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=cookie_secure(request),
        path=SESSION_PATH,
    )


def _clear_session_cookie(response: Response, request: Request) -> None:
    response.delete_cookie(key=SESSION_COOKIE, path=SESSION_PATH, httponly=True, samesite="lax", secure=cookie_secure(request))


@router.post("/issues", response_model=IssueOut, status_code=201)
def create_issue(body: IssueCreate, request: Request, session: Annotated[Session, Depends(get_session)]) -> Issue:
    fields = clean_issue(body.model_dump())
    retry_after = claim_issue_slot(client_ip(request))
    if retry_after is not None:
        raise HTTPException(
            status_code=429,
            detail="Too many reports from this network. Try again later.",
            headers={"Retry-After": str(retry_after)},
        )
    row = Issue(
        category=str(fields["category"]),
        description=str(fields["description"]),
        email=fields["email"],
        app_version=str(fields["app_version"]),
        screen=str(fields["screen"]),
        status="open",
        completed_at=None,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.post("/admin/login")
def login(body: AdminLogin, request: Request, response: Response) -> dict[str, bool]:
    secret = admin_password()
    if not passwords_match(body.password, secret):
        raise HTTPException(status_code=401, detail="Login failed")
    _set_session_cookie(response, request, issue_session(secret))
    return {"ok": True}


@router.post("/admin/logout")
def logout(request: Request, response: Response) -> dict[str, bool]:
    _clear_session_cookie(response, request)
    return {"ok": True}


@router.get("/admin/issues", response_model=list[IssueOut])
def list_issues(
    request: Request,
    session: Annotated[Session, Depends(get_session)],
    status: Literal["open", "done"] = "open",
) -> list[Issue]:
    require_admin(request)
    statement = select(Issue).where(Issue.status == status)
    if status == "done":
        statement = statement.order_by(Issue.completed_at.desc(), Issue.id.desc())
    else:
        statement = statement.order_by(Issue.created_at.desc(), Issue.id.desc())
    return list(session.scalars(statement).all())


@router.patch("/admin/issues/{issue_id}", response_model=IssueOut)
def update_issue(
    issue_id: int,
    body: IssueStatusUpdate,
    request: Request,
    session: Annotated[Session, Depends(get_session)],
) -> Issue:
    require_admin(request)
    row = session.get(Issue, issue_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Report not found")
    if body.done:
        row.status = "done"
        row.completed_at = utc_now()
    else:
        row.status = "open"
        row.completed_at = None
    session.add(row)
    session.commit()
    session.refresh(row)
    return row
