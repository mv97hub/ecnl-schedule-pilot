"""Family ratings and tips for schedule complexes.

One complex is one place. Field numbers are stripped with the same split the
schedule already uses, then the cleaned name, lowercase city, and state form
`venue_key`. Ratings, tips, and votes require a signed-in account. Older rows
that still use a browser `author_key` stay readable and are not rewritten.

A hotel or restaurant tip can store a Geoapify match. The key stays on the
server. Hangout, activity, and sideline tips stay free text.
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
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.auth import author_for, bearer_token, has_current_terms, require_admin, require_bearer, require_user, user_from_token
from app.clubs import club_location_source
from app.database import get_session
from app.ingestion.normalizer import split_venue
from app.models import (
    AppUser,
    ContentFlag,
    LocationWriteEvent,
    ScheduleGame,
    VenueFieldPoint,
    VenueRating,
    VenueRecommendation,
    VenueTipVote,
)
from app.places import (
    MIN_QUERY_CHARS,
    NEAR_MILES,
    PROVIDER,
    GeocodeHit,
    PlaceHit,
    PlacesBusy,
    PlacesUnavailable,
    category_fits,
    claim_place_slot,
    clean_place_id,
    PIN_RULE_ADMIN,
    PIN_RULE_MAPS,
    PIN_RULE_MATCH,
    PIN_RULE_MISS,
    FieldLookup,
    geocode_complex,
    lookup_field_pin,
    miles_between,
    retrieve_place,
    suggest_places,
)

router = APIRouter(tags=["locations"])

SurfaceVote = Literal["GRASS", "TURF", "MIXED"]
TipCategory = Literal["HOTEL", "RESTAURANT", "COFFEE_GAP", "ACTIVITY", "SIDELINE_TIP"]
VoteChoice = Literal["up", "down"]
CATEGORIES = {"HOTEL", "RESTAURANT", "COFFEE_GAP", "ACTIVITY", "SIDELINE_TIP"}
MATCH_CATEGORIES = frozenset({"HOTEL", "RESTAURANT"})
PLACE_UNAVAILABLE = "Place lookup is unavailable"
PLACE_BUSY = "Too many place lookups. You can still save the name as typed."
PLACE_NOT_NEAR = "That place is not near this field. You can still save the name as typed."
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
    for row in session.scalars(
        select(VenueRating).where(VenueRating.venue_key.in_(keys), VenueRating.hidden_at.is_(None))
    ):
        grouped[row.venue_key].append(row)
    return grouped


def _ratings_by_key(session: Session) -> dict[str, list[VenueRating]]:
    grouped: dict[str, list[VenueRating]] = defaultdict(list)
    for row in session.scalars(select(VenueRating).where(VenueRating.hidden_at.is_(None))).all():
        grouped[row.venue_key].append(row)
    return grouped


def _recommendation_counts(session: Session, keys: set[str] | None = None) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    statement = select(VenueRecommendation.venue_key).where(VenueRecommendation.hidden_at.is_(None))
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
    edited: bool = False


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
    downvotes: int
    my_vote: VoteChoice | None
    created_at: datetime
    map_url: str
    edited: bool = False
    matched_name: str | None = None
    formatted_address: str | None = None
    place_provider: str | None = None


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
    place_id: str | None = Field(default=None, max_length=512)
    formatted_address: str | None = Field(default=None, max_length=500)


class FieldPointOut(BaseModel):
    venue_key: str
    status: Literal["found", "miss", "skipped"]
    formatted_address: str | None = None
    map_url: str | None = None


class PlaceSuggestionOut(BaseModel):
    place_id: str
    name: str
    formatted_address: str
    street: str = ""
    city: str = ""
    state: str = ""
    postal_code: str = ""
    latitude: float | None = None
    longitude: float | None = None


class MapFieldOut(BaseModel):
    venue_key: str
    venue_name: str
    city: str
    state: str
    status: str
    latitude: float | None = None
    longitude: float | None = None
    formatted_address: str | None = None


class MapTipOut(BaseModel):
    id: int
    venue_key: str
    category: str
    title: str
    rating: int
    formatted_address: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    distance_miles: float | None = None
    map_url: str


class FieldMapOut(MapFieldOut):
    tips: list[MapTipOut] = []


class ClubMapOut(BaseModel):
    club_id: int | str
    club_name: str
    fields: list[MapFieldOut] = []


class PlaceSuggestionsOut(BaseModel):
    suggestions: list[PlaceSuggestionOut]


class VoteIn(BaseModel):
    choice: VoteChoice


class FlagOut(BaseModel):
    already_reported: bool
    hidden: bool
    message: str


def _profile_key(x_profile_key: Annotated[str | None, Header()] = None) -> str | None:
    if x_profile_key is None:
        return None
    text = x_profile_key.strip()
    if not text:
        return None
    if len(text) > 80:
        raise HTTPException(status_code=400, detail="X-Profile-Key is too long")
    return text


def _reader_key(session: Session, token: str | None, profile_key: str | None) -> str | None:
    """The signed-in account wins. A browser key still finds an older anonymous row."""

    if token:
        user = user_from_token(session, token)
        if user is not None:
            return f"user:{user.id}"
    return profile_key


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
                edited=row.edited_at is not None,
            )
    return None


def _tip_order():
    score = VenueRecommendation.upvotes - VenueRecommendation.downvotes
    return (score.desc(), VenueRecommendation.created_at.desc(), VenueRecommendation.id.desc())


def _my_votes(session: Session, tip_ids: list[int], author_key: str | None) -> dict[int, str]:
    if not author_key or not tip_ids:
        return {}
    rows = session.scalars(
        select(VenueTipVote).where(
            VenueTipVote.recommendation_id.in_(tip_ids),
            VenueTipVote.author_key == author_key,
        )
    ).all()
    return {row.recommendation_id: row.choice for row in rows}


def _tip_map_query(row: VenueRecommendation) -> str:
    address = (row.formatted_address or "").strip()
    if address:
        return address
    return _place(row.title, row.city, row.state)


def _recommendation_out(row: VenueRecommendation, my_vote: str | None = None) -> RecommendationOut:
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
        downvotes=row.downvotes,
        my_vote=my_vote if my_vote in ("up", "down") else None,
        created_at=_utc(row.created_at),
        map_url=_maps_search(_tip_map_query(row)),
        edited=row.edited_at is not None,
        matched_name=row.matched_name,
        formatted_address=row.formatted_address,
        place_provider=row.place_provider,
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
    author_key: Annotated[str | None, Depends(_profile_key)],
    token: Annotated[str | None, Depends(bearer_token)],
    club: str = Query(description="Club id, or the split id used on the club page"),
    home_lat: float | None = None,
    home_lng: float | None = None,
) -> ClubLocationsOut:
    """Home complexes for one club, with scores and tips pooled across those fields."""

    author_key = _reader_key(session, token, author_key)
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
            .where(VenueRecommendation.venue_key.in_(seen), VenueRecommendation.hidden_at.is_(None))
            .order_by(*_tip_order())
        )
        rows = list(session.scalars(statement).all())
        votes = _my_votes(session, [row.id for row in rows], author_key)
        for row in rows:
            packed = _recommendation_out(row, votes.get(row.id))
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
    token: Annotated[str | None, Depends(bearer_token)],
    venue_key: str | None = None,
    venue_name: str | None = None,
    city: str | None = None,
    state: str | None = None,
    category: str | None = None,
    home: str | None = Query(default=None, description="Saved profile home address, when the browser has one"),
    home_lat: float | None = None,
    home_lng: float | None = None,
) -> LocationDetailOut:
    author_key = _reader_key(session, token, author_key)
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
    ratings = list(
        session.scalars(
            select(VenueRating).where(VenueRating.venue_key == key, VenueRating.hidden_at.is_(None))
        ).all()
    )
    if bucket is None and not ratings:
        stored = session.scalars(
            select(VenueRecommendation)
            .where(VenueRecommendation.venue_key == key, VenueRecommendation.hidden_at.is_(None))
            .limit(1)
        ).first()
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

    statement = select(VenueRecommendation).where(
        VenueRecommendation.venue_key == key,
        VenueRecommendation.hidden_at.is_(None),
    )
    if category:
        statement = statement.where(VenueRecommendation.category == category)
    statement = statement.order_by(*_tip_order())
    tips = list(session.scalars(statement).all())
    votes = _my_votes(session, [row.id for row in tips], author_key)
    upcoming, recent = _games(session, bucket.game_ids, now)
    place = _place(bucket.venue_name, bucket.city, bucket.state)
    origin = (home or "").strip()[:240] or None
    card = _card(bucket, ratings, len(tips) if category is None else _recommendation_counts(session).get(key, 0), origin_lat, origin_lng)
    return LocationDetailOut(
        **card.model_dump(),
        my_rating=_mine(ratings, author_key),
        recommendations=[_recommendation_out(row, votes.get(row.id)) for row in tips],
        upcoming=upcoming,
        recent=recent,
        links=PlaceLinks(
            directions=_maps_directions(place, origin),
            hotels=_maps_search(f"hotels near {place}"),
            restaurants=_maps_search(f"restaurants near {place}"),
        ),
    )


def _rating_values(row: VenueRating) -> dict[str, object]:
    return {
        "field_quality": row.field_quality,
        "referees": row.referees,
        "parent_vibe": row.parent_vibe,
        "parking_access": row.parking_access,
        "amenities": row.amenities,
        "surface": row.surface_vote,
        "comment": row.comment,
    }


def _tip_values(row: VenueRecommendation) -> dict[str, object]:
    values: dict[str, object] = {
        "category": row.category,
        "title": row.title,
        "stars": row.rating,
        "review_text": row.review_text,
        "tags": row.tags,
    }
    if row.place_provider:
        values["place_provider"] = row.place_provider
        values["place_id"] = row.place_id
        values["matched_name"] = row.matched_name
        values["formatted_address"] = row.formatted_address
        values["latitude"] = row.latitude
        values["longitude"] = row.longitude
    elif row.formatted_address:
        values["formatted_address"] = row.formatted_address
    return values


def _record_write(
    session: Session,
    user: AppUser,
    *,
    kind: str,
    venue_key: str,
    venue_name: str,
    rating_id: int | None,
    tip_id: int | None,
    action: str,
    previous: dict[str, object] | None,
    new: dict[str, object],
) -> None:
    """Append one history row in the caller's transaction. Nothing here is updated later."""

    session.add(
        LocationWriteEvent(
            created_at=datetime.now(UTC),
            user_id=int(user.id),
            email=user.email,
            display_name=user.display_name,
            kind=kind,
            venue_key=venue_key,
            venue_name=venue_name,
            rating_id=rating_id,
            tip_id=tip_id,
            action=action,
            previous_values=previous,
            new_values=new,
        )
    )


def _require_terms(user: AppUser) -> None:
    if not has_current_terms(user):
        raise HTTPException(status_code=403, detail="Agree to the Terms of Use before posting")


def _averages_out(session: Session, venue_key: str, venue_name: str, city: str, state: str) -> AveragesOut:
    rows = list(
        session.scalars(
            select(VenueRating).where(VenueRating.venue_key == venue_key, VenueRating.hidden_at.is_(None))
        ).all()
    )
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
    token: Annotated[str, Depends(require_bearer)],
) -> AveragesOut:
    user = require_user(session, token)
    _require_terms(user)
    user_id, author_key, author_name = author_for(user)
    venue_key, venue_name, city, state = _place_from_body(payload.venue_name, payload.city, payload.state)
    existing = session.scalar(
        select(VenueRating).where(VenueRating.venue_key == venue_key, VenueRating.author_key == author_key)
    )
    comment = _blank(payload.comment)
    previous: dict[str, object] | None = None
    action = "create"
    if existing is None:
        existing = VenueRating(
            venue_key=venue_key,
            venue_name=venue_name,
            city=city,
            state=state,
            author_key=author_key,
            user_id=user_id,
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
        previous = _rating_values(existing)
        action = "update"
        existing.venue_name = venue_name
        existing.city = city
        existing.state = state
        existing.user_id = user_id
        existing.author_name = author_name
        existing.field_quality = payload.field_quality
        existing.referees = payload.referees
        existing.parent_vibe = payload.parent_vibe
        existing.parking_access = payload.parking_access
        existing.amenities = payload.amenities
        existing.surface_vote = payload.surface_vote
        if existing.comment != comment:
            existing.edited_at = None
        existing.comment = comment
        existing.updated_at = datetime.now(UTC)
    session.flush()
    _record_write(
        session,
        user,
        kind="rating",
        venue_key=venue_key,
        venue_name=venue_name,
        rating_id=existing.id,
        tip_id=None,
        action=action,
        previous=previous,
        new=_rating_values(existing),
    )
    session.commit()
    return _averages_out(session, venue_key, venue_name, city, state)


def _is_tbd(venue_name: str) -> bool:
    return clean_venue_for_geocoding(venue_name).casefold() == "tbd"


def _place_failure(exc: Exception) -> HTTPException:
    if isinstance(exc, PlacesBusy):
        return HTTPException(status_code=429, detail=PLACE_BUSY)
    return HTTPException(status_code=503, detail=PLACE_UNAVAILABLE)


def _insert_field_point(session: Session, row: VenueFieldPoint) -> VenueFieldPoint:
    session.add(row)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        existing = session.get(VenueFieldPoint, row.venue_key)
        if existing is None:
            raise HTTPException(status_code=503, detail=PLACE_UNAVAILABLE) from None
        return existing
    return row


def ensure_field_point(
    session: Session,
    user_id: int | None,
    venue_key: str,
    venue_name: str,
    city: str,
    state: str,
) -> VenueFieldPoint:
    """Return the cached field point, geocoding once when this complex has none.

    ``user_id`` is ``None`` for the map previews: the lookup is charged to no
    account, but the result is still cached per complex so each field is
    geocoded at most once.
    """

    existing = session.get(VenueFieldPoint, venue_key)
    if existing is not None:
        return existing
    skipped = _is_tbd(venue_name)
    session.rollback()
    now = datetime.now(UTC)
    if skipped:
        return _insert_field_point(
            session,
            VenueFieldPoint(
                venue_key=venue_key,
                venue_name=venue_name,
                city=city,
                state=state,
                status="skipped",
                fetched_at=now,
            ),
        )
    try:
        if user_id is not None:
            claim_place_slot(user_id)
        hit: GeocodeHit | None = geocode_complex(venue_name, city, state)
    except (PlacesBusy, PlacesUnavailable) as exc:
        raise _place_failure(exc) from None
    if hit is None:
        return _insert_field_point(
            session,
            VenueFieldPoint(
                venue_key=venue_key,
                venue_name=venue_name,
                city=city,
                state=state,
                status="miss",
                fetched_at=now,
            ),
        )
    return _insert_field_point(
        session,
        VenueFieldPoint(
            venue_key=venue_key,
            venue_name=venue_name,
            city=city,
            state=state,
            status="found",
            provider=PROVIDER,
            place_id=hit.place_id,
            formatted_address=hit.formatted_address,
            latitude=hit.latitude,
            longitude=hit.longitude,
            fetched_at=now,
        ),
    )


def _field_point_out(row: VenueFieldPoint) -> FieldPointOut:
    address = (row.formatted_address or "").strip() or None
    return FieldPointOut(
        venue_key=row.venue_key,
        status=row.status,  # type: ignore[arg-type]
        formatted_address=address,
        map_url=_maps_search(address) if address else None,
    )


def _matched_place(
    session: Session,
    user_id: int,
    category: str,
    place_id: str,
    venue_key: str,
) -> PlaceHit:
    point = session.get(VenueFieldPoint, venue_key)
    latitude = point.latitude if point is not None and point.status == "found" else None
    longitude = point.longitude if point is not None and point.status == "found" else None
    session.rollback()
    if latitude is None or longitude is None:
        raise HTTPException(status_code=400, detail=PLACE_NOT_NEAR)
    try:
        claim_place_slot(user_id)
        hit = retrieve_place(place_id)
    except (PlacesBusy, PlacesUnavailable) as exc:
        raise _place_failure(exc) from None
    if hit is None or not category_fits(category, hit.categories):
        raise HTTPException(status_code=400, detail=PLACE_NOT_NEAR)
    if miles_between(latitude, longitude, hit.latitude, hit.longitude) > NEAR_MILES:
        raise HTTPException(status_code=400, detail=PLACE_NOT_NEAR)
    return hit


def _manual_address(value: str | None) -> str | None:
    if value is None:
        return None
    text = " ".join(value.split())
    if not text:
        return None
    return text[:500]


def _apply_match(row: VenueRecommendation, hit: PlaceHit) -> None:
    row.place_provider = PROVIDER
    row.place_id = hit.place_id
    row.matched_name = hit.name[:200]
    row.formatted_address = hit.formatted_address[:500]
    row.latitude = hit.latitude
    row.longitude = hit.longitude
    row.place_fetched_at = datetime.now(UTC)


_SAVED_PIN_RULES = frozenset({PIN_RULE_MATCH, PIN_RULE_MISS, PIN_RULE_ADMIN, PIN_RULE_MAPS})


def _map_from_row(bucket: ComplexBucket, row: VenueFieldPoint) -> MapFieldOut:
    return MapFieldOut(
        venue_key=bucket.venue_key,
        venue_name=bucket.venue_name if bucket.names else row.venue_name,
        city=bucket.city or row.city,
        state=bucket.state or row.state,
        status=row.status,  # type: ignore[arg-type]
        latitude=row.latitude if row.status == "found" else None,
        longitude=row.longitude if row.status == "found" else None,
        formatted_address=(row.formatted_address or "").strip() or None,
    )


def _apply_lookup(row: VenueFieldPoint, lookup: FieldLookup, now: datetime) -> None:
    hit = lookup.hit
    if hit is None:
        row.status = "miss"
        row.provider = None
        row.place_id = None
        row.formatted_address = None
        row.latitude = None
        row.longitude = None
        row.geocode_kind = lookup.outcome if lookup.outcome in {"no-city", "rejected"} else "miss"
        row.pin_rule = PIN_RULE_MISS
        return
    row.status = "found"
    row.provider = PROVIDER
    row.place_id = hit.place_id
    row.formatted_address = hit.formatted_address
    row.latitude = hit.latitude
    row.longitude = hit.longitude
    row.geocode_kind = "venue"
    row.pin_rule = PIN_RULE_MATCH


def _save_map_geocode(session: Session, bucket: ComplexBucket, lookup: FieldLookup) -> VenueFieldPoint:
    """Store a passing pin, or clear coordinates when the lookup does not pass.

    A later view reads this row and does not call Geoapify again. An admin
    replacement, and a pin the Maps check cleared, are left as stored.
    Nothing here is marked verified.
    """

    now = datetime.now(UTC)
    row = session.get(VenueFieldPoint, bucket.venue_key)
    if row is not None and row.pin_rule in {PIN_RULE_ADMIN, PIN_RULE_MAPS}:
        return row
    if row is None:
        row = VenueFieldPoint(
            venue_key=bucket.venue_key,
            venue_name=bucket.venue_name,
            city=bucket.city,
            state=bucket.state,
            status="miss",
            fetched_at=now,
        )
        _apply_lookup(row, lookup, now)
        session.add(row)
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            existing = session.get(VenueFieldPoint, bucket.venue_key)
            if existing is None:
                raise HTTPException(status_code=503, detail=PLACE_UNAVAILABLE) from None
            return existing
        session.refresh(row)
        return row
    _apply_lookup(row, lookup, now)
    session.commit()
    session.refresh(row)
    return row


def _resolve_map_field(session: Session, bucket: ComplexBucket) -> MapFieldOut:
    """Read a saved pin, or look the field up once when none is saved.

    Schedule coordinates are not used. A result that fails the name, state,
    or distance checks is stored with no coordinates.
    """

    base = {"venue_key": bucket.venue_key, "venue_name": bucket.venue_name, "city": bucket.city, "state": bucket.state}
    if _is_tbd(bucket.venue_name):
        return MapFieldOut(**base, status="skipped")
    cached = session.get(VenueFieldPoint, bucket.venue_key)
    if cached is not None and (cached.pin_rule or "") in _SAVED_PIN_RULES:
        return _map_from_row(bucket, cached)
    session.rollback()
    if not bucket.city or not bucket.state:
        return MapFieldOut(**base, status="skipped")
    try:
        lookup = lookup_field_pin(bucket.venue_name, bucket.city, bucket.state)
    except PlacesUnavailable:
        return MapFieldOut(**base, status="unavailable")
    return _map_from_row(bucket, _save_map_geocode(session, bucket, lookup))


def _map_tip(row: VenueRecommendation, field: MapFieldOut) -> MapTipOut:
    distance = None
    if field.latitude is not None and field.longitude is not None and row.latitude is not None and row.longitude is not None:
        distance = round(miles_between(field.latitude, field.longitude, row.latitude, row.longitude), 1)
    return MapTipOut(
        id=row.id,
        venue_key=row.venue_key,
        category=row.category,
        title=(row.matched_name or "").strip() or row.title,
        rating=row.rating,
        formatted_address=row.formatted_address,
        latitude=row.latitude,
        longitude=row.longitude,
        distance_miles=distance,
        map_url=_maps_search(_tip_map_query(row)),
    )


@router.get("/locations/map/field", response_model=FieldMapOut)
def read_field_map(
    session: Annotated[Session, Depends(get_session)],
    venue_key: str = Query(min_length=1, max_length=300),
) -> FieldMapOut:
    """Map point for one field plus its pinned tips, nearest first. Geocodes only this field, once, cached."""

    key = venue_key.strip()
    place = _key_place(key)
    grouped = _complexes(session, datetime.now(UTC), city=place[0], state=place[1]) if place else {}
    bucket = grouped.get(key)
    tips = list(
        session.scalars(
            select(VenueRecommendation).where(VenueRecommendation.venue_key == key, VenueRecommendation.hidden_at.is_(None))
        ).all()
    )
    if bucket is None:
        if session.get(VenueFieldPoint, key) is None and not tips:
            raise HTTPException(status_code=404, detail="Complex not found")
        bucket = ComplexBucket(key)
        if tips:
            bucket.names[tips[0].venue_name] += 1
            bucket.cities[tips[0].city] += 1
            bucket.states[tips[0].state] += 1
    field = _resolve_map_field(session, bucket)
    packed = [_map_tip(row, field) for row in tips]
    packed.sort(key=lambda tip: (tip.distance_miles is None, tip.distance_miles or 0.0, -tip.rating, tip.id))
    return FieldMapOut(**field.model_dump(), tips=packed)


@router.get("/locations/map/club", response_model=ClubMapOut)
def read_club_map(
    session: Annotated[Session, Depends(get_session)],
    club: str = Query(description="Club id, or the split id used on the club page"),
) -> ClubMapOut:
    """Saved pins for one club's home fields. Fields with no saved point are looked up once."""

    source = club_location_source(session, club)
    if source is None:
        raise HTTPException(status_code=404, detail="Club not found")
    grouped = _buckets_from_rows(source.games, datetime.now(UTC), require_name=True)
    fields = [_resolve_map_field(session, bucket) for bucket in grouped.values()]
    fields.sort(key=lambda item: (item.venue_name.casefold(), item.city.casefold(), item.state, item.venue_key))
    return ClubMapOut(club_id=source.id, club_name=source.name, fields=fields)


class AdminFieldPinIn(BaseModel):
    venue_key: str = Field(min_length=1, max_length=300)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class AdminFieldPinClear(BaseModel):
    venue_key: str = Field(min_length=1, max_length=300)


class AdminFieldPinOut(BaseModel):
    venue_key: str
    venue_name: str
    city: str
    state: str
    status: str
    latitude: float | None = None
    longitude: float | None = None
    formatted_address: str | None = None
    pin_rule: str | None = None
    note: str


def _admin_pin_out(row: VenueFieldPoint, note: str) -> AdminFieldPinOut:
    return AdminFieldPinOut(
        venue_key=row.venue_key,
        venue_name=row.venue_name,
        city=row.city,
        state=row.state,
        status=row.status,
        latitude=row.latitude if row.status == "found" else None,
        longitude=row.longitude if row.status == "found" else None,
        formatted_address=(row.formatted_address or "").strip() or None,
        pin_rule=row.pin_rule,
        note=note,
    )


def _admin_pin_key(venue_key: str) -> str:
    key = venue_key.strip()
    parts = key.rsplit("|", 2)
    if len(parts) != 3 or not all(part.strip() for part in parts):
        raise HTTPException(status_code=400, detail="Use the field key shown on the map explorer.")
    return key


@router.get("/admin/field-pins", response_model=AdminFieldPinOut)
def read_admin_field_pin(
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
    venue_key: str = Query(min_length=1, max_length=300),
) -> AdminFieldPinOut:
    """Saved pin for one field. Admins only. This is not a verification."""

    require_admin(session, token)
    row = session.get(VenueFieldPoint, _admin_pin_key(venue_key))
    if row is None:
        raise HTTPException(status_code=404, detail="No saved pin for that field.")
    return _admin_pin_out(row, "Saved pin. This is not marked as verified.")


@router.post("/admin/field-pins", response_model=AdminFieldPinOut)
def replace_admin_field_pin(
    body: AdminFieldPinIn,
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
) -> AdminFieldPinOut:
    """Replace a saved pin with coordinates an admin entered. Does not mark it verified."""

    require_admin(session, token)
    key = _admin_pin_key(body.venue_key)
    name, city, state = key.rsplit("|", 2)
    now = datetime.now(UTC)
    row = session.get(VenueFieldPoint, key)
    if row is None:
        row = VenueFieldPoint(
            venue_key=key,
            venue_name=name,
            city=city,
            state=state.upper(),
            status="found",
            fetched_at=now,
        )
        session.add(row)
    row.status = "found"
    row.latitude = body.latitude
    row.longitude = body.longitude
    row.provider = None
    row.place_id = None
    row.geocode_kind = "admin"
    row.pin_rule = PIN_RULE_ADMIN
    row.fetched_at = now
    session.commit()
    session.refresh(row)
    return _admin_pin_out(row, "Saved pin replaced. This does not mark the location as verified.")


@router.post("/admin/field-pins/clear", response_model=AdminFieldPinOut)
def clear_admin_field_pin(
    body: AdminFieldPinClear,
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
) -> AdminFieldPinOut:
    """Drop a saved pin so the next visit can look the field up again."""

    require_admin(session, token)
    key = _admin_pin_key(body.venue_key)
    row = session.get(VenueFieldPoint, key)
    if row is None:
        raise HTTPException(status_code=404, detail="No saved pin for that field.")
    name, city, state = row.venue_name, row.city, row.state
    session.delete(row)
    session.commit()
    return AdminFieldPinOut(
        venue_key=key,
        venue_name=name,
        city=city,
        state=state,
        status="miss",
        note="Saved pin removed. The next visit can look this field up again. That lookup is not a verification.",
    )


@router.get("/locations/field-point", response_model=FieldPointOut)
def read_field_point(
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
    venue_name: str = Query(min_length=1, max_length=160),
    city: str = Query(min_length=1, max_length=80),
    state: str = Query(min_length=2, max_length=2),
) -> FieldPointOut:
    """Geocode this complex once. The browser receives the label, not the key or the raw point."""

    user = require_user(session, token)
    _require_terms(user)
    venue_key, display, city_text, state_text = _place_from_body(venue_name, city, state)
    row = ensure_field_point(session, int(user.id), venue_key, display, city_text, state_text)
    return _field_point_out(row)


@router.get("/locations/places", response_model=PlaceSuggestionsOut)
def read_place_suggestions(
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
    venue_key: str = Query(min_length=1, max_length=300),
    category: str = Query(min_length=1, max_length=16),
    q: str = Query(default="", max_length=80),
) -> PlaceSuggestionsOut:
    """Suggest hotels or restaurants within twenty-five miles of the cached field point. Short queries do not call Geoapify."""

    user = require_user(session, token)
    _require_terms(user)
    user_id = int(user.id)
    if category not in MATCH_CATEGORIES:
        raise HTTPException(status_code=400, detail="Place search is only for a hotel or a restaurant.")
    query = " ".join(q.split())
    if len(query) < MIN_QUERY_CHARS:
        return PlaceSuggestionsOut(suggestions=[])
    key = venue_key.strip()
    point = session.get(VenueFieldPoint, key)
    latitude = point.latitude if point is not None and point.status == "found" else None
    longitude = point.longitude if point is not None and point.status == "found" else None
    session.rollback()
    if latitude is None or longitude is None:
        return PlaceSuggestionsOut(suggestions=[])
    try:
        claim_place_slot(user_id)
        hits = suggest_places(query, category, latitude, longitude)
    except (PlacesBusy, PlacesUnavailable) as exc:
        raise _place_failure(exc) from None
    return PlaceSuggestionsOut(
        suggestions=[
            PlaceSuggestionOut(
                place_id=hit.place_id,
                name=hit.name,
                formatted_address=hit.formatted_address,
                street=hit.street,
                city=hit.city,
                state=hit.state,
                postal_code=hit.postal_code,
                latitude=hit.latitude,
                longitude=hit.longitude,
            )
            for hit in hits
        ]
    )


@router.post("/locations/recommendations", response_model=RecommendationOut)
def add_recommendation(
    payload: RecommendationIn,
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
) -> RecommendationOut:
    user = require_user(session, token)
    _require_terms(user)
    user_id, author_key, author_name = author_for(user)
    account_id = int(user.id)
    venue_key, venue_name, city, state = _place_from_body(payload.venue_name, payload.city, payload.state)
    title = " ".join(payload.title.split())
    review = payload.review_text.strip()
    if not title or not review:
        raise HTTPException(status_code=400, detail="title and review_text are required")
    try:
        place_id = clean_place_id(payload.place_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Unknown place") from None
    match: PlaceHit | None = None
    if place_id and payload.category in MATCH_CATEGORIES:
        match = _matched_place(session, account_id, payload.category, place_id, venue_key)
    manual = _manual_address(payload.formatted_address) if payload.category in MATCH_CATEGORIES and match is None else None
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
        author_name=author_name,
        author_key=author_key,
        user_id=user_id,
        upvotes=0,
        downvotes=0,
        created_at=datetime.now(UTC),
    )
    if match is not None:
        _apply_match(row, match)
    elif manual:
        row.formatted_address = manual
    session.add(row)
    session.flush()
    _record_write(
        session,
        user,
        kind="tip",
        venue_key=venue_key,
        venue_name=venue_name,
        rating_id=None,
        tip_id=row.id,
        action="create",
        previous=None,
        new=_tip_values(row),
    )
    session.commit()
    session.refresh(row)
    return _recommendation_out(row)


def _apply_vote(row: VenueRecommendation, previous: str | None, choice: str) -> None:
    if previous == choice:
        return
    if previous == "up":
        row.upvotes = max(0, int(row.upvotes or 0) - 1)
    elif previous == "down":
        row.downvotes = max(0, int(row.downvotes or 0) - 1)
    if choice == "up":
        row.upvotes = int(row.upvotes or 0) + 1
    else:
        row.downvotes = int(row.downvotes or 0) + 1


@router.post("/locations/recommendations/{recommendation_id}/vote", response_model=RecommendationOut)
def vote_recommendation(
    recommendation_id: int,
    payload: VoteIn,
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
) -> RecommendationOut:
    """One vote per account. The same choice again changes nothing; the other choice moves the counts."""

    user = require_user(session, token)
    _require_terms(user)
    _user_id, author_key, _author_name = author_for(user)
    row = session.scalar(
        select(VenueRecommendation).where(VenueRecommendation.id == recommendation_id).with_for_update()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Tip not found")
    existing = session.scalar(
        select(VenueTipVote).where(
            VenueTipVote.recommendation_id == row.id,
            VenueTipVote.author_key == author_key,
        )
    )
    previous: dict[str, object] | None = None
    action = "create"
    now = datetime.now(UTC)
    if existing is None:
        existing = VenueTipVote(
            recommendation_id=row.id,
            author_key=author_key,
            choice=payload.choice,
            updated_at=now,
        )
        session.add(existing)
        _apply_vote(row, None, payload.choice)
    else:
        previous = {"choice": existing.choice, "vote_id": existing.id}
        action = "update"
        if existing.hidden_at is None:
            _apply_vote(row, existing.choice, payload.choice)
        existing.choice = payload.choice
        existing.updated_at = now
    session.flush()
    _record_write(
        session,
        user,
        kind="vote",
        venue_key=row.venue_key,
        venue_name=row.venue_name,
        rating_id=None,
        tip_id=row.id,
        action=action,
        previous=previous,
        new={"choice": payload.choice, "vote_id": existing.id},
    )
    session.commit()
    session.refresh(row)
    return _recommendation_out(row, payload.choice)


def _owns_tip(user: AppUser, row: VenueRecommendation) -> bool:
    user_id, author_key, _author_name = author_for(user)
    return row.user_id == user_id or row.author_key == author_key


@router.post("/locations/recommendations/{recommendation_id}/flag", response_model=FlagOut)
def flag_recommendation(
    recommendation_id: int,
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(require_bearer)],
) -> FlagOut:
    """One report per account. The second distinct report hides the tip until an admin accepts it."""

    user = require_user(session, token)
    row = session.scalar(
        select(VenueRecommendation).where(VenueRecommendation.id == recommendation_id).with_for_update()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Tip not found")
    if row.hidden_at is not None:
        raise HTTPException(status_code=409, detail="This tip is no longer visible")
    if _owns_tip(user, row):
        raise HTTPException(status_code=403, detail="You cannot report your own tip")
    existing = session.scalar(
        select(ContentFlag).where(
            ContentFlag.user_id == int(user.id),
            ContentFlag.kind == "tip",
            ContentFlag.target_id == row.id,
        )
    )
    if existing is not None:
        return FlagOut(already_reported=True, hidden=False, message="You already reported this tip.")
    now = datetime.now(UTC)
    session.add(
        ContentFlag(
            user_id=int(user.id),
            kind="tip",
            target_id=row.id,
            created_at=now,
        )
    )
    if row.flagged_at is None:
        row.flagged_at = now
    session.flush()
    count = int(
        session.scalar(
            select(func.count())
            .select_from(ContentFlag)
            .where(ContentFlag.kind == "tip", ContentFlag.target_id == row.id)
        )
        or 0
    )
    hidden = False
    if count >= 2 and row.accepted_at is None and row.hidden_at is None:
        row.hidden_at = now
        row.auto_hidden_at = now
        hidden = True
        _record_write(
            session,
            user,
            kind="tip",
            venue_key=row.venue_key,
            venue_name=row.venue_name,
            rating_id=None,
            tip_id=row.id,
            action="auto_hide",
            previous={"review_text": row.review_text, "hidden": False},
            new={"review_text": row.review_text, "hidden": True},
        )
    session.commit()
    return FlagOut(already_reported=False, hidden=hidden, message="Reported.")
