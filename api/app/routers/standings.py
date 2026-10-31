from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_session
from app.predictions import predicted_table
from app.schemas import PredictedStandingsOut, StandingOut
from app.standings import ecnl_standings, normalize_age_group, normalize_gender, normalize_tier, official_standings, recent_form, short_conference, sort_standings

router = APIRouter()


def _ranked(rows: list[dict[str, object]], form_by_team: dict[int, list[str]]) -> list[StandingOut]:
    ranked: list[StandingOut] = []
    for index, row in enumerate(sort_standings(rows), start=1):
        team_id = row["team_id"] if isinstance(row["team_id"], int) else None
        form = [mark for mark in form_by_team.get(team_id or -1, []) if mark in {"W", "L", "D"}]
        ranked.append(
            StandingOut(
                rank=index,
                team_id=team_id,
                team_name=str(row["team_name"]),
                games_played=int(row["games_played"]),
                wins=int(row["wins"]),
                losses=int(row["losses"]),
                draws=int(row["draws"]),
                goals_for=int(row["goals_for"]),
                goals_against=int(row["goals_against"]),
                goal_diff=int(row["goal_diff"]),
                points=int(row["points"]),
                points_per_game=float(row["points_per_game"]),
                form=form,
            )
        )
    return ranked


@router.get("/standings/predicted", response_model=PredictedStandingsOut)
def list_predicted_standings(
    session: Annotated[Session, Depends(get_session)],
    conference: str = Query(min_length=1),
    tier: str = Query(),
    age_group: str = Query(),
    gender: str = Query(default="boys"),
) -> PredictedStandingsOut:
    try:
        tier_name = normalize_tier(tier)
        age = normalize_age_group(age_group)
        chosen_gender = normalize_gender(gender)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    short = short_conference(conference)
    if not short:
        raise HTTPException(status_code=400, detail="conference is required")
    table = predicted_table(session, short, tier_name, age, chosen_gender)
    return PredictedStandingsOut.model_validate(table)


@router.get("/standings", response_model=list[StandingOut])
def list_standings(
    session: Annotated[Session, Depends(get_session)],
    conference: str = Query(min_length=1),
    tier: str = Query(),
    age_group: str = Query(),
    mode: str = Query(default="official"),
    gender: str = Query(default="boys"),
) -> list[StandingOut]:
    try:
        tier_name = normalize_tier(tier)
        age = normalize_age_group(age_group)
        chosen_gender = normalize_gender(gender)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    chosen = mode.strip().casefold()
    if chosen not in {"official", "calculated"}:
        raise HTTPException(status_code=400, detail="mode must be official or calculated")
    short = short_conference(conference)
    if not short:
        raise HTTPException(status_code=400, detail="conference is required")
    form_by_team = recent_form(session, short, tier_name, age, chosen_gender)

    if chosen == "calculated":
        return _ranked(ecnl_standings(session, short, age, tier_name, chosen_gender), form_by_team)

    records = official_standings(session, short, tier_name, age, chosen_gender)
    return _ranked(
        [
            {
                "team_id": record.team_id,
                "team_name": record.team_name,
                "games_played": record.games_played,
                "wins": record.wins,
                "losses": record.losses,
                "draws": record.draws,
                "goals_for": record.goals_for,
                "goals_against": record.goals_against,
                "goal_diff": record.goal_diff,
                "points": record.points,
                "points_per_game": record.points_per_game,
            }
            for record in records
        ],
        form_by_team,
    )
