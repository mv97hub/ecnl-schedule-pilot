"""Family home for the website: games through the last published date, and stored field pins only.

This read may store a map point for a saved home address when that point is
still empty. It does not insert a field pin, and it does not change a pin that
is already stored. Schedule coordinates on the game row are ignored.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.clubs import accumulate_records, club_detail
from app.favorites import read_favorites
from app.locations import _listed_surface, _summarize, clean_venue_for_geocoding, make_venue_key
from app.logos import club_logos
from app.models import Club, ScheduleGame, ScheduleTeam, UserHomeAddress, VenueFieldPoint, VenueRating, VenueRecommendation
from app.places import PlacesUnavailable, geocode_street_address

EASTERN = ZoneInfo("America/New_York")
WINDOW_DAYS = 42
SURFACE_LABEL = {"GRASS": "Grass", "TURF": "Turf", "MIXED": "Mixed"}
BRING_TAGS = ("Bring Shade", "Paid Parking")


class WeekendRecordOut(BaseModel):
    wins: int
    draws: int
    losses: int


class WeekendPinOut(BaseModel):
    latitude: float
    longitude: float


class WeekendNoteOut(BaseModel):
    surface: str | None = None
    parking: float | None = None
    line: str | None = None


class WeekendSquadOut(BaseModel):
    id: int
    name: str
    age_group: str
    gender: Literal["boys", "girls"]
    tier: str


class WeekendGameOut(BaseModel):
    id: int
    starts_at: datetime
    timezone: str
    status: Literal["SCHEDULED", "COMPLETED", "POSTPONED", "CANCELLED"]
    side: Literal["home", "away"]
    day: str
    complex_name: str
    field_name: str | None
    city: str
    state: str
    venue_key: str
    squad: WeekendSquadOut
    opponent_id: int
    opponent_name: str
    opponent_logo_url: str | None = None
    opponent_club_name: str | None = None
    pin: WeekendPinOut | None = None
    pin_missing: bool
    note: WeekendNoteOut


class WeekendMapOut(BaseModel):
    has_favorites: bool
    club_name: str | None = None
    club_logo_url: str | None = None
    record: WeekendRecordOut | None = None
    club_games: bool = False
    lead_team_id: int | None = None
    range_start: date
    range_end: date
    window_start: date
    window_end: date
    home: WeekendPinOut | None = None
    teams: list[WeekendSquadOut] = Field(default_factory=list)
    games: list[WeekendGameOut]


def default_window(today: date) -> tuple[date, date]:
    """The next six weeks, including today, in America/New_York. This is the selected window, not the slider limit."""

    return today, today + timedelta(days=WINDOW_DAYS - 1)


def season_end(today: date, last_game: date | None) -> date:
    """The later of the default window and the family's last published game."""

    window_end = today + timedelta(days=WINDOW_DAYS - 1)
    if last_game is None or last_game < window_end:
        return window_end
    return last_game


def _eastern_today() -> date:
    return datetime.now(EASTERN).date()


def _eastern_day(moment: datetime) -> date:
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(EASTERN).date()


def _bounds(start: date, end: date) -> tuple[datetime, datetime]:
    opening = datetime.combine(start, time.min, tzinfo=EASTERN).astimezone(UTC)
    closing = datetime.combine(end, time.max, tzinfo=EASTERN).astimezone(UTC)
    return opening, closing


def _is_tbd(venue_name: str) -> bool:
    return clean_venue_for_geocoding(venue_name).casefold() == "tbd"


def _tags(value: str | None) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in value.split(",") if part.strip()]


def _short(text: str, limit: int = 90) -> str:
    words = " ".join(text.split())
    if len(words) <= limit:
        return words
    return words[: limit - 1].rstrip() + "…"


def _note_line(tip: VenueRecommendation | None) -> str | None:
    if tip is None:
        return None
    tags = _tags(tip.tags)
    bring = next((tag for tag in BRING_TAGS if tag in tags), None)
    tag = bring or (tags[0] if tags else None)
    review = _short(tip.review_text or "")
    if tag and review:
        return f"{tag}. {review}"
    return tag or review or None


def _best_tip(tips: list[VenueRecommendation]) -> VenueRecommendation | None:
    if not tips:
        return None
    return max(tips, key=lambda tip: (tip.upvotes - tip.downvotes, tip.rating, tip.created_at, tip.id))


def _surface_label(code: str | None) -> str | None:
    if not code:
        return None
    return SURFACE_LABEL.get(code, None)


def _squad(team: ScheduleTeam) -> WeekendSquadOut:
    gender: Literal["boys", "girls"] = "girls" if team.gender == "girls" else "boys"
    return WeekendSquadOut(
        id=int(team.id),
        name=team.name,
        age_group=team.age_group,
        gender=gender,
        tier=team.tier,
    )


def _followed_teams(session: Session, scope: list[int]) -> list[WeekendSquadOut]:
    """Saved teams, or the club's squads when no teams are saved, in that order."""

    if not scope:
        return []
    rows = list(session.scalars(select(ScheduleTeam).where(ScheduleTeam.id.in_(scope))).all())
    by_id = {int(row.id): row for row in rows}
    return [_squad(by_id[team_id]) for team_id in scope if team_id in by_id]


def _empty(today: date) -> WeekendMapOut:
    window_start, window_end = default_window(today)
    return WeekendMapOut(
        has_favorites=False,
        range_start=window_start,
        range_end=window_end,
        window_start=window_start,
        window_end=window_end,
        games=[],
    )


def weekend_map(session: Session, user_id: int, today: date | None = None) -> WeekendMapOut:
    """Games for the saved teams, or the saved club when no teams are saved.

    Pins come from venue_field_point rows that already have a point. A miss,
    a failed lookup, a TBD venue, and a postponed or cancelled game do not
    produce a marker. The only write is a home-address map point that was empty.
    """

    day = today or _eastern_today()
    window_start, window_end = default_window(day)
    club_key, team_ids = read_favorites(session, user_id)
    detail = club_detail(session, club_key) if club_key else None
    if team_ids:
        scope = list(team_ids)
        club_games = False
    elif detail is not None:
        scope = [squad.id for squad in detail.squads]
        club_games = True
    else:
        return _empty(day)

    lead_id = scope[0] if scope else None
    header_name = detail.name if detail is not None else None
    header_logo = detail.logo_url if detail is not None else None
    record = None
    if detail is not None:
        record = WeekendRecordOut(wins=detail.record.wins, draws=detail.record.draws, losses=detail.record.losses)
    elif lead_id is not None:
        lead_games = list(
            session.scalars(
                select(ScheduleGame).where(or_(ScheduleGame.home_team_id == lead_id, ScheduleGame.away_team_id == lead_id))
            ).all()
        )
        overall, _conference = accumulate_records(lead_games, {lead_id})
        record = WeekendRecordOut(wins=overall.wins, draws=overall.draws, losses=overall.losses)
        lead = session.get(ScheduleTeam, lead_id)
        if lead is not None:
            header_name = lead.name
            header_logo = club_logos(session, [lead]).get(lead_id)

    range_end = season_end(day, _last_game_day(session, scope) if scope else None)
    opening, closing = _bounds(day, range_end)
    games: list[ScheduleGame] = []
    if scope:
        games = list(
            session.scalars(
                select(ScheduleGame)
                .options(selectinload(ScheduleGame.home_team), selectinload(ScheduleGame.away_team))
                .where(
                    or_(ScheduleGame.home_team_id.in_(scope), ScheduleGame.away_team_id.in_(scope)),
                    ScheduleGame.starts_at >= opening,
                    ScheduleGame.starts_at <= closing,
                )
                .order_by(ScheduleGame.starts_at, ScheduleGame.id)
            ).all()
        )
    games = [game for game in games if day <= _eastern_day(game.starts_at) <= range_end]

    keys = [make_venue_key(game.venue_name, game.city, game.state) for game in games if not _is_tbd(game.venue_name)]
    unique_keys = list(dict.fromkeys(keys))
    points: dict[str, VenueFieldPoint] = {}
    ratings: dict[str, list[VenueRating]] = {}
    tips: dict[str, list[VenueRecommendation]] = {}
    if unique_keys:
        for row in session.scalars(select(VenueFieldPoint).where(VenueFieldPoint.venue_key.in_(unique_keys))).all():
            points[row.venue_key] = row
        for row in session.scalars(
            select(VenueRating).where(VenueRating.venue_key.in_(unique_keys), VenueRating.hidden_at.is_(None))
        ).all():
            ratings.setdefault(row.venue_key, []).append(row)
        for row in session.scalars(
            select(VenueRecommendation).where(
                VenueRecommendation.venue_key.in_(unique_keys),
                VenueRecommendation.category == "SIDELINE_TIP",
                VenueRecommendation.hidden_at.is_(None),
            )
        ).all():
            tips.setdefault(row.venue_key, []).append(row)

    listed: dict[str, list[str | None]] = {}
    for game in games:
        if _is_tbd(game.venue_name):
            continue
        key = make_venue_key(game.venue_name, game.city, game.state)
        listed.setdefault(key, []).append(game.field_surface)

    notes: dict[str, WeekendNoteOut] = {}
    for key in unique_keys:
        summary = _summarize(ratings.get(key, []))
        surface = _surface_label(summary["dominant_surface"] if isinstance(summary["dominant_surface"], str) else None)
        if surface is None:
            surface = _surface_label(_listed_surface(listed.get(key, [])))
        parking = summary["parking_access"] if isinstance(summary["parking_access"], float) else None
        notes[key] = WeekendNoteOut(surface=surface, parking=parking, line=_note_line(_best_tip(tips.get(key, []))))

    opponent_teams = []
    for game in games:
        for team_id in scope:
            if game.home_team_id == team_id:
                opponent_teams.append(game.away_team)
            elif game.away_team_id == team_id:
                opponent_teams.append(game.home_team)
    logos = club_logos(session, [team for team in opponent_teams if team is not None])
    club_ids = {team.club_id for team in opponent_teams if team is not None and team.club_id is not None}
    clubs = {club.id: club for club in session.scalars(select(Club).where(Club.id.in_(club_ids))).all()} if club_ids else {}

    packed: list[WeekendGameOut] = []
    for game in games:
        for team_id in scope:
            home = game.home_team_id == team_id
            away = game.away_team_id == team_id
            if not home and not away:
                continue
            ours = game.home_team if home else game.away_team
            opponent = game.away_team if home else game.home_team
            if ours is None or opponent is None:
                continue
            status = game.status if game.status in {"SCHEDULED", "COMPLETED", "POSTPONED", "CANCELLED"} else "SCHEDULED"
            tbd = _is_tbd(game.venue_name)
            key = make_venue_key(game.venue_name, game.city, game.state)
            stored = None if tbd else points.get(key)
            playable = status in {"SCHEDULED", "COMPLETED"} and not tbd
            pin = None
            if (
                playable
                and stored is not None
                and stored.status == "found"
                and stored.latitude is not None
                and stored.longitude is not None
            ):
                pin = WeekendPinOut(latitude=float(stored.latitude), longitude=float(stored.longitude))
            withheld = status in {"POSTPONED", "CANCELLED"}
            pin_missing = pin is None and not withheld
            rival_club = clubs.get(opponent.club_id) if opponent.club_id is not None else None
            packed.append(
                WeekendGameOut(
                    id=int(game.id),
                    starts_at=game.starts_at,
                    timezone=game.timezone or "America/New_York",
                    status=status,  # type: ignore[arg-type]
                    side="home" if home else "away",
                    day=_eastern_day(game.starts_at).isoformat(),
                    complex_name=clean_venue_for_geocoding(game.venue_name) or game.venue_name,
                    field_name=(game.field_name or "").strip() or None,
                    city=" ".join((game.city or "").split()),
                    state=" ".join((game.state or "").split()).upper(),
                    venue_key=key,
                    squad=_squad(ours),
                    opponent_id=int(opponent.id),
                    opponent_name=opponent.name,
                    opponent_logo_url=logos.get(opponent.id),
                    opponent_club_name=rival_club.name if rival_club is not None else None,
                    pin=pin,
                    pin_missing=pin_missing,
                    note=notes.get(key, WeekendNoteOut()),
                )
            )

    return WeekendMapOut(
        has_favorites=True,
        club_name=header_name,
        club_logo_url=header_logo,
        record=record,
        club_games=club_games,
        lead_team_id=lead_id,
        range_start=day,
        range_end=range_end,
        window_start=window_start,
        window_end=window_end,
        home=_home_point(session, user_id),
        teams=_followed_teams(session, scope),
        games=packed,
    )


def _last_game_day(session: Session, scope: list[int]) -> date | None:
    """The eastern date of the latest published game for these teams."""

    last = session.scalar(
        select(func.max(ScheduleGame.starts_at)).where(
            or_(ScheduleGame.home_team_id.in_(scope), ScheduleGame.away_team_id.in_(scope))
        )
    )
    if last is None:
        return None
    return _eastern_day(last)


def _home_point(session: Session, user_id: int) -> WeekendPinOut | None:
    """A star for a saved home address. Geocode once when the point is still empty.

    A missing address returns nothing. A failed lookup leaves the coordinates
    empty and does not plot a star. This never writes a field pin.
    """

    row = session.get(UserHomeAddress, user_id)
    if row is None:
        return None
    if row.latitude is not None and row.longitude is not None:
        return WeekendPinOut(latitude=float(row.latitude), longitude=float(row.longitude))
    try:
        point = geocode_street_address(row.street, row.unit, row.city, row.state, row.postal_code)
    except PlacesUnavailable:
        return None
    if point is None:
        return None
    session.refresh(row)
    if row.latitude is not None and row.longitude is not None:
        return WeekendPinOut(latitude=float(row.latitude), longitude=float(row.longitude))
    row.latitude, row.longitude = point
    session.commit()
    return WeekendPinOut(latitude=point[0], longitude=point[1])
