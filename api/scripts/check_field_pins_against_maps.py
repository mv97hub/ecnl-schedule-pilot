#!/usr/bin/env python3
"""One-time check of saved field pins against Google Maps.

Do not run this against production from an unattended machine. It reads the
database in DATABASE_URL and, unless --dry-run is set, clears pins that
disagree with the first Maps result. A kept pin is not verified.

From the api directory:

    python scripts/check_field_pins_against_maps.py --report reports/field-pin-maps-check.md

Add --dry-run to write the report without changing rows.

For each saved pin the query is `{venue name}, {city}, {state}`, the same
text the site puts in https://www.google.com/maps/search/?api=1&query=
The check reads the first result of that search. The pin is kept only when
that result is in the field's city and state and the saved coordinates are
within 25 miles of the result. Other pins are cleared and listed. Clay County
Regional Sports Complex, Middleburg, FL is always included in the report.
"""

from __future__ import annotations

import argparse
import sys
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal
from sqlalchemy import select

from app.maps_check import (
    NAMED_EXAMPLE,
    MapsPlace,
    PinComparison,
    compare_pin,
    field_query,
    is_named_example,
    maps_result_url,
    maps_search_link,
    parse_first_maps_result,
)
from app.models import VenueFieldPoint
from app.places import PIN_RULE_MAPS

_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"


def fetch_maps_body(query: str, timeout: float) -> str:
    request = urllib.request.Request(
        maps_result_url(query),
        headers={"User-Agent": _AGENT, "Accept-Language": "en-US,en"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def clear_pin(row: VenueFieldPoint, now: datetime) -> None:
    row.status = "miss"
    row.provider = None
    row.place_id = None
    row.formatted_address = None
    row.latitude = None
    row.longitude = None
    row.geocode_kind = "maps-check"
    row.pin_rule = PIN_RULE_MAPS
    row.fetched_at = now


def _line(name: str, city: str, state: str, detail: str) -> str:
    return f"- {name}, {city}, {state} — {detail}"


def _place_detail(place: MapsPlace | None, comparison: PinComparison, latitude: float, longitude: float) -> str:
    if comparison.reason == "no-result":
        return "left in place. The first Maps result could not be read, so the pin was not cleared. Not verified."
    if place is None:
        return "left in place. Not verified."
    where = f"first result {place.city}, {place.state} ({place.latitude:.5f}, {place.longitude:.5f})"
    if comparison.keep:
        return f"kept. {where}. The saved pin is near that result. Not verified."
    if comparison.reason == "pin-other-place":
        return (
            f"cleared. {where}. The saved pin was {latitude:.5f}, {longitude:.5f}, "
            "which is not in that city. Not verified."
        )
    return f"cleared. {where}, which is not this field's city and state. Not verified."


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare saved field pins with the first Google Maps result.")
    parser.add_argument("--report", default="reports/field-pin-maps-check.md")
    parser.add_argument("--sleep", type=float, default=0.35)
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument("--dry-run", action="store_true", help="Write the report and leave every pin unchanged.")
    args = parser.parse_args()

    session = SessionLocal()
    kept: list[str] = []
    cleared: list[str] = []
    unchecked: list[str] = []
    named: list[str] = []
    seen_named = False
    try:
        rows = list(
            session.scalars(
                select(VenueFieldPoint).order_by(VenueFieldPoint.venue_name, VenueFieldPoint.state, VenueFieldPoint.city)
            )
        )
        for index, row in enumerate(rows):
            named_row = is_named_example(row.venue_name, row.city, row.state)
            if named_row:
                seen_named = True
            if row.latitude is None or row.longitude is None:
                if named_row:
                    named.append(_line(row.venue_name, row.city, row.state, "no saved pin to compare. Not verified."))
                continue
            query = field_query(row.venue_name, row.city, row.state)
            latitude, longitude = float(row.latitude), float(row.longitude)
            fetched = True
            place: MapsPlace | None
            try:
                place = parse_first_maps_result(fetch_maps_body(query, args.timeout))
            except (urllib.error.URLError, TimeoutError, OSError):
                place = None
            comparison = compare_pin(row.city, row.state, latitude, longitude, place)
            detail = _place_detail(place, comparison, latitude, longitude)
            link = maps_search_link(query)
            text = _line(row.venue_name, row.city, row.state, f"{detail} [search]({link})")
            if comparison.reason == "no-result":
                unchecked.append(text)
            elif comparison.keep:
                kept.append(text)
            else:
                cleared.append(text)
                if not args.dry_run:
                    clear_pin(row, datetime.now(UTC))
                    session.commit()
            if named_row:
                named.append(text)
            if fetched and index + 1 < len(rows):
                time.sleep(max(0.0, args.sleep))
        if not seen_named:
            example_name, example_city, example_state = NAMED_EXAMPLE
            named.append(
                _line(
                    example_name,
                    example_city,
                    example_state,
                    "not in the saved-pin table. Nothing was compared. Not verified.",
                )
            )
    finally:
        session.close()

    report = Path(args.report)
    report.parent.mkdir(parents=True, exist_ok=True)
    mode = "Dry run. No pin was changed." if args.dry_run else "Pins that disagreed were cleared. A later map view does not look them up again."
    body = "\n".join(
        [
            "# Field pin check against Google Maps",
            "",
            "Each saved pin was compared with the first result of the same search the site already links to: `{name}, {city}, {state}`.",
            "",
            "A pin is kept only when that first result is in the field's city and state and the saved coordinates are within 25 miles of the result. This is not a verification. A kept pin is not 100% verified.",
            "",
            mode,
            "",
            f"Kept: {len(kept)}. Cleared: {len(cleared)}. Unchecked because the result could not be read: {len(unchecked)}.",
            "",
            "## Named example",
            "",
            *named,
            "",
            "## Cleared",
            "",
            *(cleared or ["- None."]),
            "",
            "## Unchecked",
            "",
            *(unchecked or ["- None."]),
            "",
            "## Kept",
            "",
            "These pins agreed with the first result. They are not verified.",
            "",
            *(kept[:25] or ["- None."]),
            "",
        ]
    )
    report.write_text(body, encoding="utf-8")
    print(f"Wrote {report.resolve()}")
    print(f"kept={len(kept)} cleared={len(cleared)} unchecked={len(unchecked)} dry_run={args.dry_run}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
