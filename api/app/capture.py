"""Store AthleteOne fields the public feed actually returns.

Schedule rows do not include a match token, stream, surface, address, coordinates,
lineup, weather, or a separate capped goal difference. Roster, showcase catalog,
scout, and college-coach routes were not public. Those values stay null and no
row is inserted for them.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.ingestion.normalizer import counts_as_conference
from app.models import (
    Club,
    CoachingStaff,
    CollegeCoach,
    ConferenceStanding,
    GameWeather,
    MatchEvent,
    MatchPlayer,
    Player,
    PlayoffPicture,
    ScheduleGame,
    ScheduleTeam,
    ScoutAttendance,
    Showcase,
    TeamEvent,
    TeamRating,
    WildcardCutoff,
)
from app.database import engine
from app.refresh import RefreshCounts, ensure_refresh_tables
from load_league import API, LEAGUES, SEASON, SKIP_EVENT_IDS, age_group, get_json

UNAVAILABLE = (
    "Schedule matches have no stream link, field surface, venue address, latitude, longitude, or postponement reason.",
    "Standings expose raw goaldifferential and conference rank, not capped goal difference, RPI, strength of schedule, national rank, playoff seed, or a wildcard cutoff.",
    "Team lists expose a head coach name only. There is no coach id, phone, or email.",
    "Club lists expose name and logo. There is no parent club id.",
    "Schedule rows have no match token, so Event/get-match-detail-by-token is not called.",
    "No public roster, showcase catalog, scout directory, college coach directory, or weather route returned these fields.",
)

_CAPPED_KEYS = ("cappedGoalDifferential", "cappedGoalDiff", "cappedgoaldiff", "maxGoalDiff")
_RPI_KEYS = ("rpi", "RPI")
_SOS_KEYS = ("strengthOfSchedule", "strength_of_schedule", "sos")
_NATIONAL_KEYS = ("nationalRank", "national_rank")
_SEED_KEYS = ("playoffSeed", "playoff_seed")
_STATUS_KEYS = ("playoffStatus", "playoff_status", "nationalPlayoffStatus")
_WILDCARD_KEYS = ("wildcardCutoff", "wildcardPPG", "pointsPerGameCutoff")
_ROSTER_PATHS = (
    "/team/get-roster-by-teamid/{team_id}",
    "/Event/get-roster-by-teamid/{team_id}",
    "/Player/get-player-list-by-teamid/{team_id}",
)
_SHOWCASE_PATHS = ("/Event/get-showcase-list", "/Event/get-national-showcases", "/Event/get-org-showcase-list")
_SCOUT_PATHS = ("/Event/get-scout-list", "/scout/get-scout-directory")
_COLLEGE_PATHS = ("/Event/get-college-coach-list", "/college/get-college-coaches")
_PLAYER_FIELDS = (
    "first_name",
    "last_name",
    "photo_url",
    "gender",
    "position",
    "graduation_year",
    "jersey_number",
    "height",
    "weight",
    "club_id",
    "team_id",
    "gpa",
    "college_commitment",
    "high_school",
)


def _text(value: object, limit: int = 160) -> str | None:
    if value is None:
        return None
    text = " ".join(str(value).split())
    if not text:
        return None
    return text[:limit]


def _int(value: object) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _float(value: object) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _pick(row: dict, keys: tuple[str, ...]) -> object | None:
    for key in keys:
        if key in row and row[key] not in (None, ""):
            return row[key]
    return None


def _gender(value: object) -> str | None:
    text = str(value or "").strip().casefold()
    if text in {"boys", "girls", "male", "female", "m", "f", "b", "g"}:
        return "boys" if text in {"boys", "male", "m", "b"} else "girls"
    return None


def public_player(payload: dict) -> dict | None:
    """Map a player payload. Email, address, date of birth, and parent contact are dropped."""

    source = _int(payload.get("playerID") if "playerID" in payload else payload.get("playerId") or payload.get("athleteId"))
    first = _text(payload.get("firstName") or payload.get("first_name"), 80)
    last = _text(payload.get("lastName") or payload.get("last_name"), 80)
    if source is None or not first or not last:
        return None
    school = payload.get("highSchool") if "highSchool" in payload else payload.get("high_school") or payload.get("schoolName")
    commitment = (
        payload.get("collegeCommitment")
        if "collegeCommitment" in payload
        else payload.get("college_commitment") or payload.get("commitment")
    )
    gpa = payload.get("gpa") if "gpa" in payload else payload.get("GPA")
    return {
        "source_id": source,
        "first_name": first,
        "last_name": last,
        "photo_url": _text(payload.get("photoUrl") or payload.get("photo_url") or payload.get("playerPhoto"), 400),
        "gender": _gender(payload.get("gender")),
        "position": _text(payload.get("position"), 40),
        "graduation_year": _int(payload.get("graduationYear") or payload.get("gradYear")),
        "jersey_number": _text(payload.get("jerseyNumber") or payload.get("jersey"), 8),
        "height": _text(payload.get("height"), 16),
        "weight": _text(payload.get("weight"), 16),
        "club_id": _int(payload.get("clubID") or payload.get("club_id")),
        "team_id": None,
        "gpa": _text(gpa, 16) if gpa not in (None, "") else None,
        "college_commitment": _text(commitment, 160) if commitment not in (None, "") else None,
        "high_school": _text(school, 160) if school not in (None, "") else None,
    }


def public_coach(payload: dict) -> dict | None:
    """Map a coach. Phone and personal email are not copied, even when the payload has them."""

    name = _text(payload.get("headCoach") or payload.get("name"), 160)
    source_team_id = _int(payload.get("teamID") or payload.get("source_team_id"))
    if not name or source_team_id is None:
        return None
    return {
        "name": name,
        "role": _text(payload.get("role"), 80) or "Head Coach",
        "source_team_id": source_team_id,
        "club_id": _int(payload.get("clubID") or payload.get("club_id")),
    }


def public_club(payload: dict) -> dict | None:
    club_id = _int(payload.get("clubID") or payload.get("id"))
    name = _text(payload.get("clubName") or payload.get("clubFullName") or payload.get("name"), 160)
    if club_id is None or not name:
        return None
    parent = _pick(payload, ("parentClubID", "parentClubId", "parent_club_id"))
    return {
        "id": club_id,
        "name": name,
        "parent_club_id": _int(parent),
        "logo_url": _text(payload.get("clubLogo") or payload.get("logoUrl") or payload.get("logo_url"), 400),
    }


def upsert_player(session: Session, record: dict) -> Player:
    row = session.scalar(select(Player).where(Player.source_id == record["source_id"]))
    if row is None:
        row = Player(source_id=record["source_id"], first_name=record["first_name"], last_name=record["last_name"])
        session.add(row)
    for key in _PLAYER_FIELDS:
        if key in record:
            setattr(row, key, record[key])
    return row


def _fetch_once(url: str) -> object | None:
    request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "ecnl-schedule-pilot"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.load(response)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None
    if isinstance(payload, dict) and "data" in payload:
        return payload["data"]
    return payload


def _probe_list(paths: tuple[str, ...]) -> list[dict] | None:
    for path in paths:
        data = _fetch_once(f"{API}{path}")
        if isinstance(data, list) and (not data or isinstance(data[0], dict)):
            return data
    return None


def _kind(event_name: str) -> str:
    if counts_as_conference(event_name):
        return "league"
    lowered = event_name.casefold()
    for kind in ("playoff", "scout", "friendly", "showcase"):
        if kind in lowered:
            return kind
    return "showcase"


def discover_flights() -> list[dict]:
    found: list[dict] = []
    for league in LEAGUES:
        clubs = get_json(f"{API}/Event/get-org-club-list-by-orgID/{league['org_id']}")
        event_ids = sorted({club["eventID"] for club in clubs if club.get("eventID") and club["eventID"] not in SKIP_EVENT_IDS})
        for event_id in event_ids:
            details = get_json(f"{API}/team/get-event-details-by-eventid/{event_id}")
            name = details.get("name") or ""
            if SEASON not in name or not name.startswith(league["prefix"]):
                continue
            divisions = get_json(f"{API}/Event/get-event-schedule-or-standings/{event_id}")
            for division in divisions.get(league["divisions"]) or []:
                try:
                    group = age_group(division["divisionName"])
                except RuntimeError:
                    continue
                for flight in division.get("flightList") or []:
                    found.append(
                        {
                            "event_id": event_id,
                            "event_name": name,
                            "division_id": division.get("divisionID"),
                            "flight_id": flight["flightID"],
                            "flight_name": flight.get("flightName") or "",
                            "age_group": group,
                            "gender": league["gender"],
                            "tier": league["tier"],
                        }
                    )
    return found


def _team_indexes(session: Session) -> tuple[dict[int, ScheduleTeam], dict[tuple[int, str, str], list[ScheduleTeam]]]:
    by_source: dict[int, ScheduleTeam] = {}
    by_squad: dict[tuple[int, str, str], list[ScheduleTeam]] = {}
    for team in session.scalars(select(ScheduleTeam)).all():
        if team.source_id is not None:
            by_source[team.source_id] = team
        if team.club_id is None:
            continue
        by_squad.setdefault((int(team.club_id), team.age_group, team.gender or "boys"), []).append(team)
    return by_source, by_squad


def _linked_team(
    by_source: dict[int, ScheduleTeam],
    by_squad: dict[tuple[int, str, str], list[ScheduleTeam]],
    source_team_id: int | None,
    club_id: int | None,
    age_group: str,
    gender: str,
) -> ScheduleTeam | None:
    if source_team_id is not None and source_team_id in by_source:
        return by_source[source_team_id]
    if club_id is None:
        return None
    matches = by_squad.get((club_id, age_group, gender), [])
    if len(matches) == 1:
        return matches[0]
    return None


def _upsert_coach(session: Session, record: dict, team_id: int | None) -> None:
    row = session.scalar(
        select(CoachingStaff).where(
            CoachingStaff.source_team_id == record["source_team_id"],
            CoachingStaff.name == record["name"],
            CoachingStaff.role == record["role"],
        )
    )
    if row is None:
        row = CoachingStaff(source_team_id=record["source_team_id"], name=record["name"], role=record["role"])
        session.add(row)
    row.club_id = record["club_id"]
    row.team_id = team_id


def pull_people() -> RefreshCounts:
    """Weekly player profiles and coaching staff. Does not write games or standings."""

    ensure_refresh_tables()
    flights = discover_flights()
    roster_path: str | None = None
    sample = next((flight for flight in flights), None)
    if sample is not None:
        listed = get_json(f"{API}/Event/get-team-list-by-flight/{sample['flight_id']}")
        sample_team = None
        if isinstance(listed, list):
            sample_team = next((row.get("teamID") for row in listed if isinstance(row, dict) and row.get("teamID")), None)
        if sample_team is not None:
            for path in _ROSTER_PATHS:
                data = _fetch_once(f"{API}{path.format(team_id=sample_team)}")
                if isinstance(data, list):
                    roster_path = path
                    break
    coaches = players = 0
    with Session(engine) as session:
        by_source, by_squad = _team_indexes(session)
        for flight in flights:
            listed = get_json(f"{API}/Event/get-team-list-by-flight/{flight['flight_id']}")
            if not isinstance(listed, list):
                continue
            for team_row in listed:
                if not isinstance(team_row, dict):
                    continue
                coach = public_coach(team_row)
                linked = _linked_team(
                    by_source,
                    by_squad,
                    _int(team_row.get("teamID")),
                    _int(team_row.get("clubID")),
                    flight["age_group"],
                    flight["gender"],
                )
                if coach is not None:
                    _upsert_coach(session, coach, linked.id if linked is not None else None)
                    coaches += 1
                if roster_path is None or team_row.get("teamID") is None:
                    continue
                roster = _fetch_once(f"{API}{roster_path.format(team_id=team_row['teamID'])}")
                if not isinstance(roster, list):
                    continue
                for athlete in roster:
                    if not isinstance(athlete, dict):
                        continue
                    record = public_player(athlete)
                    if record is None:
                        continue
                    record["gender"] = record["gender"] or flight["gender"]
                    record["club_id"] = record["club_id"] or _int(team_row.get("clubID"))
                    record["team_id"] = linked.id if linked is not None else None
                    upsert_player(session, record)
                    players += 1
        session.commit()
    if roster_path is None:
        print("Player profiles: no public roster endpoint. No player rows written.", flush=True)
    return RefreshCounts(teams=coaches, games=players, scores=0)


def _upsert_club(session: Session, record: dict) -> None:
    row = session.get(Club, record["id"])
    if row is None:
        row = Club(id=record["id"], name=record["name"])
        session.add(row)
    row.name = record["name"]
    row.parent_club_id = record["parent_club_id"]
    row.logo_url = record["logo_url"]


def _upsert_team_event(session: Session, flight: dict, team_row: dict, team_id: int | None) -> None:
    source_team_id = _int(team_row.get("teamID"))
    if source_team_id is None:
        return
    row = session.scalar(
        select(TeamEvent).where(
            TeamEvent.event_id == flight["event_id"],
            TeamEvent.flight_id == flight["flight_id"],
            TeamEvent.source_team_id == source_team_id,
        )
    )
    if row is None:
        row = TeamEvent(
            source_team_id=source_team_id,
            event_id=flight["event_id"],
            flight_id=flight["flight_id"],
            age_group=flight["age_group"],
            gender=flight["gender"],
            tier=flight["tier"],
        )
        session.add(row)
    row.team_id = team_id
    row.club_id = _int(team_row.get("clubID"))
    row.event_name = _text(flight.get("event_name"), 200)
    row.flight_name = _text(flight.get("flight_name"), 160)
    row.kind = _kind(str(flight.get("event_name") or ""))


def pull_reference() -> RefreshCounts:
    """Monthly clubs, squad hierarchy, and directories. Does not write scores."""

    ensure_refresh_tables()
    clubs_written = events_written = 0
    flights = discover_flights()
    with Session(engine) as session:
        for league in LEAGUES:
            listed = get_json(f"{API}/Event/get-org-club-list-by-orgID/{league['org_id']}")
            if not isinstance(listed, list):
                continue
            for club in listed:
                if not isinstance(club, dict):
                    continue
                record = public_club(club)
                if record is None:
                    continue
                _upsert_club(session, record)
                clubs_written += 1
        by_source, by_squad = _team_indexes(session)
        for flight in flights:
            listed = get_json(f"{API}/Event/get-team-list-by-flight/{flight['flight_id']}")
            if not isinstance(listed, list):
                continue
            for team_row in listed:
                if not isinstance(team_row, dict):
                    continue
                linked = _linked_team(
                    by_source,
                    by_squad,
                    _int(team_row.get("teamID")),
                    _int(team_row.get("clubID")),
                    flight["age_group"],
                    flight["gender"],
                )
                before = session.scalar(
                    select(TeamEvent.id).where(
                        TeamEvent.event_id == flight["event_id"],
                        TeamEvent.flight_id == flight["flight_id"],
                        TeamEvent.source_team_id == _int(team_row.get("teamID")),
                    )
                )
                _upsert_team_event(session, flight, team_row, linked.id if linked is not None else None)
                if before is None and team_row.get("teamID") is not None:
                    events_written += 1
        _store_directories(session)
        session.commit()
    return RefreshCounts(teams=clubs_written, games=events_written, scores=0)


def _store_directories(session: Session) -> None:
    showcases = _probe_list(_SHOWCASE_PATHS)
    if showcases:
        for row in showcases:
            name = _text(row.get("name") or row.get("eventName"), 200)
            source_id = _int(row.get("eventID") or row.get("showcaseID") or row.get("id"))
            if not name:
                continue
            stored = None
            if source_id is not None:
                stored = session.scalar(select(Showcase).where(Showcase.source_id == source_id))
            if stored is None:
                stored = Showcase(name=name, source_id=source_id)
                session.add(stored)
            stored.name = name
    scouts = _probe_list(_SCOUT_PATHS)
    if scouts:
        for row in scouts:
            source_id = _int(row.get("scoutID") or row.get("id"))
            name = _text(row.get("name"), 160)
            if source_id is None and not name:
                continue
            stored = session.scalar(select(ScoutAttendance).where(ScoutAttendance.source_id == source_id)) if source_id else None
            if stored is None:
                stored = ScoutAttendance(source_id=source_id, name=name)
                session.add(stored)
            stored.name = name
            stored.event_id = _int(row.get("eventID"))
    coaches = _probe_list(_COLLEGE_PATHS)
    if coaches:
        for row in coaches:
            name = _text(row.get("name") or row.get("coachName"), 160)
            school = _text(row.get("school") or row.get("college") or row.get("schoolName"), 160)
            if not name or not school:
                continue
            role = _text(row.get("role") or row.get("title"), 80)
            stored = session.scalar(
                select(CollegeCoach).where(CollegeCoach.name == name, CollegeCoach.school == school, CollegeCoach.role == role)
            )
            if stored is None:
                session.add(CollegeCoach(name=name, school=school, role=role))


def _apply_standings(session: Session, flight: dict) -> None:
    division_id = flight.get("division_id")
    flight_id = flight.get("flight_id")
    event_id = flight.get("event_id")
    if not division_id or not flight_id or not event_id:
        return
    try:
        groups = get_json(f"{API}/Event/get-standings-by-div-and-flight/{division_id}/{flight_id}/{event_id}")
    except Exception as exc:
        print(f"Standings skipped flight {flight_id}: {exc}", flush=True)
        return
    if not isinstance(groups, list):
        return
    by_source, _by_squad = _team_indexes(session)
    for group in groups:
        if not isinstance(group, dict):
            continue
        cutoff = _float(_pick(group, _WILDCARD_KEYS))
        if cutoff is not None:
            existing = session.scalar(
                select(WildcardCutoff).where(
                    WildcardCutoff.gender == flight["gender"],
                    WildcardCutoff.tier == flight["tier"],
                    WildcardCutoff.age_group == flight["age_group"],
                )
            )
            if existing is None:
                session.add(
                    WildcardCutoff(
                        gender=flight["gender"],
                        tier=flight["tier"],
                        age_group=flight["age_group"],
                        points_per_game=cutoff,
                    )
                )
            else:
                existing.points_per_game = cutoff
        for standing in group.get("teamStandings") or []:
            if not isinstance(standing, dict):
                continue
            source_team_id = _int(standing.get("teamID"))
            if source_team_id is None:
                continue
            team = by_source.get(source_team_id)
            capped = _int(_pick(standing, _CAPPED_KEYS))
            if team is not None and team.id is not None and capped is not None:
                row = session.scalar(
                    select(ConferenceStanding).where(
                        ConferenceStanding.team_id == team.id,
                        ConferenceStanding.gender == flight["gender"],
                        ConferenceStanding.tier == flight["tier"],
                        ConferenceStanding.age_group == flight["age_group"],
                    )
                )
                if row is not None:
                    row.capped_goal_diff = capped
            rpi = _float(_pick(standing, _RPI_KEYS))
            sos = _float(_pick(standing, _SOS_KEYS))
            national = _int(_pick(standing, _NATIONAL_KEYS))
            if rpi is not None or sos is not None or national is not None:
                rating = session.scalar(
                    select(TeamRating).where(
                        TeamRating.source_team_id == source_team_id,
                        TeamRating.gender == flight["gender"],
                        TeamRating.tier == flight["tier"],
                        TeamRating.age_group == flight["age_group"],
                    )
                )
                if rating is None:
                    rating = TeamRating(
                        source_team_id=source_team_id,
                        gender=flight["gender"],
                        tier=flight["tier"],
                        age_group=flight["age_group"],
                    )
                    session.add(rating)
                rating.team_id = team.id if team is not None else None
                rating.rpi = rpi
                rating.strength_of_schedule = sos
                rating.national_rank = national
            seed = _int(_pick(standing, _SEED_KEYS))
            status = _text(_pick(standing, _STATUS_KEYS), 80)
            if seed is not None or status is not None:
                picture = session.scalar(
                    select(PlayoffPicture).where(
                        PlayoffPicture.source_team_id == source_team_id,
                        PlayoffPicture.gender == flight["gender"],
                        PlayoffPicture.tier == flight["tier"],
                        PlayoffPicture.age_group == flight["age_group"],
                    )
                )
                if picture is None:
                    picture = PlayoffPicture(
                        source_team_id=source_team_id,
                        gender=flight["gender"],
                        tier=flight["tier"],
                        age_group=flight["age_group"],
                    )
                    session.add(picture)
                picture.team_id = team.id if team is not None else None
                picture.playoff_seed = seed
                picture.status = status


def _apply_brackets(session: Session, flight: dict) -> None:
    event_id = flight.get("event_id")
    flight_id = flight.get("flight_id")
    if not event_id or not flight_id:
        return
    try:
        payload = get_json(f"{API}/Event/get-flight-brackets-by-flight/{event_id}/{flight_id}")
    except Exception as exc:
        print(f"Brackets skipped flight {flight_id}: {exc}", flush=True)
        return
    rows = payload if isinstance(payload, list) else []
    if isinstance(payload, dict):
        rows = [item for value in payload.values() if isinstance(value, list) for item in value if isinstance(item, dict)]
        rows.extend([payload] if payload.get("teamID") else [])
    by_source, _by_squad = _team_indexes(session)
    for item in rows:
        if not isinstance(item, dict):
            continue
        source_team_id = _int(item.get("teamID"))
        seed = _int(_pick(item, _SEED_KEYS))
        if source_team_id is None or seed is None:
            continue
        picture = session.scalar(
            select(PlayoffPicture).where(
                PlayoffPicture.source_team_id == source_team_id,
                PlayoffPicture.gender == flight["gender"],
                PlayoffPicture.tier == flight["tier"],
                PlayoffPicture.age_group == flight["age_group"],
            )
        )
        if picture is None:
            picture = PlayoffPicture(
                source_team_id=source_team_id,
                gender=flight["gender"],
                tier=flight["tier"],
                age_group=flight["age_group"],
                playoff_seed=seed,
            )
            session.add(picture)
        else:
            picture.playoff_seed = seed
        team = by_source.get(source_team_id)
        picture.team_id = team.id if team is not None else None


def _in_window(starts: datetime | None, now: datetime, horizon: datetime) -> bool:
    if starts is None:
        return False
    instant = starts if starts.tzinfo is not None else starts.replace(tzinfo=UTC)
    instant = instant.astimezone(UTC)
    return now <= instant <= horizon


def _apply_embedded(session: Session, games: list[dict], now: datetime, horizon: datetime) -> None:
    if not games:
        return
    stored = {
        game.source_id: game
        for game in session.scalars(select(ScheduleGame).where(ScheduleGame.source_id.is_not(None))).all()
    }
    for row in games:
        source_id = _int(row.get("source_id"))
        game = stored.get(source_id) if source_id is not None else None
        if game is None or game.id is None or not _in_window(game.starts_at, now, horizon):
            continue
        weather = row.get("weather") if isinstance(row.get("weather"), dict) else None
        if weather is not None:
            snapshot = session.scalar(select(GameWeather).where(GameWeather.game_id == game.id))
            if snapshot is None:
                snapshot = GameWeather(game_id=game.id, fetched_at=now)
                session.add(snapshot)
            snapshot.summary = _text(weather.get("summary") or weather.get("description"), 200)
            snapshot.temperature = _float(weather.get("temperature") or weather.get("temp"))
            snapshot.fetched_at = now
        events = row.get("matchEvents") or row.get("events")
        if isinstance(events, list):
            for event in events:
                if not isinstance(event, dict):
                    continue
                event_id = _int(event.get("id") or event.get("eventID") or event.get("matchEventID"))
                if event_id is None:
                    continue
                stored_event = session.scalar(
                    select(MatchEvent).where(MatchEvent.game_id == game.id, MatchEvent.source_id == event_id)
                )
                if stored_event is None:
                    stored_event = MatchEvent(game_id=game.id, source_id=event_id, fetched_at=now)
                    session.add(stored_event)
                stored_event.minute = _int(event.get("minute"))
                stored_event.kind = _text(event.get("type") or event.get("kind"), 40)
                stored_event.detail = _text(event.get("detail") or event.get("description"), 240)
                stored_event.fetched_at = now
        lineup = row.get("lineup") or row.get("players")
        if isinstance(lineup, list):
            _store_lineup(session, game.id, lineup)


def _store_lineup(session: Session, game_id: int, lineup: list) -> None:
    for slot, athlete in enumerate(lineup):
        if not isinstance(athlete, dict):
            continue
        record = public_player(athlete)
        if record is None:
            continue
        player = upsert_player(session, record)
        session.flush()
        source_player_id = record["source_id"]
        row = session.scalar(
            select(MatchPlayer).where(MatchPlayer.game_id == game_id, MatchPlayer.source_player_id == source_player_id)
        )
        if row is None:
            row = MatchPlayer(game_id=game_id, source_player_id=source_player_id)
            session.add(row)
        row.player_id = player.id
        row.lineup_slot = _text(athlete.get("slot") or athlete.get("position") or str(slot), 40)
        row.minutes = _int(_pick(athlete, ("minutes", "mins", "minutesPlayed")))
        row.yellow_cards = _int(_pick(athlete, ("yellowCards", "yellow_cards")))
        row.red_cards = _int(_pick(athlete, ("redCards", "red_cards")))
        row.formation = _text(_pick(athlete, ("formation",)), 32)


def _prune_live(session: Session, now: datetime, horizon: datetime) -> None:
    live_ids = select(ScheduleGame.id).where(ScheduleGame.starts_at >= now, ScheduleGame.starts_at <= horizon)
    session.execute(delete(GameWeather).where(GameWeather.game_id.not_in(live_ids)))
    session.execute(delete(MatchEvent).where(MatchEvent.game_id.not_in(live_ids)))


def capture_live(payload: dict) -> None:
    """Standings extras, lineups, and the next 48 hours of weather or match events.

    This runs after scores are committed. A missing field stores null and does not
    roll the score refresh back. Weather for older games is deleted.
    """

    ensure_refresh_tables()
    now = datetime.now(UTC)
    horizon = now + timedelta(hours=48)
    with Session(engine) as session:
        for flight in payload.get("flights") or []:
            if not isinstance(flight, dict):
                continue
            _apply_standings(session, flight)
            _apply_brackets(session, flight)
        games = payload.get("games") or []
        if isinstance(games, list):
            _apply_embedded(session, [game for game in games if isinstance(game, dict)], now, horizon)
        _prune_live(session, now, horizon)
        session.commit()
