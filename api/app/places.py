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
    """Point for a field name plus city and state, preferring a park or venue over a city centroid.

    The map explorer uses this. The tip form still uses ``geocode_complex``.
    """

    payload = _get(
        GEOCODE_URL,
        {
            "text": f"{name}, {city}, {state}",
            "format": "json",
            "limit": "5",
            "filter": "countrycode:us",
            "lang": "en",
        },
    )
    results = payload.get("results")
    if not isinstance(results, list):
        return None
    return choose_geocode(results, name)


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
_CITY_TYPES = frozenset({"city", "county", "state", "country", "postcode"})
_AREA_TYPES = frozenset({"street", "suburb", "district", "neighbourhood", "neighborhood"})
_VENUE_PREFIXES = ("leisure", "sport", "tourism", "entertainment", "natural", "building", "parking")


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


def _name_matches(row: dict, name: str) -> bool:
    wanted = name.casefold().strip()
    found = (_text(row.get("name")) or "").casefold()
    if not wanted or not found:
        return False
    return wanted in found or found in wanted


def _geocode_rank(row: dict, name: str) -> int:
    kind = geocode_kind(row)
    named = _name_matches(row, name)
    result_type = (_text(row.get("result_type")) or "").casefold()
    if kind == "venue" and named:
        return 0
    if kind == "venue":
        return 1
    if named and result_type in _AREA_TYPES:
        return 2
    if named and kind != "city":
        return 3
    if kind == "city":
        return 5
    return 4


def choose_geocode(results: list, name: str) -> GeocodeHit | None:
    """Pick the field pin. A named park or venue beats a city, county, or state centroid."""

    best: tuple[int, int, GeocodeHit] | None = None
    for index, row in enumerate(results):
        if not isinstance(row, dict):
            continue
        hit = _geocode_hit(row)
        if hit is None:
            continue
        rank = _geocode_rank(row, name)
        if best is None or (rank, index) < (best[0], best[1]):
            best = (rank, index, hit)
    return None if best is None else best[2]


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
