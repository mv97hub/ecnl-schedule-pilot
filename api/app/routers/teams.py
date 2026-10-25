from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.database import get_session
from app.ingestion.normalizer import looks_like_showcase
from app.logos import club_logos
from app.models import ScheduleGame as Game, ScheduleTeam as Team
from app.schemas import OpponentOut, ScheduleGameOut, ScheduleResponse, TeamOut, TeamRecordSummary
from app.standings import conference_rank, normalize_gender, short_conference

router = APIRouter()

EASTERN = ZoneInfo("America/New_York")
AGE_GROUPS = {"U13", "U14", "U15", "U16", "U17", "U18/19"}
FILTERS = {"all", "home", "away"}


def _contains(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _gender(value: str) -> str:
    try:
        return normalize_gender(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/teams", response_model=list[TeamOut])
def list_teams(
    session: Annotated[Session, Depends(get_session)],
    q: str | None = Query(default=None, description="Case-insensitive substring of the team name"),
    age_group: str | None = Query(default=None, description="U13 or U14"),
    gender: str = "boys",
) -> list[Team]:
    if age_group is not None and age_group not in AGE_GROUPS:
        raise HTTPException(status_code=400, detail="age_group must be U13, U14, U15, U16, U17, or U18/19")
    chosen = _gender(gender)

    statement = select(Team).where(Team.gender == chosen)
    if q and q.strip():
        statement = statement.where(Team.name.ilike(_contains(q.strip()), escape="\\"))
    if age_group is not None:
        statement = statement.where(Team.age_group == age_group)
    statement = statement.order_by(Team.age_group, Team.name, Team.id)
    return list(session.scalars(statement).all())


def _marker(goals_for: int, goals_against: int) -> str:
    if goals_for > goals_against:
        return "W"
    if goals_for < goals_against:
        return "L"
    return "D"


def _record(wins: int, losses: int, draws: int) -> str:
    return f"{wins}-{losses}-{draws}"


@router.get("/teams/{team_id}/schedule", response_model=ScheduleResponse)
def team_schedule(
    team_id: int,
    session: Annotated[Session, Depends(get_session)],
    filter: str = Query(default="all"),
) -> ScheduleResponse:
    if filter not in FILTERS:
        raise HTTPException(status_code=400, detail="filter must be one of: all, home, away")

    team = session.get(Team, team_id)
    if team is None or (team.gender or "boys") not in {"boys", "girls"}:
        raise HTTPException(status_code=404, detail="Team not found")

    games = session.scalars(
        select(Game)
        .options(selectinload(Game.home_team), selectinload(Game.away_team))
        .where(or_(Game.home_team_id == team_id, Game.away_team_id == team_id))
        .order_by(Game.starts_at, Game.id)
    ).all()

    overall = {"wins": 0, "losses": 0, "draws": 0}
    conference = {"wins": 0, "losses": 0, "draws": 0, "gf": 0, "ga": 0}
    opponents = [game.away_team if game.home_team_id == team_id else game.home_team for game in games]
    logos = club_logos(session, [team, *opponents])
    schedule: list[ScheduleGameOut] = []
    for game in games:
        home = game.home_team_id == team_id
        side = "home" if home else "away"
        opponent = game.away_team if home else game.home_team
        goals_for = game.home_score if home else game.away_score
        goals_against = game.away_score if home else game.home_score
        completed = game.status == "COMPLETED" and goals_for is not None and goals_against is not None
        team_result = _marker(goals_for, goals_against) if completed else None
        if completed and team_result is not None and goals_for is not None and goals_against is not None:
            overall[{"W": "wins", "D": "draws", "L": "losses"}[team_result]] += 1
            if game.is_conference_game:
                conference[{"W": "wins", "D": "draws", "L": "losses"}[team_result]] += 1
                conference["gf"] += goals_for or 0
                conference["ga"] += goals_against or 0
        showcase = (not game.is_conference_game) or looks_like_showcase(game.event or "")
        venue_type = "Showcase" if showcase else ("Home" if home else "Away")
        if filter == "home" and not home:
            continue
        if filter == "away" and home:
            continue
        zone_name = game.timezone or "America/New_York"
        try:
            zone = ZoneInfo(zone_name)
        except Exception:
            zone = EASTERN
            zone_name = "America/New_York"
        schedule.append(
            ScheduleGameOut(
                id=game.id,
                starts_at=game.starts_at.astimezone(zone),
                opponent=OpponentOut(id=opponent.id, name=opponent.name, logo_url=logos.get(opponent.id)),
                side=side,
                venue_name=game.venue_name,
                city=game.city,
                state=game.state,
                field_name=(game.field_name or "").strip() or None,
                timezone=zone_name,
                event=game.event,
                status=game.status if game.status in {"SCHEDULED", "COMPLETED", "POSTPONED", "CANCELLED"} else "SCHEDULED",
                home_score=game.home_score,
                away_score=game.away_score,
                is_conference_game=game.is_conference_game,
                venue_type=venue_type,
                team_result=team_result,
            )
        )

    played = conference["wins"] + conference["losses"] + conference["draws"]
    points = conference["wins"] * 3 + conference["draws"]
    return ScheduleResponse(
        team_record_summary=TeamRecordSummary(
            overall_record=_record(overall["wins"], overall["losses"], overall["draws"]),
            conference_record=_record(conference["wins"], conference["losses"], conference["draws"]),
            goals_for=conference["gf"],
            goals_against=conference["ga"],
            ppg=round(points / played, 2) if played else 0.0,
            conference_rank=conference_rank(session, team),
            conference=short_conference(team.conference),
        ),
        logo_url=logos.get(team.id),
        games=schedule,
    )
