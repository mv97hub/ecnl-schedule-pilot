"""Turn raw venue and team strings into the values stored on an ingested game."""

from __future__ import annotations

import hashlib
import re
from datetime import date

_FIELD_SPLIT = re.compile(
    r"""
    ^(?P<complex>.+?)
    (?:
        \s*\#\s*(?P<hash>[A-Za-z0-9]+)
        |
        \s*[-–—]\s*(?:field|fld|pitch|court)\s*\#?\s*(?P<dashed>[A-Za-z0-9]+)
        |
        \s+(?:field|fld|pitch|court)\s*\#?\s*(?P<word>[A-Za-z0-9]+)
    )
    \s*$
    """,
    re.IGNORECASE | re.VERBOSE,
)
_ECNL_SUFFIX = re.compile(r"\s+ECNL(?:\s+B\d{4}(?:/\d{2,4})?)?\s*$", re.IGNORECASE)
_BIRTH_YEAR = re.compile(r"\s+B\d{4}(?:/\d{2,4})?\s*$", re.IGNORECASE)
_TRAILING_AGE = re.compile(r"\s+U\d{2}(?:/\d{2})?\s*$", re.IGNORECASE)
_SHOWCASE = re.compile(r"\b(?:showcase|tournament|classic|festival)\b", re.IGNORECASE)
_CITY_STATE = re.compile(r"^(?P<body>.*?),\s*(?P<city>[^,]+),\s*(?P<state>[A-Za-z]{2})\s*$")
_FIELD_TOKEN = re.compile(
    r"^(?:(?:field|fld|pitch|court)\s*\#?\s*|#\s*)(?P<field>[A-Za-z0-9]+)$",
    re.IGNORECASE,
)


def split_venue(raw: str) -> tuple[str, str]:
    """Split 'Central Park #3' or 'Matt Park - Field 2' into complex and field number."""

    text = " ".join((raw or "").replace("\xa0", " ").split())
    if not text:
        return "", ""
    match = _FIELD_SPLIT.match(text)
    if match is None:
        return text, ""
    complex_name = match.group("complex").strip(" \t-–—")
    field_number = match.group("hash") or match.group("dashed") or match.group("word") or ""
    return complex_name, field_number


def normalize_field_number(raw: str) -> str:
    text = " ".join((raw or "").split())
    if not text:
        return ""
    match = _FIELD_TOKEN.match(text)
    if match:
        return match.group("field")
    _complex_name, field_number = split_venue(f"Venue {text}")
    return field_number or text


def standardize_team_name(raw: str) -> str:
    """Collapse whitespace and drop a trailing ECNL age or birth-year token."""

    text = " ".join((raw or "").replace("\xa0", " ").split())
    text = _ECNL_SUFFIX.sub("", text)
    text = _BIRTH_YEAR.sub("", text)
    text = _TRAILING_AGE.sub("", text)
    return " ".join(text.split()).strip()


def looks_like_showcase(*parts: str) -> bool:
    return any(_SHOWCASE.search(part or "") for part in parts)


def split_location(raw: str) -> tuple[str, str, str]:
    """Return complex name, field number, and 'City, ST' peeled off the end."""

    text = " ".join((raw or "").replace("\xa0", " ").split())
    if not text:
        return "", "", ""
    venue = text
    city_state = ""
    match = _CITY_STATE.match(text)
    if match and not re.search(r"\d", match.group("city")):
        venue = match.group("body").strip(" \t-–—")
        city_state = f"{match.group('city').strip()}, {match.group('state').upper()}"
    complex_name, field_number = split_venue(venue)
    return complex_name, field_number, city_state


def build_match_key(game_date: date, home_name: str, away_name: str, age_group: str) -> str:
    """Identity of a match. Kickoff and field are left out so a re-import can change them."""

    home = standardize_team_name(home_name).casefold()
    away = standardize_team_name(away_name).casefold()
    age = " ".join((age_group or "Unknown").split()).casefold() or "unknown"
    payload = f"{game_date.isoformat()}|{home}|{away}|{age}"
    return hashlib.sha256(payload.encode()).hexdigest()
