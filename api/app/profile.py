"""Home address and one calendar link per favorite team. Feeds are not fetched."""

from __future__ import annotations

from urllib.parse import urlsplit

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.favorites import read_favorites
from app.models import UserCalendar, UserHomeAddress

US_STATE_CODES = frozenset(
    {
        "AL",
        "AK",
        "AZ",
        "AR",
        "CA",
        "CO",
        "CT",
        "DE",
        "DC",
        "FL",
        "GA",
        "HI",
        "ID",
        "IL",
        "IN",
        "IA",
        "KS",
        "KY",
        "LA",
        "ME",
        "MD",
        "MA",
        "MI",
        "MN",
        "MS",
        "MO",
        "MT",
        "NE",
        "NV",
        "NH",
        "NJ",
        "NM",
        "NY",
        "NC",
        "ND",
        "OH",
        "OK",
        "OR",
        "PA",
        "RI",
        "SC",
        "SD",
        "TN",
        "TX",
        "UT",
        "VT",
        "VA",
        "WA",
        "WV",
        "WI",
        "WY",
    }
)
CALENDAR_SOURCES = frozenset({"playmetrics", "teamsnap"})
_URL_LIMIT = 2000


def _line(value: str, empty_message: str, limit: int, *, required: bool) -> str:
    text = " ".join(value.split())
    if required and not text:
        raise HTTPException(status_code=400, detail=empty_message)
    if len(text) > limit:
        raise HTTPException(status_code=400, detail="That value is too long.")
    return text


def read_home_address(db: Session, user_id: int) -> dict[str, str] | None:
    row = db.get(UserHomeAddress, user_id)
    if row is None:
        return None
    return {
        "street": row.street,
        "unit": row.unit,
        "city": row.city,
        "state": row.state,
        "postal_code": row.postal_code,
    }


def save_home_address(
    db: Session,
    user_id: int,
    *,
    street: str,
    unit: str,
    city: str,
    state: str,
    postal_code: str,
) -> dict[str, str]:
    cleaned_street = _line(street, "Enter a street address.", 160, required=True)
    cleaned_unit = _line(unit, "", 40, required=False)
    cleaned_city = _line(city, "Enter a city.", 80, required=True)
    cleaned_state = state.strip().upper()
    if cleaned_state not in US_STATE_CODES:
        raise HTTPException(status_code=400, detail="Choose a state.")
    cleaned_postal = _line(postal_code, "Enter a postal code.", 16, required=True)
    row = db.get(UserHomeAddress, user_id)
    if row is None:
        row = UserHomeAddress(
            user_id=user_id,
            street=cleaned_street,
            unit=cleaned_unit,
            city=cleaned_city,
            state=cleaned_state,
            postal_code=cleaned_postal,
            latitude=None,
            longitude=None,
        )
        db.add(row)
    else:
        row.street = cleaned_street
        row.unit = cleaned_unit
        row.city = cleaned_city
        row.state = cleaned_state
        row.postal_code = cleaned_postal
        row.latitude = None
        row.longitude = None
    db.commit()
    db.refresh(row)
    return {
        "street": row.street,
        "unit": row.unit,
        "city": row.city,
        "state": row.state,
        "postal_code": row.postal_code,
    }


def clear_home_address(db: Session, user_id: int) -> None:
    db.execute(delete(UserHomeAddress).where(UserHomeAddress.user_id == user_id))
    db.commit()


def normalize_calendar_url(raw: str) -> str:
    """Store an https link. A webcal link is rewritten to https. Anything else is rejected."""

    text = raw.strip()
    if not text or len(text) > _URL_LIMIT or any(character.isspace() for character in text):
        raise HTTPException(status_code=400, detail="Calendar link must be an https link")
    scheme, separator, rest = text.partition("://")
    if separator and scheme.lower() in {"webcal", "webcals"}:
        text = f"https://{rest}"
    parts = urlsplit(text)
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
        raise HTTPException(status_code=400, detail="Calendar link must be an https link")
    return text


def read_calendars(db: Session, user_id: int) -> list[dict[str, object]]:
    """Links for the current favorite teams, in slot order. A removed team loses its row."""

    _club_id, team_ids = read_favorites(db, user_id)
    allowed = set(team_ids)
    rows = list(db.scalars(select(UserCalendar).where(UserCalendar.user_id == user_id)).all())
    kept = [
        {"team_id": row.team_id, "source": row.source, "url": row.url}
        for row in rows
        if row.team_id in allowed
    ]
    stale_ids = [row.id for row in rows if row.team_id not in allowed]
    if stale_ids:
        db.execute(delete(UserCalendar).where(UserCalendar.id.in_(stale_ids)))
        db.commit()
    order = {team_id: index for index, team_id in enumerate(team_ids)}
    kept.sort(key=lambda item: order.get(int(item["team_id"]), len(order)))
    return kept


def save_calendar(db: Session, user_id: int, *, team_id: int, source: str, url: str) -> dict[str, object]:
    _club_id, team_ids = read_favorites(db, user_id)
    if team_id not in team_ids:
        raise HTTPException(status_code=400, detail="Add that team under Favorites first")
    source_key = source.strip().lower()
    if source_key not in CALENDAR_SOURCES:
        raise HTTPException(status_code=400, detail="Choose PlayMetrics or TeamSnap")
    stored = normalize_calendar_url(url)
    row = db.scalar(select(UserCalendar).where(UserCalendar.user_id == user_id, UserCalendar.team_id == team_id))
    if row is None:
        row = UserCalendar(user_id=user_id, team_id=team_id, source=source_key, url=stored)
        db.add(row)
    else:
        row.source = source_key
        row.url = stored
    db.commit()
    db.refresh(row)
    return {"team_id": row.team_id, "source": row.source, "url": row.url}


def clear_calendar(db: Session, user_id: int, team_id: int) -> None:
    db.execute(delete(UserCalendar).where(UserCalendar.user_id == user_id, UserCalendar.team_id == team_id))
    db.commit()
