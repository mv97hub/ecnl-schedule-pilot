"""Club logo URLs stored on the club row. Missing clubs stay blank."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Club, ScheduleTeam


def club_logos(session: Session, teams: list[ScheduleTeam]) -> dict[int, str | None]:
    club_ids = {team.club_id for team in teams if team.club_id is not None}
    by_club: dict[int, str | None] = {}
    if club_ids:
        for club in session.scalars(select(Club).where(Club.id.in_(club_ids))):
            url = (club.logo_url or "").strip()
            by_club[club.id] = url or None
    return {team.id: by_club.get(team.club_id) if team.club_id is not None else None for team in teams}


def club_logo(session: Session, team: ScheduleTeam) -> str | None:
    return club_logos(session, [team]).get(team.id)
