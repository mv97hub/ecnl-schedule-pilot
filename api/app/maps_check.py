"""Compare a saved field pin with the first Google Maps result.

The query is the same text the site already puts in its Maps search link:
`{venue name}, {city}, {state}`. The public link is
`https://www.google.com/maps/search/?api=1&query=`. The check reads the first
result of that query. A pin is kept only when that result is in the field's
city and state and the saved coordinates are near the result. Nothing here is
marked verified.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from math import asin, cos, radians, sin, sqrt
from urllib.parse import urlencode

AGREE_MILES = 25.0
NAMED_EXAMPLE = ("Clay County Regional Sports Complex", "Middleburg", "FL")
_ADDRESS = re.compile(r"^(.+?),\s*([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?$")
_PREFIX = ")]}'"


@dataclass(frozen=True)
class MapsPlace:
    street: str
    city: str
    state: str
    latitude: float
    longitude: float


@dataclass(frozen=True)
class PinComparison:
    keep: bool
    reason: str


def field_query(name: str, city: str, state: str) -> str:
    """Same string as the site's Google Maps search link and `_place`."""

    return f"{name}, {city}, {state}"


def maps_search_link(query: str) -> str:
    """The link the site builds. Opening it searches this query."""

    return "https://www.google.com/maps/search/?" + urlencode({"api": "1", "query": query})


def maps_result_url(query: str) -> str:
    """Read the first result for the same query the site link searches."""

    return "https://www.google.com/search?" + urlencode({"tbm": "map", "hl": "en", "gl": "us", "q": query})


def city_key(value: str) -> str:
    text = "".join(ch if ch.isalnum() else " " for ch in value.casefold().replace(".", " "))
    words = ["st" if word == "saint" else word for word in text.split()]
    return " ".join(words)


def is_named_example(name: str, city: str, state: str) -> bool:
    example_name, example_city, example_state = NAMED_EXAMPLE
    return city_key(name) == city_key(example_name) and city_key(city) == city_key(example_city) and state.strip().upper() == example_state


def parse_first_maps_result(body: str) -> MapsPlace | None:
    """First place in a Google map-search payload: street, city, state, coordinates."""

    text = body.lstrip()
    if text.startswith(_PREFIX):
        text = text[len(_PREFIX) :].lstrip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return None
    found = _Finder()
    found.walk(data)
    if found.city is None or found.state is None or found.point is None:
        return None
    return MapsPlace(
        street=found.street or "",
        city=found.city,
        state=found.state,
        latitude=found.point[0],
        longitude=found.point[1],
    )


def compare_pin(city: str, state: str, latitude: float, longitude: float, place: MapsPlace | None) -> PinComparison:
    """Keep the pin only when the first result is in this city and state and the pin is near it."""

    if place is None:
        return PinComparison(False, "no-result")
    if city_key(city) != city_key(place.city) or state.strip().upper() != place.state:
        return PinComparison(False, "result-other-place")
    if _miles(latitude, longitude, place.latitude, place.longitude) > AGREE_MILES:
        return PinComparison(False, "pin-other-place")
    return PinComparison(True, "kept")


class _Finder:
    def __init__(self) -> None:
        self.street: str | None = None
        self.city: str | None = None
        self.state: str | None = None
        self.point: tuple[float, float] | None = None

    def walk(self, node: object) -> None:
        if self.point is not None or not isinstance(node, list):
            return
        if (
            self.city is None
            and len(node) == 2
            and isinstance(node[0], str)
            and isinstance(node[1], str)
        ):
            match = _ADDRESS.match(node[1].strip())
            if match is not None:
                self.street = node[0].strip()
                self.city = match.group(1).strip()
                self.state = match.group(2).upper()
        if (
            self.city is not None
            and len(node) >= 4
            and node[0] is None
            and node[1] is None
            and isinstance(node[2], (int, float))
            and isinstance(node[3], (int, float))
            and _valid(float(node[2]), float(node[3]))
        ):
            self.point = (float(node[2]), float(node[3]))
            return
        for child in node:
            self.walk(child)
            if self.point is not None:
                return


def _valid(latitude: float, longitude: float) -> bool:
    return -90.0 <= latitude <= 90.0 and -180.0 <= longitude <= 180.0


def _miles(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius = 3958.8
    phi1, phi2 = radians(lat1), radians(lat2)
    chord = sin(radians(lat2 - lat1) / 2) ** 2 + cos(phi1) * cos(phi2) * sin(radians(lng2 - lng1) / 2) ** 2
    return 2 * radius * asin(min(1.0, sqrt(chord)))
