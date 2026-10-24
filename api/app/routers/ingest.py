from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_session
from app.ingestion.fetch import IngestError, fetch_calendar, fetch_rendered_html
from app.ingestion.league_scores import apply_league_scores
from app.ingestion.parsing import extract_games_from_html, parse_ics, parse_schedule_text, parse_score_text, parse_standings_text, scores_from_records
from app.ingestion.upsert import ParsedGame, ParsedScore, SavedGame, upsert_games, upsert_scores
from app.models import ConferenceStanding
from app.standings import _row_from_parts, normalize_age_group, normalize_tier, short_conference, upsert_standings

router = APIRouter(prefix="/ingest", tags=["ingest"])


class IcsIn(BaseModel):
    url: str
    age_group: str | None = None
    tier: str | None = None


class UrlIn(BaseModel):
    url: str
    age_group: str | None = None
    tier: str | None = None


class RawTextIn(BaseModel):
    text: str
    age_group: str | None = None
    tier: str | None = None
    default_city_state: str | None = None


class ScoreGameIn(BaseModel):
    date: str
    home_team: str | None = None
    away_team: str | None = None
    home: str | None = None
    away: str | None = None
    home_score: int | None = None
    away_score: int | None = None
    score: str | None = None
    status: str | None = None


class ScoresIn(BaseModel):
    text: str | None = None
    age_group: str | None = None
    tier: str | None = None
    games: list[ScoreGameIn] | None = None


class ScoreOut(BaseModel):
    id: int
    match_key: str
    date: str
    home_team: str
    away_team: str
    home_score: int
    away_score: int
    status: str


class ScoresIngestOut(BaseModel):
    parsed: int
    inserted: int
    updated: int
    upserted: int
    league_games_updated: int
    games: list[ScoreOut]


class StandingsIn(BaseModel):
    text: str
    conference: str
    tier: str
    age_group: str


class StandingsIngestOut(BaseModel):
    parsed: int
    upserted: int
    linked: int
    conference: str
    tier: str
    age_group: str


class GameOut(BaseModel):
    id: int
    match_key: str
    date: str
    kickoff_time: str | None
    home_team: str
    away_team: str
    complex_name: str
    field_number: str
    city_state: str
    is_showcase: bool


class IngestOut(BaseModel):
    parsed: int
    inserted: int
    updated: int
    upserted: int
    games: list[GameOut]


def _age(value: str | None) -> str:
    return " ".join((value or "").split())[:16] or "Unknown"


def _tier(value: str | None) -> str | None:
    text = " ".join((value or "").split())[:40]
    return text or None


def _city(value: str | None) -> str:
    return " ".join((value or "").split())[:120]


def _out(games: list[ParsedGame], saved: list[SavedGame], inserted: int, updated: int) -> IngestOut:
    return IngestOut(
        parsed=len(games),
        inserted=inserted,
        updated=updated,
        upserted=inserted + updated,
        games=[
            GameOut(
                id=game.id,
                match_key=game.match_key,
                date=game.date.isoformat(),
                kickoff_time=game.kickoff_time.strftime("%H:%M") if game.kickoff_time else None,
                home_team=game.home_team,
                away_team=game.away_team,
                complex_name=game.complex_name,
                field_number=game.field_number,
                city_state=game.city_state,
                is_showcase=game.is_showcase,
            )
            for game in saved
        ],
    )


def _save(session: Session, games: list[ParsedGame]) -> IngestOut:
    if not games:
        raise HTTPException(status_code=400, detail="No games found in the schedule")
    result = upsert_games(session, games)
    if result.upserted == 0:
        raise HTTPException(status_code=400, detail="No games found in the schedule")
    return _out(games, result.games, result.inserted, result.updated)


@router.post("/ics", response_model=IngestOut)
async def ingest_ics(body: IcsIn, session: Annotated[Session, Depends(get_session)]) -> IngestOut:
    if not body.url.strip():
        raise HTTPException(status_code=400, detail="url is required")
    try:
        calendar_text = await fetch_calendar(body.url)
        games = parse_ics(calendar_text, age_group=_age(body.age_group), tier=_tier(body.tier))
        return _save(session, games)
    except IngestError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/url", response_model=IngestOut)
async def ingest_url(body: UrlIn, session: Annotated[Session, Depends(get_session)]) -> IngestOut:
    if not body.url.strip():
        raise HTTPException(status_code=400, detail="url is required")
    try:
        html = await fetch_rendered_html(body.url)
        games = extract_games_from_html(html, age_group=_age(body.age_group), tier=_tier(body.tier))
        return _save(session, games)
    except IngestError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/raw-text", response_model=IngestOut)
def ingest_raw_text(body: RawTextIn, session: Annotated[Session, Depends(get_session)]) -> IngestOut:
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    if len(text) > 200_000:
        raise HTTPException(status_code=400, detail="text is too large")
    try:
        games = parse_schedule_text(
            text,
            age_group=_age(body.age_group),
            tier=_tier(body.tier),
            default_city_state=_city(body.default_city_state),
        )
        return _save(session, games)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/scores", response_model=ScoresIngestOut)
def ingest_scores(body: ScoresIn, session: Annotated[Session, Depends(get_session)]) -> ScoresIngestOut:
    age_group = _age(body.age_group)
    tier = _tier(body.tier)
    parsed: list[ParsedScore] = []
    try:
        if body.games:
            parsed.extend(scores_from_records([game.model_dump() for game in body.games], age_group=age_group, tier=tier))
        if body.text and body.text.strip():
            parsed.extend(parse_score_text(body.text, age_group=age_group, tier=tier))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not parsed:
        raise HTTPException(status_code=400, detail="No scores found")
    inserted, updated, saved = upsert_scores(session, parsed)
    if inserted + updated == 0:
        raise HTTPException(status_code=400, detail="No scores found")
    league_games_updated = apply_league_scores(session, parsed)
    return ScoresIngestOut(
        parsed=len(parsed),
        inserted=inserted,
        updated=updated,
        upserted=inserted + updated,
        league_games_updated=league_games_updated,
        games=[
            ScoreOut(
                id=game.id,
                match_key=game.match_key,
                date=game.date.isoformat(),
                home_team=game.home_team,
                away_team=game.away_team,
                home_score=game.home_score,
                away_score=game.away_score,
                status=game.status,
            )
            for game in saved
        ],
    )


@router.post("/standings", response_model=StandingsIngestOut)
def ingest_standings(body: StandingsIn, session: Annotated[Session, Depends(get_session)]) -> StandingsIngestOut:
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    try:
        tier = normalize_tier(body.tier)
        age_group = normalize_age_group(body.age_group)
        conference = short_conference(body.conference)
        if not conference:
            raise ValueError("conference is required")
        parsed = parse_standings_text(text)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not parsed:
        raise HTTPException(status_code=400, detail="No standings rows found")
    rows = [
        _row_from_parts(
            conference=conference,
            tier=tier,
            age_group=age_group,
            team_id=None,
            team_name=str(row["team_name"]),
            games_played=int(row["games_played"]),
            wins=int(row["wins"]),
            losses=int(row["losses"]),
            draws=int(row["draws"]),
            goals_for=int(row["goals_for"]),
            goals_against=int(row["goals_against"]),
            goal_diff=row["goal_diff"] if isinstance(row["goal_diff"], int) else None,
            points=row["points"] if isinstance(row["points"], int) else None,
            points_per_game=row["points_per_game"] if isinstance(row["points_per_game"], float) else None,
        )
        for row in parsed
    ]
    upserted = upsert_standings(session, rows)
    stored = session.scalars(
        select(ConferenceStanding).where(
            func.lower(ConferenceStanding.conference) == conference.casefold(),
            ConferenceStanding.tier == tier,
            ConferenceStanding.age_group == age_group,
            ConferenceStanding.team_name.in_([str(row["team_name"]) for row in rows]),
        )
    ).all()
    linked = sum(1 for record in stored if record.team_id is not None)
    return StandingsIngestOut(
        parsed=len(parsed),
        upserted=upserted,
        linked=linked,
        conference=conference,
        tier=tier,
        age_group=age_group,
    )
