from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_session
from app.ingestion.fetch import IngestError, fetch_calendar, fetch_rendered_html
from app.ingestion.parsing import extract_games_from_html, parse_ics, parse_schedule_text
from app.ingestion.upsert import ParsedGame, SavedGame, upsert_games

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
