"""Family ratings and tips for schedule complexes.

One complex is one place. Field numbers are stripped with the same split the
schedule already uses, then the cleaned name, lowercase city, and state form
`venue_key`. There is no account: the browser sends `X-Profile-Key`, and
`user_id` stays empty.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import UTC, datetime
from math import asin, cos, radians, sin, sqrt
from typing import Annotated, Literal
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.clubs import club_location_source
from app.database import get_session
from app.ingestion.normalizer import split_venue
from app.models import ScheduleGame, VenueRating, VenueRecommendation

router = APIRouter(tags=["locations"])

SurfaceVote = Literal["GRASS", "TURF", "MIXED"]
TipCategory = Literal["HOTEL", "RESTAURANT", "COFFEE_GAP", "ACTIVITY", "SIDELINE_TIP"]
CATEGORIES = {"HOTEL", "RESTAURANT", "COFFEE_GAP", "ACTIVITY", "SIDELINE_TIP"}
SURFACES = {"GRASS", "TURF", "MIXED"}
TIP_TAGS = (
    "Good for Big Teams",
    "Quick Carbs",
    "Close to Fields",
    "Free Breakfast",
    "Paid Parking",
    "Bring Shade",
    "Good for Team Dinner",
    "Within 10 minutes of Fields",
    "Great Wi-Fi",
)
CRITERIA = ("field_quality", "referees", "parent_vibe", "parking_access", "amenities")
GAME_LIMIT = 8


def clean_venue_for_geocoding(venue_name: str) -> str:
    """Drop the field number. `Davis Park - Field 1` and `Field 2` are one place."""

    complex_name, _field_number = split_venue(venue_name or "")
    return complex_name.strip()


def make_venue_key(venue_name: str, city: str, state: str) -> str:
    """Cleaned name, lowercase city, and state. Field numbers do not change the key."""

    name = clean_venue_for_geocoding(venue_name).lower()
    city_text = " ".join((city or "").replace("\xa0", " ").split()).lower()
    state_text = " ".join((state or "").replace("\xa0", " ").split()).upper()
    return f"{name}|{city_text}|{state_text}"


def _display_name(venue_name: str) -> str:
    return clean_venue_for_geocoding(venue_name) or "TBD"


def _display_city(city: str) -> str:
    return " ".join((city or "").replace("\xa0", " ").split())


def _display_state(state: str) -> str:
    return " ".join((state or "").replace("\xa0", " ").split()).upper()


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _round(value: float) -> float:
    return round(value, 2)


def estimate_drive_minutes(lat1: float, lng1: float, lat2: float, lng2: float) -> int:
    """Straight-line miles, with a road factor, at a steady pace. Not live traffic."""

    radius_miles = 3958.8
    phi1, phi2 = radians(lat1), radians(lat2)
    delta_phi = radians(lat2 - lat1)
    delta_lng = radians(lng2 - lng1)
    chord = sin(delta_phi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(delta_lng / 2) ** 2
    miles = 2 * radius_miles * asin(min(1.0, sqrt(chord)))
    minutes = miles * 1.3 / 45 * 60
    return 1 if minutes < 1 else int(round(minutes))


def _maps_search(query: str) -> str:
    return "https://www.google.com/maps/search/?" + urlencode({"api": "1", "query": query})


def _maps_directions(destination: str, origin: str | None) -> str:
    params = {"api": "1", "destination": destination}
    if origin:
        params["origin"] = origin
    return "https://www.google.com/maps/dir/?" + urlencode(params)


def _parse_tags(value: str | None) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in value.split(",") if part.strip()]


def _normalize_tags(tags: list[str]) -> str | None:
    allowed = set(TIP_TAGS)
    chosen: list[str] = []
    for tag in tags:
        text = " ".join((tag or "").split())
        if not text:
            continue
        if text not in allowed:
            raise HTTPException(status_code=400, detail=f"Unknown tag: {text}")
        if text not in chosen:
            chosen.append(text)
    return ", ".join(chosen) if chosen else None


def _listed_surface(values: list[str | None]) -> str | None:
    counts: Counter[str] = Counter()
    for value in values:
        text = (value or "").strip().upper()
        if not text:
            continue
        if "MIX" in text:
            counts["MIXED"] += 1
        elif "TURF" in text or "ARTIFICIAL" in text:
            counts["TURF"] += 1
        elif "GRASS" in text or "NATURAL" in text:
            counts["GRASS"] += 1
    if not counts:
        return None
    best = max(counts.values())
    for surface in ("GRASS", "TURF", "MIXED"):
        if counts[surface] == best:
            return surface
    return None


def _dominant_surface(rows: list[VenueRating]) -> str | None:
    counts: Counter[str] = Counter()
    latest: dict[str, datetime] = {}
    for row in rows:
        surface = row.surface_vote
        if surface not in SURFACES:
            continue
        counts[surface] += 1
        updated = _utc(row.updated_at)
        if surface not in latest or updated > latest[surface]:
            latest[surface] = updated
    if not counts:
        return None
    best = max(counts.values())
    tied = [surface for surface, count in counts.items() if count == best]
    tied.sort(key=lambda surface: latest[surface], reverse=True)
    return tied[0]


def _summarize(rows: list[VenueRating]) -> dict[str, float | int | str | None]:
    count = len(rows)
    if count == 0:
        empty: dict[str, float | int | str | None] = {name: None for name in CRITERIA}
        empty["overall"] = None
        empty["ratings_count"] = 0
        empty["dominant_surface"] = None
        return empty
    summary: dict[str, float | int | str | None] = {}
    total = 0
    for name in CRITERIA:
        values = [int(getattr(row, name)) for row in rows]
        summary[name] = _round(sum(values) / count)
        total += sum(values)
    summary["overall"] = _round(total / (count * len(CRITERIA)))
    summary["ratings_count"] = count
    summary["dominant_surface"] = _dominant_surface(rows)
    return summary


class ComplexBucket:
    def __init__(self, venue_key: str) -> None:
        self.venue_key = venue_key
        self.names: Counter[str] = Counter()
        self.cities: Counter[str] = Counter()
        self.states: Counter[str] = Counter()
        self.raw_names: set[str] = set()
        self.total_games = 0
        self.upcoming_games = 0
        self.latitudes: list[float] = []
        self.longitudes: list[float] = []
        self.listed: list[str | None] = []
        self.game_ids: list[int] = []

    @property
    def venue_name(self) -> str:
        return self.names.most_common(1)[0][0] if self.names else "TBD"

    @property
    def city(self) -> str:
        return self.cities.most_common(1)[0][0] if self.cities else ""

    @property
    def state(self) -> str:
        return self.states.most_common(1)[0][0] if self.states else ""


def _collapsed(column: object, *, upper: bool):
    """Same whitespace and case folding as the venue key, evaluated in Postgres."""

    collapsed = func.regexp_replace(func.replace(func.coalesce(column, ""), "\xa0", " "), r"\s+", " ", "g")
    trimmed = func.trim(collapsed)
    return func.upper(trimmed) if upper else func.lower(trimmed)


def _game_rows(session: Session, *, city: str | None = None, state: str | None = None):
    statement = select(
        ScheduleGame.id,
        ScheduleGame.venue_name,
        ScheduleGame.city,
        ScheduleGame.state,
        ScheduleGame.starts_at,
        ScheduleGame.status,
        ScheduleGame.venue_lat,
        ScheduleGame.venue_lng,
        ScheduleGame.field_surface,
    )
    if state:
        statement = statement.where(_collapsed(ScheduleGame.state, upper=True) == _display_state(state))
    if city:
        statement = statement.where(_collapsed(ScheduleGame.city, upper=False) == _display_city(city).lower())
    return session.execute(statement).all()


def _buckets_from_rows(rows, now: datetime, *, require_name: bool = False) -> dict[str, ComplexBucket]:
    grouped: dict[str, ComplexBucket] = {}
    moment = _utc(now)
    for row in rows:
        raw_name = (row.venue_name or "").strip()
        if require_name and not raw_name:
            continue
        display = _display_name(raw_name)
        city = _display_city(row.city or "")
        state = _display_state(row.state or "")
        key = make_venue_key(display, city, state)
        bucket = grouped.get(key)
        if bucket is None:
            bucket = ComplexBucket(key)
            grouped[key] = bucket
        bucket.names[display] += 1
        if city:
            bucket.cities[city] += 1
        if state:
            bucket.states[state] += 1
        if raw_name:
            bucket.raw_names.add(raw_name)
        bucket.total_games += 1
        bucket.game_ids.append(row.id)
        starts = _utc(row.starts_at)
        if starts >= moment and row.status == "SCHEDULED":
            bucket.upcoming_games += 1
        if row.venue_lat is not None and row.venue_lng is not None:
            bucket.latitudes.append(float(row.venue_lat))
            bucket.longitudes.append(float(row.venue_lng))
        bucket.listed.append(row.field_surface)
    return grouped


def _complexes(session: Session, now: datetime, *, city: str | None = None, state: str | None = None) -> dict[str, ComplexBucket]:
    return _buckets_from_rows(_game_rows(session, city=city, state=state), now)


def _ratings_for_keys(session: Session, keys: set[str]) -> dict[str, list[VenueRating]]:
    grouped: dict[str, list[VenueRating]] = defaultdict(list)
    if not keys:
        return grouped
    for row in session.scalars(select(VenueRating).where(VenueRating.venue_key.in_(keys))):
        grouped[row.venue_key].append(row)
    return grouped


def _ratings_by_key(session: Session) -> dict[str, list[VenueRating]]:
    grouped: dict[str, list[VenueRating]] = defaultdict(list)
    for row in session.scalars(select(VenueRating)).all():
        grouped[row.venue_key].append(row)
    return grouped


def _recommendation_counts(session: Session, keys: set[str] | None = None) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    statement = select(VenueRecommendation.venue_key)
    if keys is not None:
        if not keys:
            return counts
        statement = statement.where(VenueRecommendation.venue_key.in_(keys))
    for row in session.scalars(statement).all():
        counts[row] += 1
    return counts


def _drive_minutes(bucket: ComplexBucket, home_lat: float | None, home_lng: float | None) -> int | None:
    if home_lat is None or home_lng is None or not bucket.latitudes or not bucket.longitudes:
        return None
    return estimate_drive_minutes(
        home_lat,
        home_lng,
        sum(bucket.latitudes) / len(bucket.latitudes),
        sum(bucket.longitudes) / len(bucket.longitudes),
    )


def _place(name: str, city: str, state: str) -> str:
    return f"{name}, {city}, {state}"


class PlaceLinks(BaseModel):
    directions: str
    hotels: str
    restaurants: str


class RatingMine(BaseModel):
    field_quality: int
    referees: int
    parent_vibe: int
    parking_access: int
    amenities: int
    surface_vote: str | None
    comment: str | None
    author_name: str | None
    updated_at: datetime


class AveragesOut(BaseModel):
    venue_key: str
    venue_name: str
    city: str
    state: str
    field_quality: float | None
    referees: float | None
    parent_vibe: float | None
    parking_access: float | None
    amenities: float | None
    overall: float | None
    ratings_count: int
    dominant_surface: str | None


class LocationCard(AveragesOut):
    listed_surface: str | None
    recommendations_count: int
    upcoming_games: int
    total_games: int
    drive_minutes: int | None


class ScoreRollup(BaseModel):
    field_quality: float | None
    referees: float | None
    parent_vibe: float | None
    parking_access: float | None
    amenities: float | None
    overall: float | None
    ratings_count: int


class LocationGameOut(BaseModel):
    id: int
    starts_at: datetime
    home_team: str
    away_team: str
    status: str
    home_score: int | None
    away_score: int | None
    field_name: str | None


class RecommendationOut(BaseModel):
    id: int
    venue_key: str
    category: str
    title: str
    rating: int
    review_text: str
    tags: list[str]
    author_name: str
    upvotes: int
    created_at: datetime
    map_url: str


class ClubTipOut(RecommendationOut):
    venue_name: str


class ClubLocationsOut(BaseModel):
    club_id: int | str
    club_name: str
    logo_url: str | None
    fields: list[LocationCard]
    aggregate: ScoreRollup
    tips: list[ClubTipOut]


class LocationDetailOut(LocationCard):
    my_rating: RatingMine | None
    recommendations: list[RecommendationOut]
    upcoming: list[LocationGameOut]
    recent: list[LocationGameOut]
    links: PlaceLinks


class RateIn(BaseModel):
    venue_name: str = Field(min_length=1, max_length=160)
    city: str = Field(min_length=1, max_length=80)
    state: str = Field(min_length=2, max_length=2)
    field_quality: int = Field(ge=1, le=5)
    referees: int = Field(ge=1, le=5)
    parent_vibe: int = Field(ge=1, le=5)
    parking_access: int = Field(ge=1, le=5)
    amenities: int = Field(ge=1, le=5)
    surface_vote: SurfaceVote | None = None
    comment: str | None = Field(default=None, max_length=2000)
    author_name: str | None = Field(default=None, max_length=80)


class RecommendationIn(BaseModel):
    venue_name: str = Field(min_length=1, max_length=160)
    city: str = Field(min_length=1, max_length=80)
    state: str = Field(min_length=2, max_length=2)
    category: TipCategory
    title: str = Field(min_length=1, max_length=160)
    rating: int = Field(ge=1, le=5)
    review_text: str = Field(min_length=1, max_length=4000)
    tags: list[str] = Field(default_factory=list)
    author_name: str | None = Field(default=None, max_length=80)


def _profile_key(x_profile_key: Annotated[str | None, Header()] = None) -> str | None:
    if x_profile_key is None:
        return None
    text = x_profile_key.strip()
    if not text:
        return None
    if len(text) > 80:
        raise HTTPException(status_code=400, detail="X-Profile-Key is too long")
    return text


def _require_profile_key(author_key: Annotated[str | None, Depends(_profile_key)]) -> str:
    if not author_key:
        raise HTTPException(status_code=400, detail="X-Profile-Key is required")
    return author_key


def _state_code(state: str) -> str:
    code = _display_state(state)
    if len(code) != 2 or not code.isalpha():
        raise HTTPException(status_code=400, detail="state must be a two-letter code")
    return code


def _place_from_body(venue_name: str, city: str, state: str) -> tuple[str, str, str, str]:
    display = _display_name(venue_name.strip())[:160]
    city_text = _display_city(city)[:80]
    if not city_text:
        raise HTTPException(status_code=400, detail="city is required")
    state_text = _state_code(state)
    return make_venue_key(display, city_text, state_text), display, city_text, state_text


def _blank(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    return text or None


def _card(
    bucket: ComplexBucket,
    ratings: list[VenueRating],
    recommendations_count: int,
    home_lat: float | None,
    home_lng: float | None,
) -> LocationCard:
    summary = _summarize(ratings)
    return LocationCard(
        venue_key=bucket.venue_key,
        venue_name=bucket.venue_name,
        city=bucket.city,
        state=bucket.state,
        field_quality=summary["field_quality"],  # type: ignore[arg-type]
        referees=summary["referees"],  # type: ignore[arg-type]
        parent_vibe=summary["parent_vibe"],  # type: ignore[arg-type]
        parking_access=summary["parking_access"],  # type: ignore[arg-type]
        amenities=summary["amenities"],  # type: ignore[arg-type]
        overall=summary["overall"],  # type: ignore[arg-type]
        ratings_count=int(summary["ratings_count"] or 0),
        dominant_surface=summary["dominant_surface"],  # type: ignore[arg-type]
        listed_surface=_listed_surface(bucket.listed),
        recommendations_count=recommendations_count,
        upcoming_games=bucket.upcoming_games,
        total_games=bucket.total_games,
        drive_minutes=_drive_minutes(bucket, home_lat, home_lng),
    )


def _mine(rows: list[VenueRating], author_key: str | None) -> RatingMine | None:
    if not author_key:
        return None
    for row in rows:
        if row.author_key == author_key:
            return RatingMine(
                field_quality=row.field_quality,
                referees=row.referees,
                parent_vibe=row.parent_vibe,
                parking_access=row.parking_access,
                amenities=row.amenities,
                surface_vote=row.surface_vote,
                comment=row.comment,
                author_name=row.author_name,
                updated_at=_utc(row.updated_at),
            )
    return None


def _recommendation_out(row: VenueRecommendation) -> RecommendationOut:
    return RecommendationOut(
        id=row.id,
        venue_key=row.venue_key,
        category=row.category,
        title=row.title,
        rating=row.rating,
        review_text=row.review_text,
        tags=_parse_tags(row.tags),
        author_name=row.author_name,
        upvotes=row.upvotes,
        created_at=_utc(row.created_at),
        map_url=_maps_search(_place(row.title, row.city, row.state)),
    )


def _games(session: Session, game_ids: list[int], now: datetime) -> tuple[list[LocationGameOut], list[LocationGameOut]]:
    if not game_ids:
        return [], []
    rows = session.scalars(
        select(ScheduleGame)
        .options(selectinload(ScheduleGame.home_team), selectinload(ScheduleGame.away_team))
        .where(ScheduleGame.id.in_(game_ids))
    ).all()
    moment = _utc(now)
    upcoming = [row for row in rows if _utc(row.starts_at) >= moment and row.status == "SCHEDULED"]
    recent = [row for row in rows if _utc(row.starts_at) < moment]
    upcoming.sort(key=lambda row: (_utc(row.starts_at), row.id))
    recent.sort(key=lambda row: (_utc(row.starts_at), row.id), reverse=True)

    def pack(row: ScheduleGame) -> LocationGameOut:
        field_name = (row.field_name or "").strip() or None
        return LocationGameOut(
            id=row.id,
            starts_at=_utc(row.starts_at),
            home_team=row.home_team.name,
            away_team=row.away_team.name,
            status=row.status,
            home_score=row.home_score,
            away_score=row.away_score,
            field_name=field_name,
        )

    return [pack(row) for row in upcoming[:GAME_LIMIT]], [pack(row) for row in recent[:GAME_LIMIT]]


def _home_pair(
    home_lat: float | None,
    home_lng: float | None,
) -> tuple[float | None, float | None]:
    if (home_lat is None) != (home_lng is None):
        raise HTTPException(status_code=400, detail="home_lat and home_lng are sent together")
    if home_lat is None or home_lng is None:
        return None, None
    if not -90 <= home_lat <= 90 or not -180 <= home_lng <= 180:
        raise HTTPException(status_code=400, detail="home coordinates are out of range")
    return home_lat, home_lng


def _matches(bucket: ComplexBucket, search: str | None, state: str | None) -> bool:
    if state and bucket.state.casefold() != state.strip().casefold():
        return False
    if search and search.strip():
        needle = search.strip().casefold()
        haystack = " ".join([bucket.venue_name, bucket.city, bucket.state, *sorted(bucket.raw_names)]).casefold()
        if needle not in haystack:
            return False
    return True


@router.get("/locations", response_model=list[LocationCard])
def list_locations(
    session: Annotated[Session, Depends(get_session)],
    search: str | None = Query(default=None, description="Venue, city, or state"),
    state: str | None = Query(default=None),
    home_lat: float | None = None,
    home_lng: float | None = None,
) -> list[LocationCard]:
    origin_lat, origin_lng = _home_pair(home_lat, home_lng)
    grouped = _complexes(session, datetime.now(UTC), state=state)
    ratings = _ratings_by_key(session)
    tips = _recommendation_counts(session)
    cards = [
        _card(bucket, ratings.get(key, []), tips.get(key, 0), origin_lat, origin_lng)
        for key, bucket in grouped.items()
        if _matches(bucket, search, state)
    ]
    cards.sort(key=lambda card: (card.venue_name.casefold(), card.city.casefold(), card.state, card.venue_key))
    return cards


def _rollup(rows: list[VenueRating]) -> ScoreRollup:
    summary = _summarize(rows)
    return ScoreRollup(
        field_quality=summary["field_quality"],  # type: ignore[arg-type]
        referees=summary["referees"],  # type: ignore[arg-type]
        parent_vibe=summary["parent_vibe"],  # type: ignore[arg-type]
        parking_access=summary["parking_access"],  # type: ignore[arg-type]
        amenities=summary["amenities"],  # type: ignore[arg-type]
        overall=summary["overall"],  # type: ignore[arg-type]
        ratings_count=int(summary["ratings_count"] or 0),
    )


def _key_place(venue_key: str) -> tuple[str, str] | None:
    """City and state stored in a venue key. The name may itself contain a pipe."""

    parts = venue_key.rsplit("|", 2)
    if len(parts) != 3:
        return None
    _name, city, state = parts
    if not city or not state:
        return None
    return city, state


@router.get("/locations/club", response_model=ClubLocationsOut)
def list_club_locations(
    session: Annotated[Session, Depends(get_session)],
    club: str = Query(description="Club id, or the split id used on the club page"),
    home_lat: float | None = None,
    home_lng: float | None = None,
) -> ClubLocationsOut:
    """Home complexes for one club, with scores and tips pooled across those fields."""

    source = club_location_source(session, club)
    if source is None:
        raise HTTPException(status_code=404, detail="Club not found")
    origin_lat, origin_lng = _home_pair(home_lat, home_lng)
    grouped = _buckets_from_rows(source.games, datetime.now(UTC), require_name=True)
    ratings = _ratings_for_keys(session, set(grouped))
    tip_counts = _recommendation_counts(session, set(grouped))
    fields: list[LocationCard] = []
    names: dict[str, str] = {}
    for key, bucket in grouped.items():
        card = _card(bucket, ratings.get(key, []), tip_counts.get(key, 0), origin_lat, origin_lng)
        fields.append(card)
        names[key] = card.venue_name
    fields.sort(key=lambda card: (card.venue_name.casefold(), card.city.casefold(), card.state, card.venue_key))
    pooled: list[VenueRating] = []
    seen = set(grouped)
    for key in seen:
        pooled.extend(ratings.get(key, []))
    tips: list[ClubTipOut] = []
    if seen:
        statement = (
            select(VenueRecommendation)
            .where(VenueRecommendation.venue_key.in_(seen))
            .order_by(VenueRecommendation.upvotes.desc(), VenueRecommendation.created_at.desc(), VenueRecommendation.id.desc())
        )
        for row in session.scalars(statement).all():
            packed = _recommendation_out(row)
            tips.append(ClubTipOut(**packed.model_dump(), venue_name=names.get(row.venue_key, row.venue_name)))
    return ClubLocationsOut(
        club_id=source.id,
        club_name=source.name,
        logo_url=source.logo_url,
        fields=fields,
        aggregate=_rollup(pooled),
        tips=tips,
    )


def _resolve_key(
    session: Session,
    venue_key: str | None,
    venue_name: str | None,
    city: str | None,
    state: str | None,
) -> str:
    if venue_key and venue_key.strip():
        return venue_key.strip()
    if venue_name and city and state:
        key, _name, _city, _state = _place_from_body(venue_name, city, state)
        return key
    raise HTTPException(status_code=400, detail="venue_key or venue name, city, and state is required")


@router.get("/locations/detail", response_model=LocationDetailOut)
def location_detail(
    session: Annotated[Session, Depends(get_session)],
    author_key: Annotated[str | None, Depends(_profile_key)],
    venue_key: str | None = None,
    venue_name: str | None = None,
    city: str | None = None,
    state: str | None = None,
    category: str | None = None,
    home: str | None = Query(default=None, description="Saved profile home address, when the browser has one"),
    home_lat: float | None = None,
    home_lng: float | None = None,
) -> LocationDetailOut:
    if category is not None and category not in CATEGORIES:
        raise HTTPException(status_code=400, detail="category is not a tip category")
    origin_lat, origin_lng = _home_pair(home_lat, home_lng)
    key = _resolve_key(session, venue_key, venue_name, city, state)
    now = datetime.now(UTC)
    place = _key_place(key)
    if place is None:
        grouped = _complexes(session, now)
    else:
        grouped = _complexes(session, now, city=place[0], state=place[1])
    bucket = grouped.get(key)
    ratings = list(session.scalars(select(VenueRating).where(VenueRating.venue_key == key)).all())
    if bucket is None and not ratings:
        stored = session.scalars(select(VenueRecommendation).where(VenueRecommendation.venue_key == key).limit(1)).first()
        if stored is None:
            raise HTTPException(status_code=404, detail="Complex not found")
        bucket = ComplexBucket(key)
        bucket.names[stored.venue_name] += 1
        bucket.cities[stored.city] += 1
        bucket.states[stored.state] += 1
    elif bucket is None:
        bucket = ComplexBucket(key)
        bucket.names[ratings[0].venue_name] += 1
        bucket.cities[ratings[0].city] += 1
        bucket.states[ratings[0].state] += 1

    statement = select(VenueRecommendation).where(VenueRecommendation.venue_key == key)
    if category:
        statement = statement.where(VenueRecommendation.category == category)
    statement = statement.order_by(VenueRecommendation.upvotes.desc(), VenueRecommendation.created_at.desc(), VenueRecommendation.id.desc())
    tips = list(session.scalars(statement).all())
    upcoming, recent = _games(session, bucket.game_ids, now)
    place = _place(bucket.venue_name, bucket.city, bucket.state)
    origin = (home or "").strip()[:240] or None
    card = _card(bucket, ratings, len(tips) if category is None else _recommendation_counts(session).get(key, 0), origin_lat, origin_lng)
    return LocationDetailOut(
        **card.model_dump(),
        my_rating=_mine(ratings, author_key),
        recommendations=[_recommendation_out(row) for row in tips],
        upcoming=upcoming,
        recent=recent,
        links=PlaceLinks(
            directions=_maps_directions(place, origin),
            hotels=_maps_search(f"hotels near {place}"),
            restaurants=_maps_search(f"restaurants near {place}"),
        ),
    )


def _averages_out(session: Session, venue_key: str, venue_name: str, city: str, state: str) -> AveragesOut:
    rows = list(session.scalars(select(VenueRating).where(VenueRating.venue_key == venue_key)).all())
    summary = _summarize(rows)
    return AveragesOut(
        venue_key=venue_key,
        venue_name=venue_name,
        city=city,
        state=state,
        field_quality=summary["field_quality"],  # type: ignore[arg-type]
        referees=summary["referees"],  # type: ignore[arg-type]
        parent_vibe=summary["parent_vibe"],  # type: ignore[arg-type]
        parking_access=summary["parking_access"],  # type: ignore[arg-type]
        amenities=summary["amenities"],  # type: ignore[arg-type]
        overall=summary["overall"],  # type: ignore[arg-type]
        ratings_count=int(summary["ratings_count"] or 0),
        dominant_surface=summary["dominant_surface"],  # type: ignore[arg-type]
    )


@router.post("/locations/rate", response_model=AveragesOut)
def rate_location(
    payload: RateIn,
    session: Annotated[Session, Depends(get_session)],
    author_key: Annotated[str, Depends(_require_profile_key)],
) -> AveragesOut:
    venue_key, venue_name, city, state = _place_from_body(payload.venue_name, payload.city, payload.state)
    existing = session.scalar(
        select(VenueRating).where(VenueRating.venue_key == venue_key, VenueRating.author_key == author_key)
    )
    comment = _blank(payload.comment)
    author_name = _blank(payload.author_name)
    if author_name:
        author_name = author_name[:80]
    if existing is None:
        existing = VenueRating(
            venue_key=venue_key,
            venue_name=venue_name,
            city=city,
            state=state,
            author_key=author_key,
            user_id=None,
            author_name=author_name,
            field_quality=payload.field_quality,
            referees=payload.referees,
            parent_vibe=payload.parent_vibe,
            parking_access=payload.parking_access,
            amenities=payload.amenities,
            surface_vote=payload.surface_vote,
            comment=comment,
            updated_at=datetime.now(UTC),
        )
        session.add(existing)
    else:
        existing.venue_name = venue_name
        existing.city = city
        existing.state = state
        existing.user_id = None
        existing.author_name = author_name
        existing.field_quality = payload.field_quality
        existing.referees = payload.referees
        existing.parent_vibe = payload.parent_vibe
        existing.parking_access = payload.parking_access
        existing.amenities = payload.amenities
        existing.surface_vote = payload.surface_vote
        existing.comment = comment
        existing.updated_at = datetime.now(UTC)
    session.commit()
    return _averages_out(session, venue_key, venue_name, city, state)


@router.post("/locations/recommendations", response_model=RecommendationOut)
def add_recommendation(
    payload: RecommendationIn,
    session: Annotated[Session, Depends(get_session)],
    author_key: Annotated[str, Depends(_require_profile_key)],
) -> RecommendationOut:
    venue_key, venue_name, city, state = _place_from_body(payload.venue_name, payload.city, payload.state)
    title = " ".join(payload.title.split())
    review = payload.review_text.strip()
    if not title or not review:
        raise HTTPException(status_code=400, detail="title and review_text are required")
    author_name = _blank(payload.author_name) or "ECNL Family"
    row = VenueRecommendation(
        venue_key=venue_key,
        venue_name=venue_name,
        city=city,
        state=state,
        category=payload.category,
        title=title[:160],
        rating=payload.rating,
        review_text=review,
        tags=_normalize_tags(payload.tags),
        author_name=author_name[:80],
        author_key=author_key,
        user_id=None,
        upvotes=0,
        created_at=datetime.now(UTC),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _recommendation_out(row)


@router.post("/locations/recommendations/{recommendation_id}/upvote", response_model=RecommendationOut)
def upvote_recommendation(
    recommendation_id: int,
    session: Annotated[Session, Depends(get_session)],
) -> RecommendationOut:
    row = session.get(VenueRecommendation, recommendation_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Tip not found")
    row.upvotes = int(row.upvotes or 0) + 1
    session.commit()
    session.refresh(row)
    return _recommendation_out(row)
