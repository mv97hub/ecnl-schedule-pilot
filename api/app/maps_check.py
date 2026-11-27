"""Read the first Google Maps result for a field and decide whether to store it.

The query is the same text the site already puts in its Maps search link:
`{venue name}, {city}, {state}`. The public link is
`https://www.google.com/maps/search/?api=1&query=`. A readable first result
is stored when its state matches the field. The result's city name does not
have to match the schedule city. Nothing here is marked verified.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from urllib.parse import urlencode

NAMED_EXAMPLE = ("Clay County Regional Sports Complex", "Middleburg", "FL")
_CITY_LINE = re.compile(r"^([^,]+),\s*([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?$")
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


def accept_result(field_state: str, place: MapsPlace | None) -> PinComparison:
    """Store a readable first result when its state matches. The city string is not required."""

    if place is None:
        return PinComparison(False, "no-result")
    if place.state != (field_state or "").strip().upper():
        return PinComparison(False, "state-mismatch")
    return PinComparison(True, "saved")


def _city_line(value: str) -> tuple[str, str] | None:
    match = _CITY_LINE.match(value.strip())
    if match is None:
        return None
    city = match.group(1).strip()
    if not city or city.lower().startswith("http"):
        return None
    return city, match.group(2).upper()


class _Finder:
    def __init__(self) -> None:
        self.street: str | None = None
        self.city: str | None = None
        self.state: str | None = None
        self.point: tuple[float, float] | None = None

    def walk(self, node: object) -> None:
        if self.city is not None and self.point is not None:
            return
        if isinstance(node, str):
            parsed = _city_line(node) if self.city is None else None
            if parsed is not None:
                self.city, self.state = parsed
                self.street = ""
            return
        if not isinstance(node, list):
            return
        if (
            self.city is None
            and len(node) == 2
            and isinstance(node[0], str)
            and isinstance(node[1], str)
            and not node[0].lower().startswith("http")
        ):
            parsed = _city_line(node[1])
            if parsed is not None:
                self.street = node[0].strip()
                self.city, self.state = parsed
        if (
            self.point is None
            and len(node) >= 4
            and node[0] is None
            and node[1] is None
            and isinstance(node[2], (int, float))
            and isinstance(node[3], (int, float))
            and _valid(float(node[2]), float(node[3]))
        ):
            self.point = (float(node[2]), float(node[3]))
        for child in node:
            self.walk(child)
            if self.city is not None and self.point is not None:
                return


def _valid(latitude: float, longitude: float) -> bool:
    return -90.0 <= latitude <= 90.0 and -180.0 <= longitude <= 180.0
