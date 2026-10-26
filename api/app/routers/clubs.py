from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.clubs import club_detail, search_clubs
from app.database import get_session
from app.schemas import ClubDetailOut, ClubListItemOut

router = APIRouter()


@router.get("/clubs", response_model=list[ClubListItemOut])
def list_clubs(
    session: Annotated[Session, Depends(get_session)],
    q: str | None = Query(default=None, description="Case-insensitive substring of the club name"),
) -> list[ClubListItemOut]:
    return search_clubs(session, q)


@router.get("/clubs/{club_id}", response_model=ClubDetailOut)
def read_club(club_id: int, session: Annotated[Session, Depends(get_session)]) -> ClubDetailOut:
    detail = club_detail(session, club_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Club not found")
    return detail
