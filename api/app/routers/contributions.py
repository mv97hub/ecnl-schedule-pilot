"""Admin review of current ratings, tips, and votes. Newest first, one page at a time."""

from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import Boolean, Integer, String, Text, cast, false, func, literal, or_, select, union_all
from sqlalchemy.orm import Session

from app.auth import require_admin, require_bearer
from app.database import get_session
from app.models import AppUser, ContentFlag, LocationWriteEvent, VenueRating, VenueRecommendation, VenueTipVote

router = APIRouter(tags=["contributions"])

PAGE_SIZE = 50
KINDS = frozenset({"rating", "tip", "vote"})
HIDDEN = frozenset({"", "hidden", "visible"})
FLAGGED = frozenset({"", "flagged", "unflagged"})


class ContributionOut(BaseModel):
    kind: Literal["rating", "tip", "vote"]
    id: int
    at: datetime
    venue_key: str
    venue_name: str
    display_name: str
    email: str | None
    score: str
    comment: str | None
    flagged: bool
    status: Literal["visible", "hidden", "auto_flagged", "reenabled"]


class ContributionPage(BaseModel):
    page: int
    total: int
    rows: list[ContributionOut]


class AdminFlagOut(BaseModel):
    id: int
    venue_name: str
    comment: str
    author_name: str
    author_email: str | None
    auto_hidden_at: datetime | None
    reporter_emails: list[str]
    status: Literal["visible", "hidden", "auto_flagged", "reenabled"]


class AdminFlagPage(BaseModel):
    state: Literal["hidden", "reenabled"]
    rows: list[AdminFlagOut]


def _like(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped.lower()}%"


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _kind(value: str) -> str:
    chosen = value.strip().lower()
    if chosen not in KINDS:
        raise HTTPException(status_code=400, detail="kind must be rating, tip, or vote")
    return chosen


def _null_int():
    return cast(literal(None), Integer)


def _null_text():
    return cast(literal(None), Text)


def _user_by_id(session: Session, user_id: str | None) -> AppUser | None:
    if not user_id or not user_id.isdigit():
        return None
    return session.get(AppUser, int(user_id))


def _user_by_author_key(session: Session, author_key: str) -> AppUser | None:
    prefix = "user:"
    if not author_key.startswith(prefix):
        return None
    return _user_by_id(session, author_key[len(prefix) :])


def _status(hidden_at: datetime | None) -> Literal["visible", "hidden"]:
    return "hidden" if hidden_at is not None else "visible"


def _tip_status(row: VenueRecommendation) -> Literal["visible", "hidden", "auto_flagged", "reenabled"]:
    hidden = row.hidden_at is not None
    auto_hidden = row.auto_hidden_at is not None
    accepted = row.accepted_at is not None
    if hidden and auto_hidden and not accepted:
        return "auto_flagged"
    if hidden:
        return "hidden"
    if accepted:
        return "reenabled"
    return "visible"


def _listed_status(kind: str, hidden: bool, auto_hidden: bool, accepted: bool) -> Literal["visible", "hidden", "auto_flagged", "reenabled"]:
    if kind == "tip":
        if hidden and auto_hidden and not accepted:
            return "auto_flagged"
        if hidden:
            return "hidden"
        if accepted:
            return "reenabled"
        return "visible"
    return "hidden" if hidden else "visible"


def _rating_score(row: VenueRating) -> str:
    overall = (row.field_quality + row.referees + row.parent_vibe + row.parking_access + row.amenities) / 5
    return f"{overall:.2f}"


def _rating_out(row: VenueRating, user: AppUser | None) -> ContributionOut:
    return ContributionOut(
        kind="rating",
        id=row.id,
        at=_utc(row.updated_at),
        venue_key=row.venue_key,
        venue_name=row.venue_name,
        display_name=(user.display_name if user is not None else None) or row.author_name or "ECNL Family",
        email=None if user is None else user.email,
        score=_rating_score(row),
        comment=row.comment,
        flagged=row.flagged_at is not None,
        status=_status(row.hidden_at),
    )


def _tip_out(row: VenueRecommendation, user: AppUser | None) -> ContributionOut:
    return ContributionOut(
        kind="tip",
        id=row.id,
        at=_utc(row.created_at),
        venue_key=row.venue_key,
        venue_name=row.venue_name,
        display_name=(user.display_name if user is not None else None) or row.author_name or "ECNL Family",
        email=None if user is None else user.email,
        score=str(row.rating),
        comment=row.review_text,
        flagged=row.flagged_at is not None,
        status=_tip_status(row),
    )


def _vote_out(row: VenueTipVote, tip: VenueRecommendation, user: AppUser | None) -> ContributionOut:
    return ContributionOut(
        kind="vote",
        id=row.id,
        at=_utc(row.updated_at),
        venue_key=tip.venue_key,
        venue_name=tip.venue_name,
        display_name=(user.display_name if user is not None else None) or "ECNL Family",
        email=None if user is None else user.email,
        score=row.choice,
        comment=None,
        flagged=row.flagged_at is not None,
        status=_status(row.hidden_at),
    )


def _append(
    session: Session,
    admin: AppUser,
    *,
    kind: str,
    venue_key: str,
    venue_name: str,
    rating_id: int | None,
    tip_id: int | None,
    action: str,
    previous: dict[str, object],
    new: dict[str, object],
) -> None:
    session.add(
        LocationWriteEvent(
            created_at=datetime.now(UTC),
            user_id=int(admin.id),
            email=admin.email,
            display_name=admin.display_name,
            kind=kind,
            venue_key=venue_key,
            venue_name=venue_name,
            rating_id=rating_id,
            tip_id=tip_id,
            action=action,
            previous_values=previous,
            new_values=new,
        )
    )


def _add_choice(tip: VenueRecommendation, choice: str) -> None:
    if choice == "up":
        tip.upvotes = int(tip.upvotes or 0) + 1
    else:
        tip.downvotes = int(tip.downvotes or 0) + 1


def _remove_choice(tip: VenueRecommendation, choice: str) -> None:
    if choice == "up":
        tip.upvotes = max(0, int(tip.upvotes or 0) - 1)
    else:
        tip.downvotes = max(0, int(tip.downvotes or 0) - 1)


def _apply_filters(statement, *, venue_key, venue_name, email_column, hidden_column, flagged_column, venue: str, email: str, hidden: str, flagged: str):
    if venue:
        needle = _like(venue)
        statement = statement.where(or_(venue_key.ilike(needle, escape="\\"), venue_name.ilike(needle, escape="\\")))
    if email:
        statement = statement.where(email_column.ilike(_like(email), escape="\\"))
    if hidden == "hidden":
        statement = statement.where(hidden_column.is_not(None))
    elif hidden == "visible":
        statement = statement.where(hidden_column.is_(None))
    if flagged == "flagged":
        statement = statement.where(flagged_column.is_not(None))
    elif flagged == "unflagged":
        statement = statement.where(flagged_column.is_(None))
    return statement


def _rating_select(venue: str, email: str, hidden: str, flagged: str):
    statement = (
        select(
            literal("rating").label("kind"),
            VenueRating.id.label("item_id"),
            VenueRating.updated_at.label("at"),
            VenueRating.venue_key.label("venue_key"),
            VenueRating.venue_name.label("venue_name"),
            func.coalesce(AppUser.display_name, VenueRating.author_name, literal("ECNL Family")).label("display_name"),
            AppUser.email.label("email"),
            VenueRating.comment.label("comment"),
            VenueRating.field_quality.label("field_quality"),
            VenueRating.referees.label("referees"),
            VenueRating.parent_vibe.label("parent_vibe"),
            VenueRating.parking_access.label("parking_access"),
            VenueRating.amenities.label("amenities"),
            _null_int().label("tip_rating"),
            _null_text().label("vote_choice"),
            VenueRating.flagged_at.is_not(None).label("flagged"),
            VenueRating.hidden_at.is_not(None).label("hidden"),
            cast(false(), Boolean).label("auto_hidden"),
            cast(false(), Boolean).label("accepted"),
        )
        .select_from(VenueRating)
        .outerjoin(AppUser, VenueRating.user_id == cast(AppUser.id, String))
    )
    return _apply_filters(
        statement,
        venue_key=VenueRating.venue_key,
        venue_name=VenueRating.venue_name,
        email_column=AppUser.email,
        hidden_column=VenueRating.hidden_at,
        flagged_column=VenueRating.flagged_at,
        venue=venue,
        email=email,
        hidden=hidden,
        flagged=flagged,
    )


def _tip_select(venue: str, email: str, hidden: str, flagged: str):
    statement = (
        select(
            literal("tip").label("kind"),
            VenueRecommendation.id.label("item_id"),
            VenueRecommendation.created_at.label("at"),
            VenueRecommendation.venue_key.label("venue_key"),
            VenueRecommendation.venue_name.label("venue_name"),
            func.coalesce(AppUser.display_name, VenueRecommendation.author_name, literal("ECNL Family")).label("display_name"),
            AppUser.email.label("email"),
            VenueRecommendation.review_text.label("comment"),
            _null_int().label("field_quality"),
            _null_int().label("referees"),
            _null_int().label("parent_vibe"),
            _null_int().label("parking_access"),
            _null_int().label("amenities"),
            VenueRecommendation.rating.label("tip_rating"),
            _null_text().label("vote_choice"),
            VenueRecommendation.flagged_at.is_not(None).label("flagged"),
            VenueRecommendation.hidden_at.is_not(None).label("hidden"),
            VenueRecommendation.auto_hidden_at.is_not(None).label("auto_hidden"),
            VenueRecommendation.accepted_at.is_not(None).label("accepted"),
        )
        .select_from(VenueRecommendation)
        .outerjoin(AppUser, VenueRecommendation.user_id == cast(AppUser.id, String))
    )
    return _apply_filters(
        statement,
        venue_key=VenueRecommendation.venue_key,
        venue_name=VenueRecommendation.venue_name,
        email_column=AppUser.email,
        hidden_column=VenueRecommendation.hidden_at,
        flagged_column=VenueRecommendation.flagged_at,
        venue=venue,
        email=email,
        hidden=hidden,
        flagged=flagged,
    )


def _vote_select(venue: str, email: str, hidden: str, flagged: str):
    statement = (
        select(
            literal("vote").label("kind"),
            VenueTipVote.id.label("item_id"),
            VenueTipVote.updated_at.label("at"),
            VenueRecommendation.venue_key.label("venue_key"),
            VenueRecommendation.venue_name.label("venue_name"),
            func.coalesce(AppUser.display_name, literal("ECNL Family")).label("display_name"),
            AppUser.email.label("email"),
            _null_text().label("comment"),
            _null_int().label("field_quality"),
            _null_int().label("referees"),
            _null_int().label("parent_vibe"),
            _null_int().label("parking_access"),
            _null_int().label("amenities"),
            _null_int().label("tip_rating"),
            VenueTipVote.choice.label("vote_choice"),
            VenueTipVote.flagged_at.is_not(None).label("flagged"),
            VenueTipVote.hidden_at.is_not(None).label("hidden"),
            cast(false(), Boolean).label("auto_hidden"),
            cast(false(), Boolean).label("accepted"),
        )
        .select_from(VenueTipVote)
        .join(VenueRecommendation, VenueTipVote.recommendation_id == VenueRecommendation.id)
        .outerjoin(AppUser, VenueTipVote.author_key == func.concat(literal("user:"), cast(AppUser.id, String)))
    )
    return _apply_filters(
        statement,
        venue_key=VenueRecommendation.venue_key,
        venue_name=VenueRecommendation.venue_name,
        email_column=AppUser.email,
        hidden_column=VenueTipVote.hidden_at,
        flagged_column=VenueTipVote.flagged_at,
        venue=venue,
        email=email,
        hidden=hidden,
        flagged=flagged,
    )


def _score(row) -> str:
    if row.kind == "rating":
        overall = (row.field_quality + row.referees + row.parent_vibe + row.parking_access + row.amenities) / 5
        return f"{overall:.2f}"
    if row.kind == "tip":
        return str(int(row.tip_rating))
    return str(row.vote_choice)


def _row_out(row) -> ContributionOut:
    return ContributionOut(
        kind=row.kind,
        id=int(row.item_id),
        at=_utc(row.at),
        venue_key=row.venue_key,
        venue_name=row.venue_name,
        display_name=row.display_name or "ECNL Family",
        email=row.email,
        score=_score(row),
        comment=row.comment,
        flagged=bool(row.flagged),
        status=_listed_status(row.kind, bool(row.hidden), bool(row.auto_hidden), bool(row.accepted)),
    )


@router.get("/admin/contributions", response_model=ContributionPage)
def list_contributions(
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
    kind: Annotated[str | None, Query(description="rating, tip, or vote")] = None,
    venue: Annotated[str | None, Query(description="Venue name or venue key")] = None,
    email: Annotated[str | None, Query(description="Account email")] = None,
    hidden: Annotated[str | None, Query(description="hidden, visible, or all")] = None,
    flagged: Annotated[str | None, Query(description="flagged, unflagged, or all")] = None,
    page: Annotated[int, Query(ge=1)] = 1,
) -> ContributionPage:
    """One page of current rows. History events are not included. The total is the filtered count, not the page length."""

    require_admin(session, token)
    chosen = (kind or "").strip().lower()
    if chosen and chosen not in KINDS:
        raise HTTPException(status_code=400, detail="kind must be rating, tip, or vote")
    hidden_value = (hidden or "").strip().lower()
    flagged_value = (flagged or "").strip().lower()
    if hidden_value not in HIDDEN:
        raise HTTPException(status_code=400, detail="hidden must be hidden or visible")
    if flagged_value not in FLAGGED:
        raise HTTPException(status_code=400, detail="flagged must be flagged or unflagged")
    venue_text = (venue or "").strip()
    email_text = (email or "").strip()
    parts = []
    if chosen in ("", "rating"):
        parts.append(_rating_select(venue_text, email_text, hidden_value, flagged_value))
    if chosen in ("", "tip"):
        parts.append(_tip_select(venue_text, email_text, hidden_value, flagged_value))
    if chosen in ("", "vote"):
        parts.append(_vote_select(venue_text, email_text, hidden_value, flagged_value))
    combined = union_all(*parts).subquery()
    total = int(session.scalar(select(func.count()).select_from(combined)) or 0)
    offset = (page - 1) * PAGE_SIZE
    fetched = session.execute(
        select(combined)
        .order_by(combined.c.at.desc(), combined.c.item_id.desc(), combined.c.kind.desc())
        .offset(offset)
        .limit(PAGE_SIZE)
    ).all()
    return ContributionPage(page=page, total=total, rows=[_row_out(row) for row in fetched])


def _load_rating(session: Session, item_id: int) -> VenueRating:
    row = session.scalar(select(VenueRating).where(VenueRating.id == item_id).with_for_update())
    if row is None:
        raise HTTPException(status_code=404, detail="Contribution not found")
    return row


def _load_tip(session: Session, item_id: int) -> VenueRecommendation:
    row = session.scalar(select(VenueRecommendation).where(VenueRecommendation.id == item_id).with_for_update())
    if row is None:
        raise HTTPException(status_code=404, detail="Contribution not found")
    return row


def _load_vote(session: Session, item_id: int) -> VenueTipVote:
    row = session.scalar(select(VenueTipVote).where(VenueTipVote.id == item_id).with_for_update())
    if row is None:
        raise HTTPException(status_code=404, detail="Contribution not found")
    return row


def _set_hidden(session: Session, admin: AppUser, kind: str, item_id: int, hide: bool) -> ContributionOut:
    action = "hide" if hide else "restore"
    if kind == "rating":
        row = _load_rating(session, item_id)
        already = row.hidden_at is not None
        if already != hide:
            _append(
                session,
                admin,
                kind="rating",
                venue_key=row.venue_key,
                venue_name=row.venue_name,
                rating_id=row.id,
                tip_id=None,
                action=action,
                previous={"comment": row.comment, "hidden": already},
                new={"comment": row.comment, "hidden": hide},
            )
            row.hidden_at = datetime.now(UTC) if hide else None
        payload = _rating_out(row, _user_by_id(session, row.user_id))
    elif kind == "tip":
        row = _load_tip(session, item_id)
        if not hide and row.auto_hidden_at is not None and row.accepted_at is None:
            raise HTTPException(status_code=409, detail="Mark this tip acceptable to show it again")
        already = row.hidden_at is not None
        if already != hide:
            _append(
                session,
                admin,
                kind="tip",
                venue_key=row.venue_key,
                venue_name=row.venue_name,
                rating_id=None,
                tip_id=row.id,
                action=action,
                previous={"review_text": row.review_text, "hidden": already},
                new={"review_text": row.review_text, "hidden": hide},
            )
            row.hidden_at = datetime.now(UTC) if hide else None
        payload = _tip_out(row, _user_by_id(session, row.user_id))
    else:
        vote = _load_vote(session, item_id)
        tip = session.scalar(
            select(VenueRecommendation).where(VenueRecommendation.id == vote.recommendation_id).with_for_update()
        )
        if tip is None:
            raise HTTPException(status_code=404, detail="Contribution not found")
        already = vote.hidden_at is not None
        if already != hide:
            if hide:
                _remove_choice(tip, vote.choice)
            else:
                _add_choice(tip, vote.choice)
            _append(
                session,
                admin,
                kind="vote",
                venue_key=tip.venue_key,
                venue_name=tip.venue_name,
                rating_id=None,
                tip_id=tip.id,
                action=action,
                previous={"choice": vote.choice, "hidden": already, "vote_id": vote.id},
                new={"choice": vote.choice, "hidden": hide, "vote_id": vote.id},
            )
            vote.hidden_at = datetime.now(UTC) if hide else None
            vote.updated_at = datetime.now(UTC)
        payload = _vote_out(vote, tip, _user_by_author_key(session, vote.author_key))
    session.commit()
    return payload


@router.post("/admin/contributions/{kind}/{item_id}/hide", response_model=ContributionOut)
def hide_contribution(
    kind: str,
    item_id: int,
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
) -> ContributionOut:
    admin = require_admin(session, token)
    return _set_hidden(session, admin, _kind(kind), item_id, True)


@router.post("/admin/contributions/{kind}/{item_id}/restore", response_model=ContributionOut)
def restore_contribution(
    kind: str,
    item_id: int,
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
) -> ContributionOut:
    admin = require_admin(session, token)
    return _set_hidden(session, admin, _kind(kind), item_id, False)


@router.post("/admin/contributions/{kind}/{item_id}/edit")
def edit_contribution(
    kind: str,
    item_id: int,
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
) -> None:
    """Closed. A saved request does not change comment, review_text, or edited_at."""

    require_admin(session, token)
    _ = (kind, item_id)
    raise HTTPException(status_code=405, detail="Comments cannot be rewritten")


@router.post("/admin/contributions/tip/{item_id}/accept", response_model=ContributionOut)
def accept_contribution(
    item_id: int,
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
) -> ContributionOut:
    """Show an auto-hidden tip again. The words stay. Later reports do not hide it."""

    admin = require_admin(session, token)
    row = _load_tip(session, item_id)
    if row.accepted_at is not None and row.hidden_at is None:
        return _tip_out(row, _user_by_id(session, row.user_id))
    if row.accepted_at is not None and row.hidden_at is not None:
        raise HTTPException(status_code=409, detail="Use restore for an admin hide")
    hidden = row.hidden_at is not None
    _append(
        session,
        admin,
        kind="tip",
        venue_key=row.venue_key,
        venue_name=row.venue_name,
        rating_id=None,
        tip_id=row.id,
        action="accept",
        previous={"review_text": row.review_text, "hidden": hidden},
        new={"review_text": row.review_text, "hidden": False},
    )
    row.hidden_at = None
    row.accepted_at = datetime.now(UTC)
    session.commit()
    return _tip_out(row, _user_by_id(session, row.user_id))


def _reporter_emails(session: Session, tip_ids: list[int]) -> dict[int, list[str]]:
    if not tip_ids:
        return {}
    rows = session.execute(
        select(ContentFlag.target_id, AppUser.email)
        .join(AppUser, AppUser.id == ContentFlag.user_id)
        .where(ContentFlag.kind == "tip", ContentFlag.target_id.in_(tip_ids))
        .order_by(ContentFlag.created_at, ContentFlag.id)
    ).all()
    grouped: dict[int, list[str]] = {}
    for target_id, email in rows:
        grouped.setdefault(int(target_id), []).append(email or "No email")
    return grouped


@router.get("/admin/flags", response_model=AdminFlagPage)
def list_flags(
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
    state: Annotated[str | None, Query(description="hidden or reenabled")] = None,
) -> AdminFlagPage:
    """Tips that reached two reports. Hidden means auto-hidden and not yet accepted."""

    require_admin(session, token)
    chosen = (state or "").strip().lower()
    if chosen not in {"hidden", "reenabled"}:
        raise HTTPException(status_code=400, detail="state must be hidden or reenabled")
    report_count = (
        select(func.count(ContentFlag.id))
        .where(ContentFlag.kind == "tip", ContentFlag.target_id == VenueRecommendation.id)
        .correlate(VenueRecommendation)
        .scalar_subquery()
    )
    reached = or_(VenueRecommendation.auto_hidden_at.is_not(None), report_count >= 2)
    statement = select(VenueRecommendation).where(reached)
    if chosen == "hidden":
        statement = statement.where(
            VenueRecommendation.auto_hidden_at.is_not(None),
            VenueRecommendation.accepted_at.is_(None),
        )
    else:
        statement = statement.where(VenueRecommendation.accepted_at.is_not(None))
    statement = statement.order_by(
        VenueRecommendation.auto_hidden_at.desc().nulls_last(),
        VenueRecommendation.id.desc(),
    )
    tips = list(session.scalars(statement).all())
    emails = _reporter_emails(session, [int(row.id) for row in tips])
    rows = []
    for row in tips:
        user = _user_by_id(session, row.user_id)
        rows.append(
            AdminFlagOut(
                id=int(row.id),
                venue_name=row.venue_name,
                comment=row.review_text,
                author_name=(user.display_name if user is not None else None) or row.author_name or "ECNL Family",
                author_email=None if user is None else user.email,
                auto_hidden_at=None if row.auto_hidden_at is None else _utc(row.auto_hidden_at),
                reporter_emails=emails.get(int(row.id), []),
                status=_tip_status(row),
            )
        )
    return AdminFlagPage(state=chosen, rows=rows)  # type: ignore[arg-type]
