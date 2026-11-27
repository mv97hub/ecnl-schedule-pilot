"""Geoapify lookups for one field point and for hotel or restaurant tips.

The key is read from GEOAPIFY_API_KEY. Requests send the query and the field
point. The account id, email, display name, and home address are not sent.
The key is not logged and is not returned.

A name search uses one category per request. Geoapify's name filter returns
no places when several categories are sent together.
"""

from __future__ import annotations

import os
import re
import threading
import time
from dataclasses import dataclass
from math import asin, cos, radians, sin, sqrt

import httpx

PROVIDER = "geoapify"
GEOCODE_URL = "https://api.geoapify.com/v1/geocode/search"
PLACES_URL = "https://api.geoapify.com/v2/places"
DETAILS_URL = "https://api.geoapify.com/v2/place-details"
SEARCH_RADIUS_METERS = 40234  # 25 miles
SUGGEST_LIMIT = 5
MIN_QUERY_CHARS = 3
NEAR_MILES = 25.0
FIELD_NEAR_CITY_MILES = 25.0
PIN_RULE_MATCH = "name-state-city-v1"
PIN_RULE_MISS = "miss"
PIN_RULE_ADMIN = "admin"
PIN_RULE_MAPS = "maps-mismatch"
_CITY_POINTS: dict[tuple[str, str], tuple[float, float] | None] = {}
PLACE_LIMIT = 30
PLACE_WINDOW_SECONDS = 10 * 60

_HOTEL_CATEGORIES = ("accommodation.hotel", "accommodation.motel", "accommodation.guest_house")
_FOOD_CATEGORIES = ("catering.restaurant", "catering.fast_food", "catering.cafe")
_HOTEL_PREFIXES = _HOTEL_CATEGORIES
_FOOD_PREFIXES = _FOOD_CATEGORIES
_PLACE_ID = re.compile(r"^[A-Za-z0-9]{8,512}$")
_LOCK = threading.Lock()
_HITS: dict[int, list[float]] = {}


class PlacesUnavailable(Exception):
    """Geoapify could not be called. The message stays empty so the key cannot leak."""


class PlacesBusy(Exception):
    """This account used its place-lookup allowance for the current window."""


@dataclass(frozen=True)
class GeocodeHit:
    place_id: str | None
    formatted_address: str
    latitude: float
    longitude: float
    kind: str = "place"


@dataclass(frozen=True)
class PlaceSuggestionHit:
    place_id: str
    name: str
    formatted_address: str
    street: str
    city: str
    state: str
    postal_code: str
    latitude: float | None = None
    longitude: float | None = None


@dataclass(frozen=True)
class PlaceHit:
    place_id: str
    name: str
    formatted_address: str
    latitude: float
    longitude: float
    categories: tuple[str, ...]


def reset_place_rate_limit() -> None:
    with _LOCK:
        _HITS.clear()
        _CITY_POINTS.clear()


def claim_place_slot(user_id: int) -> None:
    """Count one outbound Geoapify call for this account. Raise when the window is full."""

    moment = time.monotonic()
    with _LOCK:
        recent = [stamp for stamp in _HITS.get(user_id, []) if moment - stamp < PLACE_WINDOW_SECONDS]
        if len(recent) >= PLACE_LIMIT:
            _HITS[user_id] = recent
            raise PlacesBusy()
        recent.append(moment)
        _HITS[user_id] = recent


def clean_place_id(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    if not text:
        return None
    if _PLACE_ID.fullmatch(text) is None:
        raise ValueError("invalid place id")
    return text


def category_fits(category: str, labels: tuple[str, ...]) -> bool:
    """True when details omit categories, or one label is lodging or food for this tip."""

    if not labels:
        return True
    prefixes = _HOTEL_PREFIXES if category == "HOTEL" else _FOOD_PREFIXES if category == "RESTAURANT" else ()
    if not prefixes:
        return False
    for label in labels:
        for prefix in prefixes:
            if label == prefix or label.startswith(f"{prefix}."):
                return True
    return False


def miles_between(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius_miles = 3958.8
    phi1, phi2 = radians(lat1), radians(lat2)
    delta_phi = radians(lat2 - lat1)
    delta_lng = radians(lng2 - lng1)
    chord = sin(delta_phi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(delta_lng / 2) ** 2
    return 2 * radius_miles * asin(min(1.0, sqrt(chord)))


def geocode_complex(name: str, city: str, state: str) -> GeocodeHit | None:
    """One point for a complex name, city, and state. None when Geoapify has no match."""

    payload = _get(
        GEOCODE_URL,
        {
            "text": f"{name}, {city}, {state}",
            "format": "json",
            "limit": "1",
            "filter": "countrycode:us",
            "lang": "en",
        },
    )
    results = payload.get("results")
    if not isinstance(results, list) or not results:
        return None
    row = results[0]
    if not isinstance(row, dict):
        return None
    return _geocode_hit(row)


def geocode_venue(name: str, city: str, state: str) -> GeocodeHit | None:
    """Saved map pin for one field. None when no result passes the field checks.

    The tip form still uses ``geocode_complex``. A miss is not a verified absence.
    """

    return lookup_field_pin(name, city, state).hit


def suggest_places(query: str, category: str, latitude: float, longitude: float) -> list[PlaceSuggestionHit]:
    """Places whose names contain the typed text, inside twenty-five miles of the field.

    Each lodging or food category is a separate request. One combined category
    list makes Geoapify's name filter return an empty collection.
    """

    labels = _HOTEL_CATEGORIES if category == "HOTEL" else _FOOD_CATEGORIES if category == "RESTAURANT" else ()
    if not labels:
        return []
    point = f"{longitude:.6f},{latitude:.6f}"
    circle = f"circle:{point},{SEARCH_RADIUS_METERS}"
    bias = f"proximity:{point}"
    ranked: list[tuple[float, int, dict]] = []
    order = 0
    for label in labels:
        payload = _get(
            PLACES_URL,
            {
                "categories": label,
                "name": query,
                "filter": circle,
                "bias": bias,
                "limit": str(SUGGEST_LIMIT),
                "lang": "en",
            },
        )
        features = payload.get("features")
        if not isinstance(features, list):
            continue
        for feature in features:
            if not isinstance(feature, dict):
                continue
            props = feature.get("properties")
            distance = _number(props.get("distance")) if isinstance(props, dict) else None
            ranked.append((distance if distance is not None else 1e12, order, feature))
            order += 1
    ranked.sort(key=lambda item: (item[0], item[1]))
    return _suggestions({"features": [feature for _, _, feature in ranked]})


def retrieve_place(place_id: str) -> PlaceHit | None:
    """Details for one picked place. The stored address comes from this response."""

    payload = _get(DETAILS_URL, {"id": place_id, "features": "details", "lang": "en"})
    feature = _details_feature(payload)
    if feature is None:
        return None
    props = feature.get("properties")
    if not isinstance(props, dict):
        return None
    name = _text(props.get("name")) or _text(props.get("address_line1"))
    address = _formatted(props)
    coords = _coordinates(props, feature)
    if not name or not address or coords is None:
        return None
    returned: str | None = None
    raw_id = _text(props.get("place_id"))
    if raw_id:
        try:
            returned = clean_place_id(raw_id)
        except ValueError:
            returned = None
    try:
        stored_id = returned or clean_place_id(place_id)
    except ValueError:
        return None
    if stored_id is None:
        return None
    latitude, longitude = coords
    return PlaceHit(
        place_id=stored_id,
        name=name[:200],
        formatted_address=address[:500],
        latitude=latitude,
        longitude=longitude,
        categories=_categories(props.get("categories")),
    )


def _api_key() -> str:
    key = os.environ.get("GEOAPIFY_API_KEY", "").strip()
    if not key:
        raise PlacesUnavailable()
    return key


def _get(url: str, params: dict[str, str]) -> dict:
    """GET Geoapify. Failures raise PlacesUnavailable with an empty message."""

    query = dict(params)
    query["apiKey"] = _api_key()
    try:
        response = httpx.get(url, params=query, timeout=8.0)
        if response.status_code >= 400:
            raise PlacesUnavailable()
        payload = response.json()
    except PlacesUnavailable:
        raise
    except Exception:
        raise PlacesUnavailable() from None
    if not isinstance(payload, dict):
        raise PlacesUnavailable()
    return payload


_VENUE_TYPES = frozenset({"amenity", "building"})
_CENTROID_TYPES = frozenset({"city", "county", "state", "country"})
_CITY_TYPES = _CENTROID_TYPES | frozenset({"postcode"})
_VENUE_PREFIXES = ("leisure", "sport", "tourism", "entertainment", "natural", "building")
_NAME_STOP = frozenset(
    {
        "park",
        "parks",
        "field",
        "fields",
        "regional",
        "sports",
        "sport",
        "complex",
        "stadium",
        "center",
        "centre",
        "county",
        "the",
        "of",
        "and",
        "at",
        "fc",
        "soccer",
        "club",
        "national",
        "high",
        "school",
        "athletic",
        "athletics",
        "recreation",
        "community",
        "youth",
    }
)
_STATE_NAMES = {
    "alabama": "AL",
    "alaska": "AK",
    "arizona": "AZ",
    "arkansas": "AR",
    "california": "CA",
    "colorado": "CO",
    "connecticut": "CT",
    "delaware": "DE",
    "district of columbia": "DC",
    "florida": "FL",
    "georgia": "GA",
    "hawaii": "HI",
    "idaho": "ID",
    "illinois": "IL",
    "indiana": "IN",
    "iowa": "IA",
    "kansas": "KS",
    "kentucky": "KY",
    "louisiana": "LA",
    "maine": "ME",
    "maryland": "MD",
    "massachusetts": "MA",
    "michigan": "MI",
    "minnesota": "MN",
    "mississippi": "MS",
    "missouri": "MO",
    "montana": "MT",
    "nebraska": "NE",
    "nevada": "NV",
    "new hampshire": "NH",
    "new jersey": "NJ",
    "new mexico": "NM",
    "new york": "NY",
    "north carolina": "NC",
    "north dakota": "ND",
    "ohio": "OH",
    "oklahoma": "OK",
    "oregon": "OR",
    "pennsylvania": "PA",
    "rhode island": "RI",
    "south carolina": "SC",
    "south dakota": "SD",
    "tennessee": "TN",
    "texas": "TX",
    "utah": "UT",
    "vermont": "VT",
    "virginia": "VA",
    "washington": "WA",
    "west virginia": "WV",
    "wisconsin": "WI",
    "wyoming": "WY",
}


def _category_text(row: dict) -> str:
    parts: list[str] = []
    for key in ("category", "categories"):
        value = row.get(key)
        if isinstance(value, str):
            parts.append(value)
        elif isinstance(value, list):
            parts.extend(str(part) for part in value)
    return " ".join(parts).casefold()


def geocode_kind(row: dict) -> str:
    """``venue`` for a park, building, or amenity; ``city`` for a city or county centroid."""

    result_type = (_text(row.get("result_type")) or "").casefold()
    category = _category_text(row)
    labels = category.split()
    if result_type in _VENUE_TYPES or any(label.startswith(prefix) for label in labels for prefix in _VENUE_PREFIXES):
        return "venue"
    if result_type in _CITY_TYPES:
        return "city"
    return "place"


def _normalize_name(value: str) -> str:
    cleaned = "".join(ch if ch.isalnum() else " " for ch in value.casefold())
    return " ".join(cleaned.split())


def names_match(field_name: str, result_name: str) -> bool:
    """True when the result is this field, not merely another sports complex."""

    field = _normalize_name(field_name)
    result = _normalize_name(result_name)
    if not field or not result:
        return False
    if field in result or (len(result) >= 8 and result in field):
        return True
    field_tokens = [token for token in field.split() if token not in _NAME_STOP and len(token) > 2]
    result_tokens = [token for token in result.split() if token not in _NAME_STOP and len(token) > 2]
    if not field_tokens or not result_tokens:
        return False
    return all(any(token == other or token in other or other in token for other in result_tokens) for token in field_tokens)


def result_state(row: dict) -> str | None:
    for key in ("state_code", "state"):
        raw = _text(row.get(key))
        if not raw:
            continue
        upper = raw.upper()
        if len(upper) == 2 and upper.isalpha():
            return upper
        if upper.startswith("US-") and len(upper) == 5 and upper[3:].isalpha():
            return upper[3:]
        named = _STATE_NAMES.get(raw.casefold())
        if named:
            return named
    return None


def is_centroid(row: dict) -> bool:
    return (_text(row.get("result_type")) or "").casefold() in _CENTROID_TYPES


def is_field_venue(row: dict) -> bool:
    if is_centroid(row):
        return False
    result_type = (_text(row.get("result_type")) or "").casefold()
    if result_type in _VENUE_TYPES:
        return True
    category = _category_text(row)
    return any(category.startswith(prefix) or f" {prefix}" in f" {category}" for prefix in ("leisure", "sport", "stadium", "park"))


def field_result_passes(row: dict, name: str, state: str, city_lat: float, city_lng: float) -> bool:
    """A pin must match the field name and state, sit near that city, and not be a centroid."""

    if is_centroid(row) or not is_field_venue(row):
        return False
    if result_state(row) != state.strip().upper():
        return False
    if not names_match(name, _text(row.get("name"))):
        return False
    latitude = _number(row.get("lat"))
    longitude = _number(row.get("lon"))
    if latitude is None or longitude is None:
        return False
    return miles_between(latitude, longitude, city_lat, city_lng) <= FIELD_NEAR_CITY_MILES


def _pin_rank(row: dict) -> int:
    category = _category_text(row)
    if any(hint in category for hint in ("sport", "leisure.park", "stadium")):
        return 0
    return 1


def choose_field_pin(
    results: list,
    name: str,
    state: str,
    city_lat: float,
    city_lng: float,
) -> GeocodeHit | None:
    """Pick a passing park, stadium, or sports complex. None when every result fails."""

    best: tuple[int, int, GeocodeHit] | None = None
    for index, row in enumerate(results):
        if not isinstance(row, dict) or not field_result_passes(row, name, state, city_lat, city_lng):
            continue
        hit = _geocode_hit(row)
        if hit is None:
            continue
        rank = _pin_rank(row)
        if best is None or (rank, index) < (best[0], best[1]):
            best = (rank, index, hit)
    return None if best is None else best[2]


@dataclass(frozen=True)
class FieldLookup:
    hit: GeocodeHit | None
    outcome: str


def _geocode_rows(text: str, limit: str) -> list:
    payload = _get(
        GEOCODE_URL,
        {
            "text": text,
            "format": "json",
            "limit": limit,
            "filter": "countrycode:us",
            "lang": "en",
        },
    )
    results = payload.get("results")
    return results if isinstance(results, list) else []


def geocode_city_point(city: str, state: str) -> tuple[float, float] | None:
    """Reference point for the named city. Not a field pin."""

    key = (" ".join(city.split()).casefold(), state.strip().upper())
    with _LOCK:
        if key in _CITY_POINTS:
            return _CITY_POINTS[key]
    point: tuple[float, float] | None = None
    wanted = key[1]
    for row in _geocode_rows(f"{city}, {state}", "5"):
        if not isinstance(row, dict) or result_state(row) != wanted:
            continue
        if (_text(row.get("result_type")) or "").casefold() != "city":
            continue
        latitude = _number(row.get("lat"))
        longitude = _number(row.get("lon"))
        if latitude is None or longitude is None or not _valid(latitude, longitude):
            continue
        point = (latitude, longitude)
        break
    with _LOCK:
        _CITY_POINTS[key] = point
    return point


def lookup_field_pin(name: str, city: str, state: str) -> FieldLookup:
    """One Geoapify pass for a field. A failed check leaves the pin unset."""

    city_point = geocode_city_point(city, state)
    if city_point is None:
        return FieldLookup(None, "no-city")
    results = _geocode_rows(f"{name}, {city}, {state}", "8")
    hit = choose_field_pin(results, name, state, city_point[0], city_point[1])
    if hit is None:
        return FieldLookup(None, "rejected")
    return FieldLookup(hit, "accepted")


def _geocode_hit(row: dict) -> GeocodeHit | None:
    latitude = _number(row.get("lat"))
    longitude = _number(row.get("lon"))
    address = _text(row.get("formatted"))
    if latitude is None or longitude is None or not address or not _valid(latitude, longitude):
        return None
    place_id = _text(row.get("place_id"))
    stored_id: str | None = None
    if place_id:
        try:
            stored_id = clean_place_id(place_id)
        except ValueError:
            stored_id = None
    return GeocodeHit(
        place_id=stored_id,
        formatted_address=address[:500],
        latitude=latitude,
        longitude=longitude,
        kind=geocode_kind(row),
    )


def _suggestions(payload: dict) -> list[PlaceSuggestionHit]:
    features = payload.get("features")
    if not isinstance(features, list):
        return []
    found: list[PlaceSuggestionHit] = []
    seen: set[str] = set()
    for feature in features:
        if not isinstance(feature, dict):
            continue
        props = feature.get("properties")
        if not isinstance(props, dict):
            continue
        place_id = _text(props.get("place_id"))
        name = _text(props.get("name")) or _text(props.get("address_line1"))
        address = _formatted(props)
        if not place_id or not name or not address:
            continue
        try:
            cleaned = clean_place_id(place_id)
        except ValueError:
            continue
        if cleaned is None or cleaned in seen:
            continue
        seen.add(cleaned)
        street, city, state, postal = _address_parts(props, name)
        found.append(
            PlaceSuggestionHit(
                place_id=cleaned,
                name=name[:200],
                formatted_address=address[:500],
                street=street,
                city=city,
                state=state,
                postal_code=postal,
                latitude=_number(props.get("lat")),
                longitude=_number(props.get("lon")),
            )
        )
        if len(found) >= SUGGEST_LIMIT:
            break
    return found


def _details_feature(payload: dict) -> dict | None:
    features = payload.get("features")
    if not isinstance(features, list):
        return None
    fallback: dict | None = None
    for feature in features:
        if not isinstance(feature, dict):
            continue
        props = feature.get("properties")
        if not isinstance(props, dict):
            continue
        if fallback is None:
            fallback = feature
        if props.get("feature_type") == "details":
            return feature
    return fallback


def _same(left: str, right: str) -> bool:
    return bool(left) and bool(right) and left.casefold() == right.casefold()


def _without_leading_name(value: str, name: str) -> str:
    text = value.strip()
    if name and text.casefold().startswith(name.casefold()):
        return text[len(name) :].lstrip(" ,")
    return text


def _street_line(props: dict, name: str) -> str:
    """The street only. Geoapify puts the business name in address_line1 for a place."""

    housenumber = _text(props.get("housenumber"))
    street_name = _text(props.get("street"))
    composed = " ".join(part for part in (housenumber, street_name) if part)
    if composed and not _same(composed, name):
        return composed[:160]
    line1 = _text(props.get("address_line1"))
    if line1 and not _same(line1, name):
        return line1[:160]
    city = _text(props.get("city")) or _text(props.get("town")) or _text(props.get("village"))
    for source in (_text(props.get("address_line2")), _without_leading_name(_text(props.get("formatted")), name)):
        first = source.split(",")[0].strip() if source else ""
        if not first or _same(first, name) or _same(first, city):
            continue
        return first[:160]
    return ""


def _address_parts(props: dict, name: str) -> tuple[str, str, str, str]:
    city = _text(props.get("city")) or _text(props.get("town")) or _text(props.get("village"))
    code = _text(props.get("state_code"))
    state = code.upper() if code else _text(props.get("state"))
    postal = _text(props.get("postcode"))
    return _street_line(props, name), city[:80], state[:40], postal[:20]


def _formatted(props: dict) -> str:
    formatted = _text(props.get("formatted"))
    if formatted:
        return formatted
    line1 = _text(props.get("address_line1"))
    line2 = _text(props.get("address_line2"))
    return ", ".join(part for part in (line1, line2) if part)


def _coordinates(props: dict, feature: dict) -> tuple[float, float] | None:
    latitude = _number(props.get("lat"))
    longitude = _number(props.get("lon"))
    if latitude is None or longitude is None:
        geometry = feature.get("geometry")
        coords = geometry.get("coordinates") if isinstance(geometry, dict) else None
        if isinstance(coords, list) and len(coords) >= 2:
            longitude = _number(coords[0])
            latitude = _number(coords[1])
    if latitude is None or longitude is None or not _valid(latitude, longitude):
        return None
    return latitude, longitude


def _categories(value: object) -> tuple[str, ...]:
    if isinstance(value, str):
        parts = value.split(",")
    elif isinstance(value, list):
        parts = [str(part) for part in value]
    else:
        return ()
    return tuple(part.strip() for part in parts if part.strip())


def _text(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _valid(latitude: float, longitude: float) -> bool:
    return -90 <= latitude <= 90 and -180 <= longitude <= 180
