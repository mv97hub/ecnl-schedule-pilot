"""Parse PlayMetrics calendars, schedule-page tables, and pasted schedule text."""

from __future__ import annotations

import json
import re
from datetime import date, datetime, time

from bs4 import BeautifulSoup
from icalendar import Calendar

from app.ingestion.normalizer import looks_like_showcase, normalize_field_number, split_location, split_venue
from app.ingestion.upsert import ParsedGame, ParsedScore

_VERSUS = r"(?:versus|vs\.?|v\.?)"
_DATE_PREFIXES = (
    re.compile(r"^(?P<date>\d{4}-\d{2}-\d{2})\b"),
    re.compile(r"^(?:[A-Za-z]{3,9},?\s+)?(?P<date>[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\b"),
    re.compile(r"^(?:[A-Za-z]{3,9},?\s+)?(?P<date>\d{1,2}/\d{1,2}/\d{2,4})\b"),
)
_TIME_PREFIX = re.compile(r"^(?P<time>\d{1,2}:\d{2}\s*(?:[AaPp][Mm])?|\d{1,2}\s*[AaPp][Mm])\b")
_PROSE_VS = re.compile(
    rf"^(?P<home>.+?)\s+{_VERSUS}\s+(?P<away>.+?)(?:\s+(?:@|at)\s+(?P<place>.+))?$",
    re.IGNORECASE,
)
_PROSE_AT = re.compile(
    r"^(?P<away>.+?)\s+(?:@|at)\s+(?P<home>.+?)(?:\s+(?:@|at)\s+(?P<place>.+))?$",
    re.IGNORECASE,
)
_SUMMARY_VS = re.compile(rf"^(?P<home>.+?)\s+{_VERSUS}\s+(?P<away>.+?)$", re.IGNORECASE)
_SUMMARY_AT = re.compile(r"^(?P<away>.+?)\s+(?:@|at)\s+(?P<home>.+?)$", re.IGNORECASE)
_LEADING_AGE = re.compile(r"^(?:U\d{2}(?:/\d{2})?|B\d{4}(?:/\d{2})?)\s*[:\-]\s*", re.IGNORECASE)
_DATE_FORMATS = (
    "%Y-%m-%d",
    "%m/%d/%Y",
    "%m/%d/%y",
    "%b %d, %Y",
    "%b %d %Y",
    "%B %d, %Y",
    "%B %d %Y",
)
_HEADER_ALIASES = {
    "date": "date",
    "game date": "date",
    "day": "date",
    "time": "time",
    "kickoff": "time",
    "kickoff time": "time",
    "start": "time",
    "home": "home",
    "home team": "home",
    "away": "away",
    "away team": "away",
    "visitor": "away",
    "opponent": "opponent",
    "match": "match",
    "game": "match",
    "fixture": "match",
    "venue": "venue",
    "complex": "venue",
    "facility": "venue",
    "location": "location",
    "site": "location",
    "field": "field",
    "field number": "field",
    "pitch": "field",
    "city": "city",
    "city/state": "city_state",
    "city state": "city_state",
}
_CITY_STATE = re.compile(r"^[^,]+,\s*[A-Za-z]{2}$")
_SHOWCASE_FLAG = re.compile(r"^(?:y|yes|true|1|showcase)$", re.IGNORECASE)


def parse_ics(calendar_text: str, *, age_group: str, tier: str | None) -> list[ParsedGame]:
    try:
        calendar = Calendar.from_ical(calendar_text)
    except Exception as exc:
        raise ValueError("Could not parse the iCalendar file") from exc
    if calendar is None:
        raise ValueError("Could not parse the iCalendar file")

    games: list[ParsedGame] = []
    for component in calendar.walk("VEVENT"):
        summary = " ".join(str(component.get("SUMMARY") or "").split())
        if not summary:
            continue
        matchup = split_matchup(summary)
        if matchup is None:
            continue
        start = component.get("DTSTART")
        if start is None:
            continue
        game_date, kickoff = _event_when(start.dt)
        if game_date is None:
            continue
        location = str(component.get("LOCATION") or "")
        description = str(component.get("DESCRIPTION") or "")
        complex_name, field_number, city_state = split_location(location)
        home, away = matchup
        games.append(
            ParsedGame(
                game_date=game_date,
                kickoff_time=kickoff,
                home_name=home,
                away_name=away,
                complex_name=complex_name,
                field_number=field_number,
                city_state=city_state,
                is_showcase=looks_like_showcase(summary, location, description),
                age_group=age_group,
                tier=tier,
            )
        )
    return games


def parse_schedule_text(
    text: str,
    *,
    age_group: str,
    tier: str | None,
    default_city_state: str = "",
) -> list[ParsedGame]:
    games: list[ParsedGame] = []
    for raw_line in text.splitlines():
        line = " ".join(raw_line.replace("\xa0", " ").split())
        if not line or line.startswith("#"):
            continue
        game = _parse_pipe(line, age_group, tier, default_city_state) if "|" in raw_line else _parse_prose(
            line, age_group, tier, default_city_state
        )
        if game is not None:
            games.append(game)
    return games


def extract_games_from_html(
    html: str,
    *,
    age_group: str,
    tier: str | None,
    default_city_state: str = "",
) -> list[ParsedGame]:
    soup = BeautifulSoup(html, "html.parser")
    games: list[ParsedGame] = []
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if len(rows) < 2:
            continue
        header = [_cell_text(cell) for cell in rows[0].find_all(["th", "td"])]
        mapping = _header_map(header)
        if mapping is None:
            continue
        for row in rows[1:]:
            cells = [_cell_text(cell) for cell in row.find_all(["td", "th"])]
            game = _game_from_cells(cells, mapping, age_group, tier, default_city_state)
            if game is not None:
                games.append(game)
    if games:
        return games
    return parse_schedule_text(soup.get_text("\n", strip=True), age_group=age_group, tier=tier, default_city_state=default_city_state)


def split_matchup(summary: str) -> tuple[str, str] | None:
    text = _LEADING_AGE.sub("", " ".join(summary.split()))
    versus = _SUMMARY_VS.match(text)
    if versus:
        return versus.group("home").strip(), versus.group("away").strip()
    away_at_home = _SUMMARY_AT.match(text)
    if away_at_home:
        return away_at_home.group("home").strip(), away_at_home.group("away").strip()
    return None


def _event_when(value: object) -> tuple[date | None, time | None]:
    if isinstance(value, datetime):
        return value.date(), value.time().replace(tzinfo=None)
    if isinstance(value, date):
        return value, None
    return None, None


def _parse_date(value: str) -> date | None:
    text = value.strip()
    text = re.sub(r"^[A-Za-z]{3,9},?\s+", "", text)
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _parse_time(value: str) -> time | None:
    text = " ".join(value.split())
    if not text or text.lower() in {"tbd", "tba", "-", "—"}:
        return None
    normalized = re.sub(r"\s+", " ", text).upper()
    for fmt in ("%I:%M %p", "%I:%M%p", "%H:%M", "%I %p"):
        try:
            return datetime.strptime(normalized, fmt).time()
        except ValueError:
            continue
    return None


def _parse_pipe(line: str, age_group: str, tier: str | None, default_city_state: str) -> ParsedGame | None:
    parts = [part.strip() for part in line.split("|")]
    if len(parts) < 5:
        return None
    if parts[0].lower() in {"date", "game date", "day"}:
        return None
    game_date = _parse_date(parts[0])
    if game_date is None:
        return None
    home, away = parts[2], parts[3]
    if not home or not away:
        return None
    complex_name, field_number, peeled_city = split_location(parts[4])
    city_state = parts[5].strip() if len(parts) > 5 and parts[5].strip() else peeled_city or default_city_state
    showcase_cell = parts[6] if len(parts) > 6 else ""
    return ParsedGame(
        game_date=game_date,
        kickoff_time=_parse_time(parts[1]),
        home_name=home,
        away_name=away,
        complex_name=complex_name,
        field_number=field_number,
        city_state=city_state,
        is_showcase=bool(_SHOWCASE_FLAG.match(showcase_cell.strip())) or looks_like_showcase(line),
        age_group=age_group,
        tier=tier,
    )


def _parse_prose(line: str, age_group: str, tier: str | None, default_city_state: str) -> ParsedGame | None:
    remainder = line
    game_date: date | None = None
    for pattern in _DATE_PREFIXES:
        match = pattern.match(remainder)
        if match:
            game_date = _parse_date(match.group("date"))
            remainder = remainder[match.end() :].strip()
            break
    if game_date is None:
        return None
    kickoff: time | None = None
    time_match = _TIME_PREFIX.match(remainder)
    if time_match:
        kickoff = _parse_time(time_match.group("time"))
        remainder = remainder[time_match.end() :].strip()
    versus = _PROSE_VS.match(remainder)
    if versus:
        home, away, place = versus.group("home"), versus.group("away"), versus.group("place") or ""
    else:
        away_at_home = _PROSE_AT.match(remainder)
        if away_at_home is None:
            return None
        home = away_at_home.group("home")
        away = away_at_home.group("away")
        place = away_at_home.group("place") or ""
    complex_name, field_number, city_state = split_location(place)
    return ParsedGame(
        game_date=game_date,
        kickoff_time=kickoff,
        home_name=home.strip(),
        away_name=away.strip(),
        complex_name=complex_name,
        field_number=field_number,
        city_state=city_state or default_city_state,
        is_showcase=looks_like_showcase(line),
        age_group=age_group,
        tier=tier,
    )


def _cell_text(cell: object) -> str:
    return " ".join(cell.get_text(" ", strip=True).split())  # type: ignore[attr-defined]


def _header_map(cells: list[str]) -> dict[str, int] | None:
    mapping: dict[str, int] = {}
    for index, cell in enumerate(cells):
        key = _HEADER_ALIASES.get(cell.strip().lower())
        if key and key not in mapping:
            mapping[key] = index
    has_teams = ("home" in mapping and ("away" in mapping or "opponent" in mapping)) or "match" in mapping
    if "date" in mapping and has_teams:
        return mapping
    return None


def _mapped(cells: list[str], mapping: dict[str, int], key: str) -> str:
    index = mapping.get(key)
    if index is None or index >= len(cells):
        return ""
    return cells[index]


def _game_from_cells(
    cells: list[str],
    mapping: dict[str, int],
    age_group: str,
    tier: str | None,
    default_city_state: str,
) -> ParsedGame | None:
    game_date = _parse_date(_mapped(cells, mapping, "date"))
    if game_date is None:
        return None
    match_cell = _mapped(cells, mapping, "match")
    if match_cell:
        matchup = split_matchup(match_cell)
        if matchup is None:
            return None
        home, away = matchup
    else:
        home = _mapped(cells, mapping, "home")
        away = _mapped(cells, mapping, "away") or _mapped(cells, mapping, "opponent")
        if not home or not away:
            return None
    venue = _mapped(cells, mapping, "venue")
    location = _mapped(cells, mapping, "location")
    field = normalize_field_number(_mapped(cells, mapping, "field"))
    city_state = _mapped(cells, mapping, "city_state") or _mapped(cells, mapping, "city")
    if venue:
        complex_name, parsed_field, peeled = split_location(venue)
        if _CITY_STATE.match(location):
            city_state = city_state or location
        elif location and not peeled:
            complex_name, parsed_field, peeled = split_location(f"{venue}, {location}" if "," not in venue else venue)
            if not city_state:
                city_state = location
        city_state = city_state or peeled
    else:
        complex_name, parsed_field, peeled = split_location(location)
        city_state = city_state or peeled
    if not complex_name and venue:
        complex_name, parsed_field = split_venue(venue)
    return ParsedGame(
        game_date=game_date,
        kickoff_time=_parse_time(_mapped(cells, mapping, "time")),
        home_name=home,
        away_name=away,
        complex_name=complex_name,
        field_number=field or parsed_field,
        city_state=city_state or default_city_state,
        is_showcase=looks_like_showcase(*cells),
        age_group=age_group,
        tier=tier,
    )


_SCORE_TOKEN = re.compile(
    r"^(?:(?P<tag>[WLDT])\s+)?(?P<a>\d{1,2})\s*[-–—]\s*(?P<b>\d{1,2})$",
    re.IGNORECASE,
)
_SCORE_IN_LINE = re.compile(
    r"(?:(?P<tag>[WLDT])\s+)?(?P<a>\d{1,2})\s*[-–—]\s*(?P<b>\d{1,2})",
    re.IGNORECASE,
)
_STANDING_NUMBER = re.compile(r"-?\d+(?:\.\d+)?")
_STAT_HEADERS = {
    "gp": "gp",
    "w": "w",
    "l": "l",
    "d": "d",
    "t": "d",
    "gf": "gf",
    "ga": "ga",
    "gd": "gd",
    "pts": "pts",
    "points": "pts",
    "ppg": "ppg",
}
_DEFAULT_STAT_ORDER = ("gp", "w", "l", "d", "gf", "ga", "gd", "pts", "ppg")


def parse_score_token(token: str) -> tuple[int, int] | None:
    match = _SCORE_TOKEN.match(" ".join(token.split()))
    if match is None:
        return None
    tag = (match.group("tag") or "").upper()
    home_score = int(match.group("a"))
    away_score = int(match.group("b"))
    if tag == "W" and home_score < away_score:
        home_score, away_score = away_score, home_score
    return home_score, away_score


def parse_score_text(text: str, *, age_group: str, tier: str | None = None) -> list[ParsedScore]:
    stripped = text.strip()
    if stripped.startswith("{") or stripped.startswith("["):
        try:
            payload = json.loads(stripped)
        except json.JSONDecodeError as exc:
            raise ValueError("Could not parse the scores JSON") from exc
        records = payload.get("games") if isinstance(payload, dict) else payload
        if not isinstance(records, list):
            raise ValueError("Scores JSON must be a list of games")
        return scores_from_records(records, age_group=age_group, tier=tier)

    games: list[ParsedScore] = []
    for raw_line in text.splitlines():
        line = " ".join(raw_line.replace("\xa0", " ").split())
        if not line or line.startswith("#"):
            continue
        game = _parse_score_line(line, age_group, tier)
        if game is not None:
            games.append(game)
    return games


def scores_from_records(records: list[object], *, age_group: str, tier: str | None) -> list[ParsedScore]:
    games: list[ParsedScore] = []
    for record in records:
        if not isinstance(record, dict):
            continue
        game_date = _parse_date(str(record.get("date") or record.get("game_date") or ""))
        home = str(record.get("home_team") or record.get("home") or "").strip()
        away = str(record.get("away_team") or record.get("away") or "").strip()
        if game_date is None or not home or not away:
            continue
        if record.get("home_score") is not None and record.get("away_score") is not None:
            home_score = int(record["home_score"])
            away_score = int(record["away_score"])
        else:
            parsed = parse_score_token(str(record.get("score") or ""))
            if parsed is None:
                continue
            home_score, away_score = parsed
        status = str(record.get("status") or "COMPLETED").upper()
        games.append(
            ParsedScore(
                game_date=game_date,
                home_name=home,
                away_name=away,
                home_score=home_score,
                away_score=away_score,
                age_group=age_group,
                tier=tier,
                status=status if status in {"COMPLETED", "POSTPONED", "CANCELLED"} else "COMPLETED",
            )
        )
    return games


def _parse_score_line(line: str, age_group: str, tier: str | None) -> ParsedScore | None:
    if "|" in line:
        parts = [part.strip() for part in line.split("|")]
        if parts and parts[0].lower() in {"date", "game date"}:
            return None
        game_date = _parse_date(parts[0]) if parts else None
        if game_date is None or len(parts) < 4:
            return None
        if parse_score_token(parts[2]):
            home, away, token = parts[1], parts[3], parts[2]
        elif parse_score_token(parts[3]):
            home, away, token = parts[1], parts[2], parts[3]
        else:
            return None
        parsed = parse_score_token(token)
        if parsed is None or not home or not away:
            return None
        home_score, away_score = parsed
        return ParsedScore(
            game_date=game_date,
            home_name=home,
            away_name=away,
            home_score=home_score,
            away_score=away_score,
            age_group=age_group,
            tier=tier,
        )

    remainder = line
    game_date: date | None = None
    for pattern in _DATE_PREFIXES:
        match = pattern.match(remainder)
        if match:
            game_date = _parse_date(match.group("date"))
            remainder = remainder[match.end() :].strip()
            break
    if game_date is None:
        return None
    found = _SCORE_IN_LINE.search(remainder)
    if found is None:
        return None
    home = remainder[: found.start()].strip(" -")
    away = remainder[found.end() :].strip(" -")
    parsed = parse_score_token(found.group(0))
    if parsed is None or not home or not away:
        return None
    home_score, away_score = parsed
    return ParsedScore(
        game_date=game_date,
        home_name=home,
        away_name=away,
        home_score=home_score,
        away_score=away_score,
        age_group=age_group,
        tier=tier,
    )


def parse_standings_text(text: str) -> list[dict[str, object]]:
    order = list(_DEFAULT_STAT_ORDER)
    rows: list[dict[str, object]] = []
    for raw_line in text.splitlines():
        line = " ".join(raw_line.replace("\xa0", " ").replace("|", " ").split())
        if not line or line.startswith("#"):
            continue
        header = _standing_header(line)
        if header is not None:
            order = header
            continue
        line = re.sub(r"^\d{1,2}\s+(?=[A-Za-z])", "", line)
        split = re.match(r"^(?P<name>.*?)\s+(?P<rest>-?\d.*)$", line)
        if split is None:
            continue
        numbers = [float(value) if "." in value else int(value) for value in _STANDING_NUMBER.findall(split.group("rest"))]
        if len(numbers) < 6:
            continue
        values = {column: numbers[index] for index, column in enumerate(order) if index < len(numbers)}
        try:
            games_played = int(values["gp"])
            wins = int(values["w"])
            losses = int(values["l"])
            draws = int(values.get("d", 0))
            goals_for = int(values["gf"])
            goals_against = int(values["ga"])
        except KeyError:
            continue
        team_name = split.group("name").strip()
        if not team_name:
            continue
        rows.append(
            {
                "team_name": team_name,
                "games_played": games_played,
                "wins": wins,
                "losses": losses,
                "draws": draws,
                "goals_for": goals_for,
                "goals_against": goals_against,
                "goal_diff": int(values["gd"]) if "gd" in values else None,
                "points": int(values["pts"]) if "pts" in values else None,
                "points_per_game": float(values["ppg"]) if "ppg" in values else None,
            }
        )
    return rows


def _standing_header(line: str) -> list[str] | None:
    tokens = [token.lower().strip(".") for token in line.replace("/", " ").split()]
    if "gp" not in tokens:
        return None
    if not ({"w", "pts", "ppg", "points"} & set(tokens)):
        return None
    order = [_STAT_HEADERS[token] for token in tokens if token in _STAT_HEADERS]
    if "gp" not in order or "w" not in order:
        return None
    return order
