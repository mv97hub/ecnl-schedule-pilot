from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_session
from app.head_to_head import compare_teams
from app.models import ScheduleTeam
from app.schemas import HeadToHeadOut

router = APIRouter()


@router.get("/head-to-head", response_model=HeadToHeadOut)
def head_to_head(
    session: Annotated[Session, Depends(get_session)],
    team_a_id: int | None = Query(default=None),
    team_b_id: int | None = Query(default=None),
    conference_only: bool = Query(default=False),
) -> HeadToHeadOut:
    if team_a_id is None or team_b_id is None:
        raise HTTPException(status_code=400, detail="team_a_id and team_b_id are required")
    if team_a_id == team_b_id:
        raise HTTPException(status_code=400, detail="team_a_id and team_b_id must be different")
    team_a = session.get(ScheduleTeam, team_a_id)
    team_b = session.get(ScheduleTeam, team_b_id)
    if team_a is None or team_b is None:
        raise HTTPException(status_code=404, detail="Team not found")
    return compare_teams(session, team_a, team_b, conference_only)
