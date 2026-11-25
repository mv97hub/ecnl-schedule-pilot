"""Admin read of location rating, tip, and vote history. Newest first."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.auth import require_admin, require_bearer
from app.database import get_session
from app.models import LocationWriteEvent, VenueRating, VenueRecommendation, VenueTipVote

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


def _voter_id(author_key: str) -> int | None:
    prefix = "user:"
    if not author_key.startswith(prefix):
        return None
    text_id = author_key[len(prefix) :]
    if not text_id.isdigit():
        return None
    return int(text_id)


def _vote_event_matches(row: LocationWriteEvent, vote_id: int, choice: str, voter_id: int | None) -> bool:
    """One vote's rows. Newer rows store vote_id. Older rows match the voter, then the choice."""

    stored_ids: list[object] = []
    for payload in (row.previous_values, row.new_values):
        if isinstance(payload, dict) and "vote_id" in payload:
            stored_ids.append(payload.get("vote_id"))
    if stored_ids:
        return vote_id in stored_ids
    if row.action in ("create", "update") and voter_id is not None:
        return row.user_id == voter_id
    new = row.new_values if isinstance(row.new_values, dict) else {}
    return new.get("choice") == choice


@router.get("/admin/contributions/{kind}/{item_id}/history", response_model=list[HistoryOut])
def contribution_history(
    kind: str,
    item_id: int,
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
) -> list[HistoryOut]:
    """First submission, later edits, hides, and restores for one rating, tip, or vote. Oldest first."""

    require_admin(session, token)
    chosen = kind.strip().lower()
    if chosen not in KINDS:
        raise HTTPException(status_code=400, detail="kind must be rating, tip, or vote")
    if chosen == "rating":
        if session.get(VenueRating, item_id) is None:
            raise HTTPException(status_code=404, detail="Contribution not found")
        statement = select(LocationWriteEvent).where(
            LocationWriteEvent.kind == "rating",
            LocationWriteEvent.rating_id == item_id,
        )
    elif chosen == "tip":
        if session.get(VenueRecommendation, item_id) is None:
            raise HTTPException(status_code=404, detail="Contribution not found")
        statement = select(LocationWriteEvent).where(
            LocationWriteEvent.kind == "tip",
            LocationWriteEvent.tip_id == item_id,
        )
    else:
        vote = session.get(VenueTipVote, item_id)
        if vote is None:
            raise HTTPException(status_code=404, detail="Contribution not found")
        voter_id = _voter_id(vote.author_key)
        rows = list(
            session.scalars(
                select(LocationWriteEvent)
                .where(LocationWriteEvent.kind == "vote", LocationWriteEvent.tip_id == vote.recommendation_id)
                .order_by(LocationWriteEvent.created_at.asc(), LocationWriteEvent.id.asc())
            ).all()
        )
        return [_out(row) for row in rows if _vote_event_matches(row, int(vote.id), vote.choice, voter_id)]
    statement = statement.order_by(LocationWriteEvent.created_at.asc(), LocationWriteEvent.id.asc())
    return [_out(row) for row in session.scalars(statement).all()]
