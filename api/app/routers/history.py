"""Admin read of location rating, tip, and vote history. Newest first."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.auth import require_admin, require_bearer
from app.database import get_session
from app.models import LocationWriteEvent

router = APIRouter(tags=["history"])

KINDS = frozenset({"rating", "tip", "vote"})


class HistoryOut(BaseModel):
    id: int
    created_at: datetime
    user_id: int
    email: str | None
    display_name: str
    kind: str
    venue_key: str
    venue_name: str
    rating_id: int | None
    tip_id: int | None
    action: str
    previous: dict | None
    new: dict


def _like(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped.lower()}%"


def _out(row: LocationWriteEvent) -> HistoryOut:
    previous = row.previous_values if isinstance(row.previous_values, dict) else None
    new = row.new_values if isinstance(row.new_values, dict) else {}
    return HistoryOut(
        id=row.id,
        created_at=row.created_at,
        user_id=row.user_id,
        email=row.email,
        display_name=row.display_name,
        kind=row.kind,
        venue_key=row.venue_key,
        venue_name=row.venue_name,
        rating_id=row.rating_id,
        tip_id=row.tip_id,
        action=row.action,
        previous=previous,
        new=new,
    )


@router.get("/admin/history", response_model=list[HistoryOut])
def list_history(
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
    kind: Annotated[str | None, Query(description="rating, tip, or vote")] = None,
    venue: Annotated[str | None, Query(description="Venue name or venue key")] = None,
    email: Annotated[str | None, Query(description="Email copied onto the history row")] = None,
) -> list[HistoryOut]:
    require_admin(session, token)
    chosen = (kind or "").strip().lower()
    if chosen and chosen not in KINDS:
        raise HTTPException(status_code=400, detail="kind must be rating, tip, or vote")
    statement = select(LocationWriteEvent)
    if chosen:
        statement = statement.where(LocationWriteEvent.kind == chosen)
    venue_text = (venue or "").strip()
    if venue_text:
        needle = _like(venue_text)
        statement = statement.where(
            or_(
                LocationWriteEvent.venue_key.ilike(needle, escape="\\"),
                LocationWriteEvent.venue_name.ilike(needle, escape="\\"),
            )
        )
    email_text = (email or "").strip()
    if email_text:
        statement = statement.where(LocationWriteEvent.email.ilike(_like(email_text), escape="\\"))
    statement = statement.order_by(LocationWriteEvent.created_at.desc(), LocationWriteEvent.id.desc())
    return [_out(row) for row in session.scalars(statement).all()]
