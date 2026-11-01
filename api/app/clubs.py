"""Read-only club search and the club page payload.

Records, squads, home venues, and weekend scorecards come from rows already
stored on club, team, game, and conference_standing. This module does not
refresh the league.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.models import Club, ScheduleGame, ScheduleTeam
from app.schemas import (
    ClubDetailOut,
    ClubListItemOut,
    ClubRecordOut,
    ClubSquadOut,
    ClubVenueOut,
    NextWeekendOpponentOut,
    NextWeekendOut,
    NextWeekendSquadOut,
    WeekendScorecardOut,
    WeekendSquadOut,
)
from app.standings import conference_rank, short_conference

EASTERN = ZoneInfo("America/New_York")
CLUB_LIST_LIMIT = 30
RESULT_WINDOW_DAYS = 10
# Old city-token URLs. The canonical pages are 1353-sporting-sa-jax and 1353-sporting-sa-tlh.
_SLUG_ALIASES = {
    "1353-jax": (1353, "sporting-sa-jax"),
    "1353-tlh": (1353, "sporting-sa-tlh"),
}
AGE_ORDER = {"U13": 0, "U14": 1, "U15": 2, "U16": 3, "U17": 4, "U18/19": 5}
TIER_ORDER = {"ECNL": 0, "ECNL-RL": 1}


def game_local_date(starts_at: datetime, timezone_name: str | None) -> date:
    """Calendar date of kickoff in the game timezone. Blank or unknown zones use Eastern."""

    name = (timezone_name or "").strip() or "America/New_York"
    try:
        zone = ZoneInfo(name)
    except Exception:
        zone = EASTERN
    moment = starts_at if starts_at.tzinfo is not None else starts_at.replace(tzinfo=UTC)
    return moment.astimezone(zone).date()


def weekend_friday(day: date) -> date | None:
    """Friday of the Friday–Sunday window that contains `day`, or None on Monday–Thursday."""

    weekday = day.weekday()
    if weekday < 4:
        return None
    return day - timedelta(days=weekday - 4)


def weekend_label(friday: date) -> str:
    sunday = friday + timedelta(days=2)
    start = f"{friday.strftime('%b')} {friday.day}"
    if friday.month == sunday.month and friday.year == sunday.year:
        return f"{start}\u2013{sunday.day}"
    return f"{start}\u2013{sunday.strftime('%b')} {sunday.day}"


@dataclass
class Record:
    wins: int = 0
    losses: int = 0
    draws: int = 0
    goal_diff: int = 0

    def add(self, goals_for: int, goals_against: int) -> None:
        self.goal_diff += goals_for - goals_against
        if goals_for > goals_against:
            self.wins += 1
        elif goals_for < goals_against:
            self.losses += 1
        else:
            self.draws += 1

    def as_out(self) -> ClubRecordOut:
        return ClubRecordOut(wins=self.wins, losses=self.losses, draws=self.draws, goal_diff=self.goal_diff)


def _completed_score(status: str, goals_for: int | None, goals_against: int | None) -> tuple[int, int] | None:
    if status != "COMPLETED" or goals_for is None or goals_against is None:
        return None
    return goals_for, goals_against


def _result_mark(goals_for: int, goals_against: int) -> str:
    if goals_for > goals_against:
        return "W"
    if goals_for < goals_against:
        return "L"
    return "D"


def accumulate_records(games: list[ScheduleGame], team_ids: set[int]) -> tuple[Record, Record]:
    """Overall and conference records for every completed game the club played.

    Each game is applied once. When both sides belong to the club, the result
    is the home squad's, so the match is not also stored as the away squad's
    opposite result.
    """

    overall = Record()
    conference = Record()
    seen: set[int] = set()
    for game in games:
        game_id = int(game.id or 0)
        if game_id and game_id in seen:
            continue
        if game_id:
            seen.add(game_id)
        home_ours = game.home_team_id in team_ids
        away_ours = game.away_team_id in team_ids
        if not home_ours and not away_ours:
            continue
        if home_ours:
            scored = _completed_score(game.status, game.home_score, game.away_score)
        else:
            scored = _completed_score(game.status, game.away_score, game.home_score)
        if scored is None:
            continue
        goals_for, goals_against = scored
        overall.add(goals_for, goals_against)
        if game.is_conference_game:
            conference.add(goals_for, goals_against)
    return overall, conference


@dataclass
class _Appearance:
    game_id: int
    team_id: int
    age_group: str
    gender: str
    tier: str
    opponent_squad_name: str
    starts_at: datetime
    status: str
    result: str | None
    goals_for: int | None
    goals_against: int | None
    field_name: str | None
    venue_name: str
    opponent_club_id: int
    opponent_name_key: str
    local_date: date


def name_key(name: str) -> str:
    """Grouping key: the stored team name, whitespace collapsed, folded to lower case."""

    return " ".join((name or "").split()).casefold()


def name_slug(name: str) -> str:
    """URL suffix: the grouping key with spaces turned into hyphens."""

    return name_key(name).replace(" ", "-")


def canonical_name(names: list[str]) -> str:
    """One spelling for a folded name. BLACK and Black share a page; the spelling with fewer capitals wins a tie."""

    cleaned = [" ".join(name.split()) for name in names if " ".join((name or "").split())]
    if not cleaned:
        return ""
    counts: dict[str, int] = {}
    for name in cleaned:
        counts[name] = counts.get(name, 0) + 1

    def sort_key(name: str) -> tuple:
        uppers = sum(1 for char in name if char.isupper())
        return (-counts[name], uppers, name.casefold(), name)

    return min(counts, key=sort_key)


def parse_club_key(raw: str) -> tuple[int, str | None] | None:
    """Return the club id and, when present, the name slug. Bare ids request the unsplit page."""

    text = (raw or "").strip()
    alias = _SLUG_ALIASES.get(text.casefold())
    if alias is not None:
        return alias
    if text.isdigit():
        return int(text), None
    head, sep, tail = text.partition("-")
    if sep and head.isdigit() and tail:
        return int(head), tail.casefold()
    return None


def _public_id(club_id: int, slug: str | None, *, split: bool) -> int | str:
    if split and slug:
        return f"{club_id}-{slug}"
    return club_id


def _gender(value: str | None) -> str | None:
    if value in {"boys", "girls"}:
        return value
    if (value or "boys") == "boys":
        return "boys"
    return None


def _field_name(value: str | None) -> str | None:
    text = " ".join((value or "").split())
    return text or None


def _status(value: str) -> str:
    if value in {"SCHEDULED", "COMPLETED", "POSTPONED", "CANCELLED"}:
        return value
    return "SCHEDULED"


def _appearance_sort(row: _Appearance) -> tuple:
    return (
        AGE_ORDER.get(row.age_group, 99),
        0 if row.gender == "boys" else 1,
        TIER_ORDER.get(row.tier, 9),
        row.starts_at,
        row.game_id,
    )


def _collect_appearances(
    games: list[ScheduleGame],
    team_ids: set[int],
    club_id: int,
    page_name_key: str | None,
) -> list[_Appearance]:
    """One row per game this name plays against a different name."""

    rows: list[_Appearance] = []
    seen: set[int] = set()
    for game in games:
        game_id = int(game.id or 0)
        if game_id and game_id in seen:
            continue
        if game_id:
            seen.add(game_id)
        if _status(game.status) == "CANCELLED":
            continue
        home_ours = game.home_team_id in team_ids
        away_ours = game.away_team_id in team_ids
        if home_ours == away_ours:
            continue
        squad = game.home_team if home_ours else game.away_team
        opponent = game.away_team if home_ours else game.home_team
        if squad is None or opponent is None:
            continue
        opponent_club_id = opponent.club_id
        opponent_key = name_key(opponent.name or "")
        same_club = opponent_club_id is not None and int(opponent_club_id) == club_id
        if opponent_club_id is None or (same_club and (page_name_key is None or opponent_key == page_name_key)):
            continue
        gender = _gender(squad.gender)
        if gender is None or squad.id is None:
            continue
        local_date = game_local_date(game.starts_at, game.timezone)
        if home_ours:
            scored = _completed_score(game.status, game.home_score, game.away_score)
        else:
            scored = _completed_score(game.status, game.away_score, game.home_score)
        if scored is None:
            result, goals_for, goals_against = None, None, None
        else:
            goals_for, goals_against = scored
            result = _result_mark(goals_for, goals_against)
        starts_at = game.starts_at if game.starts_at.tzinfo is not None else game.starts_at.replace(tzinfo=UTC)
        rows.append(
            _Appearance(
                game_id=game_id,
                team_id=int(squad.id),
                age_group=squad.age_group,
                gender=gender,
                tier=squad.tier or "ECNL",
                opponent_squad_name=" ".join((opponent.name or "").split()),
                starts_at=starts_at,
                status=_status(game.status),
                result=result,
                goals_for=goals_for,
                goals_against=goals_against,
                field_name=_field_name(game.field_name),
                venue_name=" ".join((game.venue_name or "").split()),
                opponent_club_id=int(opponent_club_id),
                opponent_name_key=opponent_key,
                local_date=local_date,
            )
        )
    return rows


def _squad_out(row: _Appearance) -> WeekendSquadOut:
    return WeekendSquadOut(
        game_id=row.game_id,
        team_id=row.team_id,
        age_group=row.age_group,
        gender=row.gender,  # type: ignore[arg-type]
        tier=row.tier,
        opponent_squad_name=row.opponent_squad_name,
        status=row.status,  # type: ignore[arg-type]
        result=row.result,  # type: ignore[arg-type]
        goals_for=row.goals_for,
        goals_against=row.goals_against,
        field_name=row.field_name,
        venue_name=row.venue_name,
        played_on=row.local_date,
    )


def _in_past(row: _Appearance, anchor: date) -> bool:
    start = anchor - timedelta(days=RESULT_WINDOW_DAYS)
    return row.result is not None and start <= row.local_date <= anchor


def _in_upcoming(row: _Appearance, anchor: date) -> bool:
    """Unplayed games today, and every game after today through the next 10 days."""

    if row.local_date == anchor:
        return row.result is None
    return anchor < row.local_date <= anchor + timedelta(days=RESULT_WINDOW_DAYS)


def _span_label(days: list[date]) -> str:
    first, last = min(days), max(days)
    if first == last:
        return f"{first.strftime('%b')} {first.day}"
    if first.month == last.month and first.year == last.year:
        return f"{first.strftime('%b')} {first.day}\u2013{last.day}"
    return f"{first.strftime('%b')} {first.day}\u2013{last.strftime('%b')} {last.day}"


def _is_split(split_names: dict[int, set[str]], club_id: int) -> bool:
    return len(split_names.get(club_id, ())) >= 2


def _opponent_public_id(club_id: int, key: str, split_names: dict[int, set[str]]) -> int | str:
    if _is_split(split_names, club_id):
        return f"{club_id}-{key.replace(' ', '-')}"
    return club_id


def group_weekends(
    games: list[ScheduleGame],
    team_ids: set[int],
    clubs_by_id: dict[int, Club],
    club_id: int,
    *,
    today: date | None = None,
    page_name_key: str | None = None,
    split_names: dict[int, set[str]] | None = None,
) -> tuple[list[WeekendScorecardOut], NextWeekendOut | None]:
    """Completed games from the past 10 days, and opponents over the next 10 days.

    The past window is today and the 10 days before it, and only games that
    already have a result. The upcoming window is every game after today through
    the next 10 days, plus a game today that has not been played. Games against
    a squad with no club, and games against the same team name, are skipped.
    Opponent cards are labeled with that opponent's team name.
    """

    anchor = today or datetime.now(EASTERN).date()
    names = split_names or {}
    page_key = page_name_key
    if page_key is None:
        found = {
            name_key(team.name or "")
            for game in games
            for team in (game.home_team, game.away_team)
            if team is not None and team.id in team_ids and name_key(team.name or "")
        }
        if len(found) == 1:
            page_key = next(iter(found))
    appearances = _collect_appearances(games, team_ids, club_id, page_key)
    past = [row for row in appearances if _in_past(row, anchor)]
    upcoming = [row for row in appearances if _in_upcoming(row, anchor)]
    return _scorecards(past, clubs_by_id, names), _upcoming_block(upcoming, clubs_by_id, names)


def _scorecards(
    rows: list[_Appearance],
    clubs_by_id: dict[int, Club],
    split_names: dict[int, set[str]],
) -> list[WeekendScorecardOut]:
    grouped: dict[tuple[int, str], list[_Appearance]] = defaultdict(list)
    for row in rows:
        grouped[(row.opponent_club_id, row.opponent_name_key)].append(row)

    cards: list[WeekendScorecardOut] = []
    for (opponent_club_id, key), group in grouped.items():
        group.sort(key=lambda row: (-row.local_date.toordinal(),) + _appearance_sort(row))
        club = clubs_by_id.get(opponent_club_id)
        days = [row.local_date for row in group]
        cards.append(
            WeekendScorecardOut(
                opponent_club_id=_opponent_public_id(opponent_club_id, key, split_names),
                opponent_name=canonical_name([row.opponent_squad_name for row in group]) or f"Club {opponent_club_id}",
                opponent_logo_url=_logo(club.logo_url) if club is not None else None,
                weekend_start=max(days),
                label=_span_label(days),
                upcoming=False,
                wins=sum(1 for row in group if row.result == "W"),
                losses=sum(1 for row in group if row.result == "L"),
                draws=sum(1 for row in group if row.result == "D"),
                squads=[_squad_out(row) for row in group],
            )
        )
    cards.sort(key=lambda card: (-card.weekend_start.toordinal(), card.opponent_name.casefold(), str(card.opponent_club_id)))
    return cards


def _unique_squads(rows: list[_Appearance]) -> list[_Appearance]:
    chosen: dict[int, _Appearance] = {}
    for row in sorted(rows, key=lambda row: (row.local_date, _appearance_sort(row))):
        chosen.setdefault(row.team_id, row)
    return sorted(chosen.values(), key=_appearance_sort)


def _upcoming_block(
    rows: list[_Appearance],
    clubs_by_id: dict[int, Club],
    split_names: dict[int, set[str]],
) -> NextWeekendOut | None:
    if not rows:
        return None
    grouped: dict[tuple[int, str], list[_Appearance]] = defaultdict(list)
    for row in rows:
        grouped[(row.opponent_club_id, row.opponent_name_key)].append(row)
    opponents: list[NextWeekendOpponentOut] = []
    for (opponent_club_id, key), group in grouped.items():
        club = clubs_by_id.get(opponent_club_id)
        opponents.append(
            NextWeekendOpponentOut(
                opponent_club_id=_opponent_public_id(opponent_club_id, key, split_names),
                opponent_name=canonical_name([row.opponent_squad_name for row in group]) or f"Club {opponent_club_id}",
                opponent_logo_url=_logo(club.logo_url) if club is not None else None,
                squads=[
                    NextWeekendSquadOut(
                        team_id=row.team_id,
                        age_group=row.age_group,
                        gender=row.gender,  # type: ignore[arg-type]
                        tier=row.tier,
                        game_date=row.local_date,
                    )
                    for row in _unique_squads(group)
                ],
            )
        )
    opponents.sort(key=lambda item: (item.opponent_name.casefold(), str(item.opponent_club_id)))
    days = [row.local_date for row in rows]
    return NextWeekendOut(weekend_start=min(days), label=_span_label(days), opponents=opponents)


def home_venues(games: list[ScheduleGame], team_ids: set[int]) -> list[ClubVenueOut]:
    """One row per home venue, city, and state. Several fields at that location stay one row."""

    buckets: dict[tuple[str, str, str], dict[str, object]] = {}
    for game in games:
        if game.home_team_id not in team_ids:
            continue
        venue_name = " ".join((game.venue_name or "").split())
        if not venue_name:
            continue
        city = " ".join((game.city or "").split())
        state = " ".join((game.state or "").split())
        key = (venue_name.casefold(), city.casefold(), state.casefold())
        latitude = game.venue_lat
        longitude = game.venue_lng
        has_point = latitude is not None and longitude is not None
        current = buckets.get(key)
        if current is None:
            buckets[key] = {
                "venue_name": venue_name,
                "city": city,
                "state": state,
                "latitude": latitude if has_point else None,
                "longitude": longitude if has_point else None,
                "starts_at": game.starts_at,
            }
            continue
        stored_at = current["starts_at"]
        newer = isinstance(stored_at, datetime) and game.starts_at >= stored_at
        if has_point and (current["latitude"] is None or newer):
            current["latitude"] = latitude
            current["longitude"] = longitude
        if newer:
            current["starts_at"] = game.starts_at
    ordered = sorted(
        buckets.values(),
        key=lambda row: (str(row["venue_name"]).casefold(), str(row["city"]).casefold(), str(row["state"]).casefold()),
    )
    return [
        ClubVenueOut(
            venue_name=str(row["venue_name"]),
            field_name=None,
            city=str(row["city"]),
            state=str(row["state"]),
            latitude=_coord(row["latitude"]),
            longitude=_coord(row["longitude"]),
        )
        for row in ordered
    ]


def _coord(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _logo(url: str | None) -> str | None:
    text = (url or "").strip()
    return text or None


def summary_line(count: int, tiers: list[str], conferences: list[str]) -> str:
    team_word = "team" if count == 1 else "teams"
    parts = [f"{count} {team_word}"]
    if tiers:
        parts.append(" and ".join(tiers))
    if conferences:
        parts.append(", ".join(conferences))
    return " · ".join(parts)


def _tiers(teams: list[ScheduleTeam]) -> list[str]:
    found = {team.tier for team in teams if team.tier}
    ordered = [tier for tier in ("ECNL", "ECNL-RL") if tier in found]
    ordered.extend(sorted(found - set(ordered)))
    return ordered


def _conferences(teams: list[ScheduleTeam]) -> list[str]:
    names = {short_conference(team.conference) for team in teams}
    names.discard("")
    return sorted(names, key=str.casefold)


def _contains(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _names_by_club(session: Session, club_ids: set[int]) -> dict[int, set[str]]:
    """Folded team names stored on each club id."""

    found: dict[int, set[str]] = defaultdict(set)
    if not club_ids:
        return found
    rows = session.execute(select(ScheduleTeam.club_id, ScheduleTeam.name).where(ScheduleTeam.club_id.in_(club_ids)))
    for club_id, team_name in rows:
        if club_id is None:
            continue
        key = name_key(team_name or "")
        if key:
            found[int(club_id)].add(key)
    return found


def _expand_clubs(session: Session, clubs: list[Club]) -> list[ClubListItemOut]:
    """One list row per team name. A single name keeps the club's own name and numeric id."""

    if not clubs:
        return []
    spellings: dict[int, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    rows = session.execute(select(ScheduleTeam.club_id, ScheduleTeam.name).where(ScheduleTeam.club_id.in_([club.id for club in clubs])))
    for club_id, team_name in rows:
        if club_id is None:
            continue
        key = name_key(team_name or "")
        if key:
            spellings[int(club_id)][key].append(team_name or "")
    items: list[ClubListItemOut] = []
    for club in clubs:
        grouped = spellings.get(club.id, {})
        if len(grouped) < 2:
            count = sum(len(names) for names in grouped.values())
            if count == 0:
                continue
            items.append(ClubListItemOut(id=club.id, name=club.name, logo_url=_logo(club.logo_url), team_count=count))
            continue
        for key, names in grouped.items():
            label = canonical_name(names)
            items.append(
                ClubListItemOut(
                    id=_public_id(club.id, name_slug(label), split=True),
                    name=label,
                    logo_url=_logo(club.logo_url),
                    team_count=len(names),
                )
            )
    return items


def search_clubs(session: Session, q: str | None, *, limit: int | None = None) -> list[ClubListItemOut]:
    """Clubs that have at least one squad.

    A missing limit uses CLUB_LIST_LIMIT at call time, which is the clubs page.
    A negative limit returns every match, which is the locations filter.
    """

    counts = (
        select(ScheduleTeam.club_id.label("club_id"), func.count(ScheduleTeam.id).label("team_count"))
        .where(ScheduleTeam.club_id.is_not(None))
        .group_by(ScheduleTeam.club_id)
        .subquery()
    )
    statement = select(Club).join(counts, counts.c.club_id == Club.id)
    needle = (q or "").strip()
    if needle:
        team_hit = select(ScheduleTeam.club_id).where(ScheduleTeam.name.ilike(_contains(needle), escape="\\"))
        statement = statement.where(or_(Club.name.ilike(_contains(needle), escape="\\"), Club.id.in_(team_hit)))
        statement = statement.order_by(Club.name, Club.id)
    else:
        statement = statement.order_by(counts.c.team_count.desc(), Club.name, Club.id)
    clubs = list(session.scalars(statement).all())
    items = _expand_clubs(session, clubs)
    if needle:
        folded = needle.casefold()
        items = [item for item in items if folded in item.name.casefold()]
        items.sort(key=lambda item: (item.name.casefold(), str(item.id)))
    else:
        items.sort(key=lambda item: (-item.team_count, item.name.casefold(), str(item.id)))
    cap = CLUB_LIST_LIMIT if limit is None else limit
    if cap < 0:
        return items
    return items[:cap]


def _squad_key(team: ScheduleTeam) -> tuple:
    gender = _gender(team.gender) or "boys"
    return (
        0 if gender == "boys" else 1,
        AGE_ORDER.get(team.age_group, 99),
        TIER_ORDER.get(team.tier, 9),
        team.name.casefold(),
        team.id or 0,
    )


def club_detail(session: Session, club_key: str) -> ClubDetailOut | None:
    parsed = parse_club_key(club_key)
    if parsed is None:
        return None
    club_id, requested_slug = parsed
    club = session.get(Club, club_id)
    if club is None:
        return None
    teams = list(session.scalars(select(ScheduleTeam).where(ScheduleTeam.club_id == club_id)).all())
    grouped: dict[str, list[ScheduleTeam]] = defaultdict(list)
    for team in teams:
        key = name_key(team.name)
        if key:
            grouped[key].append(team)
    split = len(grouped) >= 2
    if split and requested_slug is None:
        return None
    if requested_slug is not None and not split:
        return None
    page_key = ""
    if requested_slug is not None:
        matches = [key for key in grouped if name_slug(key) == requested_slug]
        if len(matches) != 1:
            return None
        page_key = matches[0]
        teams = grouped[page_key]
    elif grouped:
        page_key = next(iter(grouped))
    team_ids = {int(team.id) for team in teams if team.id is not None}
    games: list[ScheduleGame] = []
    if team_ids:
        games = list(
            session.scalars(
                select(ScheduleGame)
                .options(selectinload(ScheduleGame.home_team), selectinload(ScheduleGame.away_team))
                .where((ScheduleGame.home_team_id.in_(team_ids)) | (ScheduleGame.away_team_id.in_(team_ids)))
            ).all()
        )
    opponent_club_ids = {
        int(team.club_id)
        for game in games
        for team in (game.home_team, game.away_team)
        if team is not None and team.club_id is not None
    }
    clubs_by_id = {club.id: club}
    if opponent_club_ids:
        for rival in session.scalars(select(Club).where(Club.id.in_(opponent_club_ids))):
            clubs_by_id[rival.id] = rival
    split_names = _names_by_club(session, opponent_club_ids | {club_id})
    overall, conference = accumulate_records(games, team_ids)
    weekends, upcoming = group_weekends(
        games,
        team_ids,
        clubs_by_id,
        club_id,
        page_name_key=page_key or None,
        split_names=split_names,
    )
    tiers = _tiers(teams)
    conferences = _conferences(teams)
    squads: list[ClubSquadOut] = []
    for team in sorted(teams, key=_squad_key):
        gender = _gender(team.gender)
        if gender is None or team.id is None:
            continue
        squads.append(
            ClubSquadOut(
                id=int(team.id),
                name=team.name,
                age_group=team.age_group,
                gender=gender,  # type: ignore[arg-type]
                tier=team.tier,
                conference=short_conference(team.conference),
                conference_rank=conference_rank(session, team),
            )
        )
    return ClubDetailOut(
        id=_public_id(club.id, name_slug(page_key) if split else None, split=split),
        name=canonical_name([team.name for team in teams]) if split else club.name,
        logo_url=_logo(club.logo_url),
        summary=summary_line(len(squads), tiers, conferences),
        team_count=len(squads),
        tiers=tiers,
        conferences=conferences,
        record=overall.as_out(),
        conference_record=conference.as_out(),
        squads=squads,
        venues=home_venues(games, team_ids),
        weekends=weekends,
        upcoming=upcoming,
    )
