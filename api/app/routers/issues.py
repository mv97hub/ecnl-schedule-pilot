from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_admin, require_bearer
from app.database import get_session
from app.issues import claim_issue_slot, clean_issue, client_ip, utc_now
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


class IssueStatusUpdate(BaseModel):
    done: bool


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


@router.get("/admin/issues", response_model=list[IssueOut])
def list_issues(
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
    status: Literal["open", "done"] = "open",
) -> list[Issue]:
    require_admin(session, token)
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
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
) -> Issue:
    require_admin(session, token)
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
