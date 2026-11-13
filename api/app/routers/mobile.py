"""Home payload for the mobile app. Favorites stay on the device; this route reads no profile key."""

from datetime import UTC, datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.clubs import accumulate_records, club_detail
from app.database import get_session
from app.logos import club_logos
from app.models import ScheduleGame as Game, ScheduleTeam as Team
from app.routers.teams import parse_team_ids
from app.schemas import (
    MobileClubOut,
    MobileDashboardOut,
    MobileGameOut,
    MobileTeamOut,
    OpponentOut,
)
from app.standings import conference_rank, official_points_per_game, short_conference

router = APIRouter()

EASTERN = ZoneInfo("America/New_York")
MAX_DASHBOARD_TEAMS = 4


def _aware(moment: datetime) -> datetime:
    if moment.tzinfo is None:
        return moment.replace(tzinfo=UTC)
    return moment


def _marker(goals_for: int, goals_against: int) -> str:
    if goals_for > goals_against:
        return "W"
    if goals_for < goals_against:
        return "L"
    return "D"


def _zone(game: Game) -> tuple[ZoneInfo, str]:
    zone_name = game.timezone or "America/New_York"
    try:
        return ZoneInfo(zone_name), zone_name
    except Exception:
        return EASTERN, "America/New_York"


def _game_out(game: Game, team_id: int, logos: dict[int, str | None]) -> MobileGameOut:
    home = game.home_team_id == team_id
    opponent = game.away_team if home else game.home_team
    goals_for = game.home_score if home else game.away_score
    goals_against = game.away_score if home else game.home_score
    completed = game.status == "COMPLETED" and goals_for is not None and goals_against is not None
    zone, zone_name = _zone(game)
    status = game.status if game.status in {"SCHEDULED", "COMPLETED", "POSTPONED", "CANCELLED"} else "SCHEDULED"
    return MobileGameOut(
        id=game.id,
        starts_at=game.starts_at.astimezone(zone),
        opponent=OpponentOut(id=opponent.id, name=opponent.name, logo_url=logos.get(opponent.id)),
        side="home" if home else "away",
        venue_name=game.venue_name,
        city=game.city,
        state=game.state,
        field_name=(game.field_name or "").strip() or None,
        timezone=zone_name,
        status=status,  # type: ignore[arg-type]
        home_score=game.home_score,
        away_score=game.away_score,
        team_result=_marker(goals_for, goals_against) if completed else None,  # type: ignore[arg-type]
        latitude=game.venue_lat,
        longitude=game.venue_lng,
    )


def _team_card(session: Session, team: Team) -> MobileTeamOut:
    games = list(
        session.scalars(
            select(Game)
            .options(selectinload(Game.home_team), selectinload(Game.away_team))
            .where(or_(Game.home_team_id == team.id, Game.away_team_id == team.id))
            .order_by(Game.starts_at, Game.id)
        ).all()
    )
    opponents = [game.away_team if game.home_team_id == team.id else game.home_team for game in games]
    logos = club_logos(session, [team, *opponents])
    overall, conference = accumulate_records(games, {int(team.id)})
    played = conference.wins + conference.losses + conference.draws
    calculated = round((conference.wins * 3 + conference.draws) / played, 2) if played else 0.0
    official = official_points_per_game(session, team)
    now = datetime.now(UTC)
    upcoming = [game for game in games if game.status == "SCHEDULED" and _aware(game.starts_at) >= now]
    finished = [
        game
        for game in games
        if game.status == "COMPLETED" and game.home_score is not None and game.away_score is not None
    ]
    next_game = min(upcoming, key=lambda game: (_aware(game.starts_at), game.id)) if upcoming else None
    last_result = max(finished, key=lambda game: (_aware(game.starts_at), game.id)) if finished else None
    return MobileTeamOut(
        id=int(team.id),
        name=team.name,
        age_group=team.age_group,
        gender="girls" if team.gender == "girls" else "boys",
        tier=team.tier,
        conference=short_conference(team.conference),
        logo_url=logos.get(team.id),
        club_id=team.club_id,
        rank=conference_rank(session, team),
        ppg=official if official is not None else calculated,
        record=overall.as_out(),
        conference_record=conference.as_out(),
        next_game=_game_out(next_game, int(team.id), logos) if next_game is not None else None,
        last_result=_game_out(last_result, int(team.id), logos) if last_result is not None else None,
    )


@router.get("/mobile/dashboard", response_model=MobileDashboardOut)
def mobile_dashboard(
    session: Annotated[Session, Depends(get_session)],
    team_ids: str | None = Query(default=None, description="Up to 4 comma-separated team ids, in favorite order"),
    club_id: str | None = Query(default=None, description="Public club key, the same value as /clubs/{club_key}"),
) -> MobileDashboardOut:
    requested = parse_team_ids(team_ids, limit=MAX_DASHBOARD_TEAMS, field="team_ids")
    teams: list[MobileTeamOut] = []
    if requested:
        found = {team.id: team for team in session.scalars(select(Team).where(Team.id.in_(requested))).all()}
        teams = [_team_card(session, found[team_id]) for team_id in requested if team_id in found]

    club: MobileClubOut | None = None
    key = (club_id or "").strip()
    if key:
        detail = club_detail(session, key)
        if detail is None:
            raise HTTPException(status_code=404, detail="Club not found")
        club = MobileClubOut(
            id=detail.id,
            name=detail.name,
            logo_url=detail.logo_url,
            record=detail.record,
            conference_record=detail.conference_record,
            squads=detail.squads,
            past_10_days=detail.weekends,
            next_10_days=detail.upcoming,
        )
    return MobileDashboardOut(teams=teams, club=club)
