#!/usr/bin/env python3
"""Fill field pins from the first Google Maps result.

Run this on the API shell, from the api directory, where the database
settings are already in the environment. Do not print those settings or
GEOAPIFY_API_KEY. A saved pin is not verified.

    python scripts/check_field_pins_against_maps.py

The job walks every schedule field. It does not stop at rows already in
venue_field_point. A field that already has coordinates is skipped. Every
other field is looked up with the same `{name}, {city}, {state}` query the
site uses. When the first result can be read and its state matches, those
coordinates are saved even if the result's city name differs from the
schedule. A pin is left blank only when the result cannot be read, or the
result's state does not match. The last line is:

    saved=N skipped=N failed=N
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
from app.locations import _complexes, _is_tbd
from app.maps_check import MapsPlace, accept_result, field_query, maps_result_url, parse_first_maps_result
from app.models import VenueFieldPoint
from app.places import PIN_RULE_MAPS_RESULT

_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"


def fetch_maps_body(query: str, timeout: float) -> str:
    request = urllib.request.Request(
        maps_result_url(query),
        headers={"User-Agent": _AGENT, "Accept-Language": "en-US,en"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def store_maps_pin(row: VenueFieldPoint, place: MapsPlace, now: datetime) -> None:
    street = place.street.strip()
    address = ", ".join(part for part in (street, place.city, place.state) if part)
    row.status = "found"
    row.provider = "google-maps"
    row.place_id = None
    row.formatted_address = address[:500] or None
    row.latitude = place.latitude
    row.longitude = place.longitude
    row.geocode_kind = "maps"
    row.pin_rule = PIN_RULE_MAPS_RESULT
    row.fetched_at = now


def main() -> int:
    parser = argparse.ArgumentParser(description="Save the first Google Maps result for fields with no coordinates.")
    parser.add_argument("--report", default="reports/field-pin-maps-check.md")
    parser.add_argument("--sleep", type=float, default=0.35)
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument("--dry-run", action="store_true", help="Look up and print counts without writing coordinates.")
    args = parser.parse_args()

    saved = 0
    skipped = 0
    failed = 0
    lines: list[str] = []
    session = SessionLocal()
    try:
        buckets = sorted(_complexes(session, datetime.now(UTC)).values(), key=lambda bucket: (bucket.venue_name, bucket.state, bucket.city))
        print(f"fields={len(buckets)}", flush=True)
        for index, bucket in enumerate(buckets):
            name, city, state = bucket.venue_name, bucket.city, bucket.state
            if _is_tbd(name) or not name or name == "TBD":
                skipped += 1
                continue
            row = session.get(VenueFieldPoint, bucket.venue_key)
            if row is not None and row.latitude is not None and row.longitude is not None:
                skipped += 1
                continue
            if not state:
                failed += 1
                print(f"failed {name}, {city} no-state", flush=True)
                continue
            query = field_query(name, city, state)
            try:
                place = parse_first_maps_result(fetch_maps_body(query, args.timeout))
            except (urllib.error.URLError, TimeoutError, OSError):
                place = None
            decision = accept_result(state, place)
            if decision.keep and place is not None:
                saved += 1
                print(
                    f"saved {name}, {city}, {state} -> {place.city}, {place.state} {place.latitude:.5f}, {place.longitude:.5f}",
                    flush=True,
                )
                lines.append(f"- {name}, {city}, {state} — saved {place.city}, {place.state} {place.latitude:.5f}, {place.longitude:.5f}. Not verified.")
                if not args.dry_run:
                    now = datetime.now(UTC)
                    if row is None:
                        row = VenueFieldPoint(
                            venue_key=bucket.venue_key,
                            venue_name=name[:160],
                            city=city[:80],
                            state=state[:2],
                            status="found",
                            fetched_at=now,
                        )
                        store_maps_pin(row, place, now)
                        session.add(row)
                    else:
                        store_maps_pin(row, place, now)
                    session.commit()
            else:
                failed += 1
                print(f"failed {name}, {city}, {state} {decision.reason}", flush=True)
                lines.append(f"- {name}, {city}, {state} — {decision.reason}. Left blank. Not verified.")
            if index + 1 < len(buckets):
                time.sleep(max(0.0, args.sleep))
    finally:
        print(f"saved={saved} skipped={skipped} failed={failed}", flush=True)
        session.close()

    report = Path(args.report)
    try:
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text(
            "\n".join(
                [
                    "# Field pins from Google Maps",
                    "",
                    "Every schedule field with no saved coordinates was looked up. A readable first result was saved when its state matched, even if the city name differed. This is not a verification.",
                    "",
                    f"saved={saved} skipped={skipped} failed={failed}",
                    "",
                    *(lines or ["- None."]),
                    "",
                ]
            ),
            encoding="utf-8",
        )
    except OSError:
        print(f"report not written: {args.report}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
