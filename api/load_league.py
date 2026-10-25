"""Download the published 2026-27 ECNL and ECNL RL schedules for boys and girls.

Uses the public JSON API behind theecnl.com (api.athleteone.com). Writes
api/data/ecnl_boys_2026_27.json for seed.py. Org 12 is ECNL Boys, org 16 is
ECNL RL Boys, org 9 is ECNL Girls, and org 13 is ECNL RL Girls. Pre-ECNL orgs
21 and 22 are not included. Scores come from published box scores.
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from zoneinfo import ZoneInfo

from app.ingestion.normalizer import counts_as_conference

API = "https://api.athleteone.com/api"
ORG_ID = 12
SEASON = "2026-27"
OUTPUT = Path(__file__).resolve().parent / "data" / "ecnl_boys_2026_27.json"
SKIP_EVENT_IDS = {4423, 4424}  # QA and a non-US test event
LEAGUES = (
    {"org_id": 12, "tier": "ECNL", "prefix": "ECNL Boys", "gender": "boys", "divisions": "boysDivAndFlightList"},
    {"org_id": 16, "tier": "ECNL-RL", "prefix": "ECNL RL Boys", "gender": "boys", "divisions": "boysDivAndFlightList"},
    {"org_id": 9, "tier": "ECNL", "prefix": "ECNL Girls", "gender": "girls", "divisions": "girlsDivAndFlightList"},
    {"org_id": 13, "tier": "ECNL-RL", "prefix": "ECNL RL Girls", "gender": "girls", "divisions": "girlsDivAndFlightList"},
)
_GLUE_ECNL = re.compile(r"(?<=\S)(?=ECNL)", re.IGNORECASE)
_YEAR_TOKEN = re.compile(r"^(?:[BG]\d{2,4}(?:/\d{2,4})?|[BG]U\d{2}|\d{2,4}/\d{2,4}[BG]?)$", re.IGNORECASE)
_LEAGUE_TAGS = {"ecnl", "ecnl-rl", "rl", "ntx", "stxcl", "socal", "s.cal", "gma", "gla"}

STATE_TIMEZONE = {
    "AL": "America/Chicago",
    "AK": "America/Anchorage",
    "AZ": "America/Phoenix",
    "AR": "America/Chicago",
    "CA": "America/Los_Angeles",
    "CO": "America/Denver",
    "CT": "America/New_York",
    "DC": "America/New_York",
    "DE": "America/New_York",
    "FL": "America/New_York",
    "GA": "America/New_York",
    "HI": "Pacific/Honolulu",
    "IA": "America/Chicago",
    "ID": "America/Boise",
    "IL": "America/Chicago",
    "IN": "America/Indiana/Indianapolis",
    "KS": "America/Chicago",
    "KY": "America/New_York",
    "LA": "America/Chicago",
    "MA": "America/New_York",
    "MD": "America/New_York",
    "ME": "America/New_York",
    "MI": "America/Detroit",
    "MN": "America/Chicago",
    "MO": "America/Chicago",
    "MS": "America/Chicago",
    "MT": "America/Denver",
    "NC": "America/New_York",
    "ND": "America/Chicago",
    "NE": "America/Chicago",
    "NH": "America/New_York",
    "NJ": "America/New_York",
    "NM": "America/Denver",
    "NV": "America/Los_Angeles",
    "NY": "America/New_York",
    "OH": "America/New_York",
    "OK": "America/Chicago",
    "OR": "America/Los_Angeles",
    "PA": "America/New_York",
    "RI": "America/New_York",
    "SC": "America/New_York",
    "SD": "America/Chicago",
    "TN": "America/Chicago",
    "TX": "America/Chicago",
    "UT": "America/Denver",
    "VA": "America/New_York",
    "VT": "America/New_York",
    "WA": "America/Los_Angeles",
    "WI": "America/Chicago",
    "WV": "America/New_York",
    "WY": "America/Denver",
}


def get_json(url: str) -> dict | list:
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "ecnl-schedule-pilot"})
            with urllib.request.urlopen(request, timeout=60) as response:
                payload = json.load(response)
            if isinstance(payload, dict) and "data" in payload:
                return payload["data"]
            return payload
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Failed {url}: {last_error}")


def age_group(division_name: str) -> str:
    label = division_name.strip().upper()
    if label[:1] in {"B", "G"}:
        label = label[1:]
    if label not in {"U13", "U14", "U15", "U16", "U17", "U18/19"}:
        raise RuntimeError(f"Unexpected division {division_name}")
    return label


def display_name(team_name: str) -> str:
    """Drop league and birth-year tags while keeping squad labels.

    "San Diego Surf ECNL RL White B2013/14" stays "San Diego Surf White".
    "San Diego Surf ECNL RL S.Cal B2013/14" becomes "San Diego Surf".
    A color, roman numeral, or coach name after the birth year is kept.
    """

    tokens = _GLUE_ECNL.sub(" ", team_name).split()
    drop: set[int] = set()
    for index, token in enumerate(tokens):
        folded = token.casefold()
        if folded not in {"ecnl", "ecnl-rl"} and not folded.startswith("ecnl"):
            continue
        drop.add(index)
        cursor = index + 1
        while cursor < len(tokens):
            current = tokens[cursor]
            if current.casefold() in _LEAGUE_TAGS or _YEAR_TOKEN.fullmatch(current):
                drop.add(cursor)
                cursor += 1
                continue
            if current.casefold() in {"s.", "s"} and cursor + 1 < len(tokens) and tokens[cursor + 1].casefold() == "cal":
                drop.update((cursor, cursor + 1))
                cursor += 2
                continue
            if current.casefold() in {"b", "g"} and cursor + 1 < len(tokens) and _YEAR_TOKEN.fullmatch(tokens[cursor + 1]):
                drop.update((cursor, cursor + 1))
                cursor += 2
                continue
            break
        cursor = index + 1
        while cursor < len(tokens):
            if cursor in drop:
                cursor += 1
                continue
            current = tokens[cursor]
            if _YEAR_TOKEN.fullmatch(current):
                drop.add(cursor)
                cursor += 1
                continue
            if current.casefold() in {"b", "g"} and cursor + 1 < len(tokens) and _YEAR_TOKEN.fullmatch(tokens[cursor + 1]):
                drop.update((cursor, cursor + 1))
                cursor += 2
                continue
            cursor += 1
        cursor = index - 1
        while cursor >= 0:
            current = tokens[cursor]
            if _YEAR_TOKEN.fullmatch(current):
                drop.add(cursor)
                cursor -= 1
                continue
            if current.casefold() in {"b", "g"} and (cursor + 1 in drop or (cursor + 1 < len(tokens) and _YEAR_TOKEN.fullmatch(tokens[cursor + 1]))):
                drop.add(cursor)
                cursor -= 1
                continue
            break
    cleaned = " ".join(token for index, token in enumerate(tokens) if index not in drop).strip()
    if drop:
        cleaned = re.sub(r"\s+-\s*$", "", cleaned).strip()
    return cleaned or team_name.strip()


def conference_name(event_name: str) -> str:
    return re.sub(r"\s+2026-27$", "", event_name).strip()


def conference_label(event_name: str, flight_name: str, flight_count: int) -> str:
    base = conference_name(event_name)
    if flight_count <= 1:
        return base
    suffix = flight_name.split(" - ")[-1].strip() if " - " in flight_name else flight_name.strip()
    if not suffix or suffix.casefold() in {"ecnl", "ecrl"}:
        return base
    return f"{base} - {suffix}"


def timezone_for(state: str, zip_code: str) -> str:
    if state == "FL" and zip_code[:3] in {"324", "325"}:
        return "America/Chicago"
    if state == "TN" and zip_code[:3] in {str(n) for n in range(376, 386)}:
        return "America/New_York"
    if state == "TX" and zip_code[:3] in {"798", "799", "885"}:
        return "America/Denver"
    if state == "KY" and zip_code[:3] in {"420", "421", "422"}:
        return "America/Chicago"
    return STATE_TIMEZONE.get(state, "America/New_York")


class ZipLookup:
    """Resolve venue zips. A bad or unreachable zip is skipped and cached."""

    def __init__(self) -> None:
        self.cache: dict[str, tuple[str, str] | None] = {}
        self.successes = 0
        self.failures = 0
        self.disabled = False

    def lookup(self, zip_code: str) -> tuple[str, str] | None:
        digits = "".join(ch for ch in str(zip_code) if ch.isdigit())[:5]
        if len(digits) != 5:
            return None
        if digits in self.cache:
            return self.cache[digits]
        if self.disabled:
            self.cache[digits] = None
            self.failures += 1
            return None
        try:
            request = urllib.request.Request(
                f"https://api.zippopotam.us/us/{digits}",
                headers={"Accept": "application/json", "User-Agent": "ecnl-schedule-pilot"},
            )
            with urllib.request.urlopen(request, timeout=2) as response:
                payload = json.load(response)
            places = payload.get("places") if isinstance(payload, dict) else None
            if not places:
                raise ValueError(f"no place for {digits}")
            state = str(places[0].get("state abbreviation") or "")
            city = str(places[0].get("place name") or "")
            if len(state) != 2 or not city:
                raise ValueError(f"incomplete place for {digits}")
            found = (city, state)
            self.cache[digits] = found
            self.successes += 1
            return found
        except Exception:
            self.cache[digits] = None
            self.failures += 1
            if self.successes == 0 and self.failures >= 3:
                self.disabled = True
                print("Zip lookup is not responding. Remaining zips will use the home club city.", flush=True)
            return None


def kickoff_iso(game_date: str, zone_name: str) -> str:
    naive = game_date.split(".")[0]
    if naive.endswith("Z"):
        naive = naive[:-1]
    if "T" not in naive:
        raise RuntimeError(f"Unexpected kickoff {game_date}")
    stamp = __import__("datetime").datetime.fromisoformat(naive)
    aware = stamp.replace(tzinfo=ZoneInfo(zone_name))
    return aware.isoformat()


def official_result(match: dict) -> tuple[str, int | None, int | None]:
    """Use a published box score. Unplayed games stay scheduled with no score."""

    flag = (match.get("flagText") or "").strip().casefold()
    schedule_status = (match.get("status") or "").strip().casefold()
    if "postpone" in flag or "postpone" in schedule_status:
        return "POSTPONED", None, None
    if "cancel" in flag or "cancel" in schedule_status:
        return "CANCELLED", None, None
    home = match.get("hometeamscore")
    away = match.get("awayteamscore")
    if flag == "box score" and home is not None and away is not None:
        return "COMPLETED", int(home), int(away)
    return "SCHEDULED", None, None


def fetch_match_index() -> dict[int, dict]:
    """Current ECNL and ECNL RL matches for boys and girls, keyed by match id."""

    flights: list[tuple[int, int]] = []
    for league in LEAGUES:
        clubs = get_json(f"{API}/Event/get-org-club-list-by-orgID/{league['org_id']}")
        event_ids = sorted({club["eventID"] for club in clubs if club.get("eventID") and club["eventID"] not in SKIP_EVENT_IDS})
        for event_id in event_ids:
            details = get_json(f"{API}/team/get-event-details-by-eventid/{event_id}")
            name = details["name"]
            if SEASON not in name or not name.startswith(league["prefix"]):
                continue
            divisions = get_json(f"{API}/Event/get-event-schedule-or-standings/{event_id}")
            for division in divisions.get(league["divisions"]) or []:
                for flight in division.get("flightList") or []:
                    flights.append((event_id, flight["flightID"]))

    def fetch_flight(item: tuple[int, int]) -> list[dict]:
        event_id, flight_id = item
        rows = get_json(f"{API}/Event/get-schedules-by-flight/{event_id}/{flight_id}/0")
        return rows if isinstance(rows, list) else []

    index: dict[int, dict] = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        for future in as_completed(pool.submit(fetch_flight, item) for item in flights):
            for match in future.result():
                match_id = match.get("matchID")
                if match_id is None or match.get("isactive") == 0:
                    continue
                if not match.get("hometeamID") or not match.get("awayteamID"):
                    continue
                index[match_id] = match
    return index


def apply_official_results(payload: dict, index: dict[int, dict]) -> dict[str, int]:
    completed = scheduled = missing = 0
    for game in payload["games"]:
        match = index.get(game["source_id"])
        if match is None:
            game["status"] = "SCHEDULED"
            game["home_score"] = None
            game["away_score"] = None
            missing += 1
            continue
        status, home_score, away_score = official_result(match)
        game["status"] = status
        game["home_score"] = home_score
        game["away_score"] = away_score
        if status == "COMPLETED":
            completed += 1
        else:
            scheduled += 1
    return {"completed": completed, "scheduled": scheduled, "missing": missing, "official_matches": len(index)}


def refresh_scores() -> dict:
    """Write published box scores onto the saved schedule without reloading venues."""

    if not OUTPUT.is_file():
        raise RuntimeError(f"Missing {OUTPUT}. Run load_league.py first.")
    payload = json.loads(OUTPUT.read_text())
    index = fetch_match_index()
    stats = apply_official_results(payload, index)
    OUTPUT.write_text(json.dumps(payload))
    print(
        f"Updated {OUTPUT.name}: completed={stats['completed']} scheduled={stats['scheduled']} "
        f"missing={stats['missing']} official_matches={stats['official_matches']}",
        flush=True,
    )
    return payload


def event_label(match: dict) -> str | None:
    if match.get("friendly") == 1:
        return "Friendly"
    kind = (match.get("type") or "").strip()
    if kind and kind.lower() != "group play":
        return kind
    note = (match.get("publicNote") or "").strip()
    return note or None


def _text(value: object, limit: int = 240) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text[:limit]


def _float_field(match: dict, *keys: str) -> float | None:
    for key in keys:
        if key not in match or match[key] in (None, ""):
            continue
        try:
            return float(match[key])
        except (TypeError, ValueError):
            return None
    return None


def match_is_conference(match: dict, event_name: str) -> bool:
    if match.get("friendly") == 1:
        return False
    return counts_as_conference(
        str(match.get("type") or ""),
        str(match.get("publicNote") or ""),
        event_label(match) or "",
        event_name,
    )


def download_league(league: dict) -> dict:
    org_id = league["org_id"]
    prefix = league["prefix"]
    tier = league["tier"]
    gender = league["gender"]
    division_key = league["divisions"]
    clubs = get_json(f"{API}/Event/get-org-club-list-by-orgID/{org_id}")
    club_home = {
        club["clubID"]: {
            "city": (club.get("city") or "").strip(),
            "state": (club.get("stateCode") or "").strip(),
        }
        for club in clubs
        if club.get("clubID")
    }
    event_ids = sorted({club["eventID"] for club in clubs if club.get("eventID") and club["eventID"] not in SKIP_EVENT_IDS})
    events = []
    for event_id in event_ids:
        details = get_json(f"{API}/team/get-event-details-by-eventid/{event_id}")
        name = details["name"]
        if SEASON not in name or not name.startswith(prefix):
            continue
        events.append({"id": event_id, "name": name, "tier": tier, "gender": gender})

    flights: list[tuple[dict, dict]] = []
    flight_rows: list[dict] = []
    for event in events:
        divisions = get_json(f"{API}/Event/get-event-schedule-or-standings/{event['id']}")
        for division in divisions.get(division_key) or []:
            group = age_group(division["divisionName"])
            flight_list = division.get("flightList") or []
            for flight in flight_list:
                described = {
                    "id": flight["flightID"],
                    "division_id": division.get("divisionID"),
                    "age_group": group,
                    "conference": conference_label(event["name"], flight.get("flightName") or "", len(flight_list)),
                    "flight_name": flight.get("flightName") or "",
                }
                flights.append((event, described))
                flight_rows.append(
                    {
                        "event_id": event["id"],
                        "event_name": event["name"],
                        "division_id": division.get("divisionID"),
                        "flight_id": flight["flightID"],
                        "flight_name": flight.get("flightName") or "",
                        "age_group": group,
                        "gender": gender,
                        "tier": tier,
                        "conference": described["conference"],
                    }
                )

    def fetch_flight(item: tuple[dict, dict]) -> list[dict]:
        event, flight = item
        rows = get_json(f"{API}/Event/get-schedules-by-flight/{event['id']}/{flight['id']}/0")
        if not isinstance(rows, list):
            return []
        for row in rows:
            row["_conference"] = flight["conference"]
            row["_age_group"] = flight["age_group"]
            row["_tier"] = event["tier"]
            row["_gender"] = event["gender"]
            row["_event_name"] = event["name"]
        return rows

    print(f"Fetching {tier} {gender}: {len(events)} events, {len(flights)} flights.", flush=True)
    matches: list[dict] = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(fetch_flight, item) for item in flights]
        for future in as_completed(futures):
            matches.extend(future.result())

    unique_matches: dict[int, dict] = {}
    for match in matches:
        match_id = match.get("matchID")
        if match_id is None or match.get("isactive") == 0:
            continue
        if not match.get("hometeamID") or not match.get("awayteamID"):
            continue
        match["_conference_game"] = match_is_conference(match, match.get("_event_name") or "")
        unique_matches[match_id] = match

    print(f"Loaded {len(unique_matches)} matches. Resolving venue zips.", flush=True)
    zip_lookup = ZipLookup()
    teams: dict[int, dict] = {}
    games = []
    missing_place = 0
    for match in unique_matches.values():
        if not match.get("_conference_game"):
            continue
        for side, team_key, club_key, name_key in (
            ("home", "hometeamID", "homeTeamClubID", "homeTeam"),
            ("away", "awayteamID", "awayTeamClubID", "awayTeam"),
        ):
            team_id = match[team_key]
            if team_id in teams:
                continue
            club = club_home.get(match.get(club_key), {})
            teams[team_id] = {
                "source_id": team_id,
                "name": display_name(match[name_key]),
                "age_group": match["_age_group"],
                "tier": match["_tier"],
                "conference": match["_conference"],
                "city": club.get("city") or "",
                "state": club.get("state") or "",
                "gender": match["_gender"],
                "club_id": match.get(club_key),
            }

    for match in unique_matches.values():
        zip_code = "".join(ch for ch in str(match.get("zip") or "") if ch.isdigit())[:5]
        place = zip_lookup.lookup(zip_code) if zip_code else None
        home = teams.get(match["hometeamID"])
        club = club_home.get(match.get("homeTeamClubID"), {})
        if place:
            city, state = place
        else:
            missing_place += 1
            city = (home or {}).get("city") or club.get("city") or "Unknown"
            state = (home or {}).get("state") or club.get("state") or "FL"
        zone = timezone_for(state, zip_code)
        status, home_score, away_score = official_result(match)
        games.append(
            {
                "source_id": match["matchID"],
                "home_source_id": match["hometeamID"],
                "away_source_id": match["awayteamID"],
                "home_club_id": match.get("homeTeamClubID"),
                "away_club_id": match.get("awayTeamClubID"),
                "age_group": match["_age_group"],
                "gender": match["_gender"],
                "starts_at": kickoff_iso(match["gameDate"], zone),
                "timezone": zone,
                "venue_name": (match.get("complex") or "TBD").strip(),
                "city": city,
                "state": state,
                "event": event_label(match),
                "status": status,
                "home_score": home_score,
                "away_score": away_score,
                "is_conference_game": bool(match.get("_conference_game")),
                "field_name": _text(match.get("venue"), 160),
                "venue_zip": zip_code or None,
                "venue_address": _text(match.get("address") if "address" in match else match.get("venueAddress")),
                "venue_lat": _float_field(match, "latitude", "lat", "venueLat"),
                "venue_lng": _float_field(match, "longitude", "lng", "venueLng"),
                "stream_link": _text(match.get("streamLink") or match.get("streamUrl") or match.get("broadcastUrl"), 400),
                "field_surface": _text(match.get("fieldSurface") or match.get("surface"), 80),
                "postponement_reason": _text(match.get("postponementReason") or match.get("postponeReason"), 240) if status == "POSTPONED" else None,
            }
        )

    for team in teams.values():
        if team["city"] and team["state"]:
            continue
        home_games = [game for game in games if game["home_source_id"] == team["source_id"]]
        if home_games:
            team["city"] = team["city"] or home_games[0]["city"]
            team["state"] = team["state"] or home_games[0]["state"]
        if not team["city"]:
            team["city"] = "Unknown"
        if not team["state"]:
            team["state"] = "NA"

    print(
        f"{tier}: conferences={len({team['conference'] for team in teams.values()})} "
        f"teams={len(teams)} games={len(games)} completed={sum(1 for game in games if game['status'] == 'COMPLETED')} "
        f"postponed={sum(1 for game in games if game['status'] == 'POSTPONED')} "
        f"zips_ok={zip_lookup.successes} zips_skipped={zip_lookup.failures} venue_fallbacks={missing_place}",
        flush=True,
    )
    return {"teams": list(teams.values()), "games": games, "flights": flight_rows}


def write_payload(teams: list[dict], games: list[dict]) -> dict:
    team_ids = [team["source_id"] for team in teams]
    game_ids = [game["source_id"] for game in games]
    if len(team_ids) != len(set(team_ids)):
        raise RuntimeError("Team source ids collide across leagues")
    if len(game_ids) != len(set(game_ids)):
        raise RuntimeError("Game source ids collide across leagues")
    payload = {
        "league": "ECNL",
        "season": SEASON,
        "source": "api.athleteone.com",
        "teams": sorted(teams, key=lambda team: (team.get("tier") or "", team["conference"], team["age_group"], team["name"], team["source_id"])),
        "games": sorted(games, key=lambda game: (game["starts_at"], game["source_id"])),
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload))
    print(f"Wrote {OUTPUT.name}: teams={len(payload['teams'])} games={len(payload['games'])}", flush=True)
    return payload


def load() -> dict:
    teams: list[dict] = []
    games: list[dict] = []
    flights: list[dict] = []
    for league in LEAGUES:
        downloaded = download_league(league)
        teams.extend(downloaded["teams"])
        games.extend(downloaded["games"])
        flights.extend(downloaded["flights"])
    payload = write_payload(teams, games)
    payload["flights"] = flights
    return payload


def merge_missing() -> dict:
    """Add any league that is not already in the saved file, without re-downloading the rest."""

    if not OUTPUT.is_file():
        return load()
    payload = json.loads(OUTPUT.read_text())
    for team in payload["teams"]:
        team["tier"] = team.get("tier") or "ECNL"
    present = {(team.get("tier") or "ECNL", team.get("gender") or "boys") for team in payload["teams"]}
    teams = list(payload["teams"])
    games = list(payload["games"])
    for league in LEAGUES:
        key = (league["tier"], league["gender"])
        if key in present:
            continue
        downloaded = download_league(league)
        teams.extend(downloaded["teams"])
        games.extend(downloaded["games"])
        present.add(key)
    return write_payload(teams, games)


if __name__ == "__main__":
    import sys

    if "--scores" in sys.argv:
        refresh_scores()
    elif "--merge" in sys.argv:
        merge_missing()
    else:
        load()
