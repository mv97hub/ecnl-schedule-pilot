"""Admin list of accounts. Newest first, one page at a time.

Calendar links and session tokens are not part of this response.
"""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.auth import require_admin, require_bearer
from app.clubs import club_location_source
from app.database import get_session
from app.models import AppUser, AuthIdentity, ScheduleTeam, UserFavorite, UserHomeAddress

router = APIRouter(tags=["users"])

PAGE_SIZE = 50


class AdminAddressOut(BaseModel):
    street: str
    unit: str
    city: str
    state: str
    postal_code: str


class AdminUserOut(BaseModel):
    id: int
    display_name: str
    email: str | None
    providers: list[str]
    created_at: datetime
    last_login_at: datetime | None
    club: str | None
    teams: list[str]
    home_address: AdminAddressOut | None


class AdminUserPage(BaseModel):
    page: int
    total: int
    rows: list[AdminUserOut]


def _like(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped.lower()}%"


def _providers(session: Session, user_ids: list[int]) -> dict[int, list[str]]:
    found: dict[int, list[str]] = {user_id: [] for user_id in user_ids}
    if not user_ids:
        return found
    rows = session.execute(
        select(AuthIdentity.user_id, AuthIdentity.provider)
        .where(AuthIdentity.user_id.in_(user_ids))
        .order_by(AuthIdentity.id)
    ).all()
    for user_id, provider in rows:
        bucket = found.setdefault(int(user_id), [])
        if provider not in bucket:
            bucket.append(provider)
    return found


def _favorites(session: Session, user_ids: list[int]) -> dict[int, tuple[str | None, list[str]]]:
    found: dict[int, tuple[str | None, list[str]]] = {user_id: (None, []) for user_id in user_ids}
    if not user_ids:
        return found
    rows = list(
        session.scalars(
            select(UserFavorite)
            .where(UserFavorite.user_id.in_(user_ids))
            .order_by(UserFavorite.position, UserFavorite.id)
        ).all()
    )
    team_ids = [int(row.ref) for row in rows if row.kind == "team" and row.ref.isdigit()]
    names: dict[int, str] = {}
    if team_ids:
        for team in session.scalars(select(ScheduleTeam).where(ScheduleTeam.id.in_(team_ids))).all():
            if team.id is not None:
                names[int(team.id)] = team.name
    grouped: dict[int, list[UserFavorite]] = {user_id: [] for user_id in user_ids}
    for row in rows:
        grouped.setdefault(int(row.user_id), []).append(row)
    for user_id, favorites in grouped.items():
        club_name: str | None = None
        team_names: list[str] = []
        for favorite in favorites:
            if favorite.kind == "club" and favorite.position == 0 and club_name is None:
                source = club_location_source(session, favorite.ref)
                if source is not None:
                    club_name = source.name
            elif favorite.kind == "team" and favorite.ref.isdigit():
                name = names.get(int(favorite.ref))
                if name:
                    team_names.append(name)
        found[user_id] = (club_name, team_names)
    return found


def _addresses(session: Session, user_ids: list[int]) -> dict[int, AdminAddressOut]:
    if not user_ids:
        return {}
    rows = session.scalars(select(UserHomeAddress).where(UserHomeAddress.user_id.in_(user_ids))).all()
    return {
        int(row.user_id): AdminAddressOut(
            street=row.street,
            unit=row.unit,
            city=row.city,
            state=row.state,
            postal_code=row.postal_code,
        )
        for row in rows
    }


@router.get("/admin/users", response_model=AdminUserPage)
def list_users(
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
    q: Annotated[str | None, Query(description="Name or email")] = None,
    page: Annotated[int, Query(ge=1)] = 1,
) -> AdminUserPage:
    """One page of accounts. The total is the filtered count, not the page length."""

    require_admin(session, token)
    statement = select(AppUser)
    needle = (q or "").strip()[:200]
    if needle:
        like = _like(needle)
        statement = statement.where(
            or_(
                AppUser.display_name.ilike(like, escape="\\"),
                AppUser.email.ilike(like, escape="\\"),
            )
        )
    total = int(session.scalar(select(func.count()).select_from(statement.subquery())) or 0)
    offset = (page - 1) * PAGE_SIZE
    users = list(
        session.scalars(
            statement.order_by(AppUser.created_at.desc(), AppUser.id.desc()).offset(offset).limit(PAGE_SIZE)
        ).all()
    )
    user_ids = [int(user.id) for user in users]
    providers = _providers(session, user_ids)
    favorites = _favorites(session, user_ids)
    addresses = _addresses(session, user_ids)
    rows = []
    for user in users:
        user_id = int(user.id)
        club, teams = favorites.get(user_id, (None, []))
        rows.append(
            AdminUserOut(
                id=user_id,
                display_name=user.display_name,
                email=user.email,
                providers=providers.get(user_id, []),
                created_at=user.created_at,
                last_login_at=user.last_login_at,
                club=club,
                teams=teams,
                home_address=addresses.get(user_id),
            )
        )
    return AdminUserPage(page=page, total=total, rows=rows)
