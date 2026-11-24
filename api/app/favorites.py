"""One club and up to four ordered teams, stored on the account."""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.clubs import club_detail
from app.models import ScheduleTeam, UserFavorite

MAX_TEAMS = 4


def _clean_club_id(club_id: str | None) -> str | None:
    if club_id is None:
        return None
    text = club_id.strip()
    return text or None


def replace_favorites(db: Session, user_id: int, club_id: str | None, team_ids: list[int]) -> None:
    """Replace the account's club and team list. Slot order is the list order."""

    club = _clean_club_id(club_id)
    if club is not None and club_detail(db, club) is None:
        raise HTTPException(status_code=400, detail="Club not found")
    if len(team_ids) > MAX_TEAMS:
        raise HTTPException(status_code=400, detail="At most four teams")
    if len(set(team_ids)) != len(team_ids):
        raise HTTPException(status_code=400, detail="A team can only be saved once")
    for team_id in team_ids:
        if team_id < 1 or team_id > 2_147_483_647:
            raise HTTPException(status_code=400, detail="Team not found")
    if team_ids:
        found = set(db.scalars(select(ScheduleTeam.id).where(ScheduleTeam.id.in_(team_ids))).all())
        if set(team_ids) - found:
            raise HTTPException(status_code=400, detail="Team not found")

    db.execute(delete(UserFavorite).where(UserFavorite.user_id == user_id))
    db.flush()
    if club is not None:
        db.add(UserFavorite(user_id=user_id, kind="club", ref=club, position=0))
    for index, team_id in enumerate(team_ids, start=1):
        db.add(UserFavorite(user_id=user_id, kind="team", ref=str(team_id), position=index))
    db.commit()


def read_favorites(db: Session, user_id: int) -> tuple[str | None, list[int]]:
    """Saved club id and team ids. A club or team that no longer exists is left out."""

    rows = list(
        db.scalars(
            select(UserFavorite).where(UserFavorite.user_id == user_id).order_by(UserFavorite.position, UserFavorite.id)
        ).all()
    )
    club_id: str | None = None
    team_ids: list[int] = []
    for row in rows:
        if row.kind == "club" and row.position == 0:
            club_id = row.ref
        elif row.kind == "team" and row.ref.isdigit():
            team_ids.append(int(row.ref))
    if club_id is not None and club_detail(db, club_id) is None:
        club_id = None
    if team_ids:
        found = set(db.scalars(select(ScheduleTeam.id).where(ScheduleTeam.id.in_(team_ids))).all())
        team_ids = [team_id for team_id in team_ids if team_id in found]
    return club_id, team_ids[:MAX_TEAMS]
