from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.database import get_session
from app.models import Game, Team
from app.schemas import OpponentOut, ScheduleGameOut, TeamOut

router = APIRouter()

EASTERN = ZoneInfo("America/New_York")
AGE_GROUPS = {"U13", "U14", "U15", "U16", "U17", "U18/19"}
FILTERS = {"all", "home", "away"}


def _contains(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


@router.get("/teams", response_model=list[TeamOut])
def list_teams(
    session: Annotated[Session, Depends(get_session)],
    q: str | None = Query(default=None, description="Case-insensitive substring of the team name"),
    age_group: str | None = Query(default=None, description="U13 or U14"),
) -> list[Team]:
    if age_group is not None and age_group not in AGE_GROUPS:
        raise HTTPException(status_code=400, detail="age_group must be U13, U14, U15, U16, U17, or U18/19")

    statement = select(Team)
    if q and q.strip():
        statement = statement.where(Team.name.ilike(_contains(q.strip()), escape="\\"))
    if age_group is not None:
        statement = statement.where(Team.age_group == age_group)
    statement = statement.order_by(Team.age_group, Team.name, Team.id)
    return list(session.scalars(statement).all())


@router.get("/teams/{team_id}/schedule", response_model=list[ScheduleGameOut])
def team_schedule(
    team_id: int,
    session: Annotated[Session, Depends(get_session)],
    filter: str = Query(default="all"),
) -> list[ScheduleGameOut]:
    if filter not in FILTERS:
        raise HTTPException(status_code=400, detail="filter must be one of: all, home, away")

    team = session.get(Team, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")

    statement = (
        select(Game)
        .options(selectinload(Game.home_team), selectinload(Game.away_team))
        .where(or_(Game.home_team_id == team_id, Game.away_team_id == team_id))
        .order_by(Game.starts_at, Game.id)
    )
    if filter == "home":
        statement = statement.where(Game.home_team_id == team_id)
    elif filter == "away":
        statement = statement.where(Game.away_team_id == team_id)

    games = session.scalars(statement).all()
    schedule: list[ScheduleGameOut] = []
    for game in games:
        if game.home_team_id == team_id:
            side = "home"
            opponent = game.away_team
        else:
            side = "away"
            opponent = game.home_team
        zone_name = game.timezone or "America/New_York"
        try:
            zone = ZoneInfo(zone_name)
        except Exception:
            zone = EASTERN
            zone_name = "America/New_York"
        kickoff = game.starts_at.astimezone(zone)
        schedule.append(
            ScheduleGameOut(
                id=game.id,
                starts_at=kickoff,
                opponent=OpponentOut(id=opponent.id, name=opponent.name),
                side=side,
                venue_name=game.venue_name,
                city=game.city,
                state=game.state,
                timezone=zone_name,
                event=game.event,
            )
        )
    return schedule
