#!/usr/bin/env python3
"""One-time geocode of fields that do not yet have a saved pin decision.

Do not run this against production from an unattended machine. It calls
Geoapify with GEOAPIFY_API_KEY and writes to the database in DATABASE_URL.
The key is not printed. A saved pin is not verified.

From the api directory:

    python scripts/backfill_field_points.py --report reports/field-geocode-review.md

A point is saved only when the result matches the field's state, is not a
city, county, or state centroid, the name matches the field, and it is within
25 miles of that city. Anything else is stored with no coordinates. Fields
that already have a pin decision are skipped, including pins the Maps check
cleared. A new field with no saved point still goes through the same checks
the first time the map asks for it.
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal
from app.locations import _complexes, _is_tbd, _save_map_geocode
from app.models import VenueFieldPoint
from app.places import PIN_RULE_ADMIN, PIN_RULE_MAPS, PIN_RULE_MAPS_RESULT, PIN_RULE_MATCH, PIN_RULE_MISS, PlacesUnavailable, lookup_field_pin

_DECIDED = frozenset({PIN_RULE_MATCH, PIN_RULE_MISS, PIN_RULE_ADMIN, PIN_RULE_MAPS, PIN_RULE_MAPS_RESULT})


def main() -> int:
    parser = argparse.ArgumentParser(description="Save a field pin once when the geocode checks pass.")
    parser.add_argument("--report", default="reports/field-geocode-review.md")
    parser.add_argument("--sleep", type=float, default=0.2)
    args = parser.parse_args()

    session = SessionLocal()
    accepted: list[str] = []
    rejected: list[str] = []
    skipped = 0
    unavailable = 0
    try:
        buckets = list(_complexes(session, datetime.now(UTC)).values())
        print(f"fields={len(buckets)}", flush=True)
        for index, bucket in enumerate(buckets):
            name, city, state = bucket.venue_name, bucket.city, bucket.state
            if _is_tbd(name) or not city or not state:
                continue
            row = session.get(VenueFieldPoint, bucket.venue_key)
            if row is not None and (row.pin_rule or "") in _DECIDED:
                skipped += 1
                continue
            try:
                lookup = lookup_field_pin(name, city, state)
            except PlacesUnavailable:
                unavailable += 1
                rejected.append(f"- {name}, {city}, {state} — lookup unavailable. No coordinates stored. Not verified.")
                continue
            saved = _save_map_geocode(session, bucket, lookup)
            if lookup.hit is not None and saved.latitude is not None and saved.longitude is not None:
                accepted.append(
                    f"- {name}, {city}, {state} — {saved.latitude:.5f}, {saved.longitude:.5f}. Passed the checks. Not verified."
                )
            else:
                rejected.append(
                    f"- {name}, {city}, {state} — {lookup.outcome}. No coordinates stored. Not verified."
                )
            if index + 1 < len(buckets):
                time.sleep(max(0.0, args.sleep))
    finally:
        print(
            f"accepted={len(accepted)} rejected={len(rejected)} skipped={skipped} unavailable={unavailable}",
            flush=True,
        )
        session.close()

    report = Path(args.report)
    report.parent.mkdir(parents=True, exist_ok=True)
    body = "\n".join(
        [
            "# Field geocode review",
            "",
            "A saved point passed the state, name, and near-city checks and was not a city, county, or state centroid. A rejected field has no coordinates. None of these pins are verified.",
            "",
            f"Accepted this run: {len(accepted)}. Rejected this run: {len(rejected)}. Already decided and skipped: {skipped}. Unavailable: {unavailable}.",
            "",
            "## Rejected",
            "",
            *(rejected or ["- None."]),
            "",
            "## Accepted sample",
            "",
            *(accepted[:25] or ["- None."]),
            "",
        ]
    )
    report.write_text(body, encoding="utf-8")
    print(f"Wrote {report.resolve()}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
