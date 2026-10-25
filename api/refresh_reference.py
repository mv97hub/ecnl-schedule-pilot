"""Monthly club, venue, logo, directory, and showcase pull.

From the repository root: cd api && python refresh_reference.py
This command does not change stored scores. A directory failure stays on the
reference job.
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime

from app.capture import UNAVAILABLE, pull_reference
from app.refresh import complete_refresh, fail_refresh, open_refresh, public_error


def _stamp(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def run() -> int:
    started = datetime.now(UTC)
    print(f"Reference refresh start {_stamp(started)}", flush=True)
    for note in UNAVAILABLE:
        print(f"Unavailable: {note}", flush=True)
    run_id: int | None = None
    try:
        run_id = open_refresh(started, job="reference")
        counts = pull_reference()
        finished = datetime.now(UTC)
        complete_refresh(run_id, finished, counts)
        print(f"clubs={counts.teams} squads={counts.games}", flush=True)
        print(f"Reference refresh success {_stamp(finished)}", flush=True)
        return 0
    except Exception as exc:
        finished = datetime.now(UTC)
        message = public_error(exc)
        if run_id is not None:
            try:
                fail_refresh(run_id, finished, message)
            except Exception as record_exc:
                print(f"Reference refresh failure {_stamp(finished)} {public_error(record_exc)}", flush=True)
        print(f"Reference refresh failure {_stamp(finished)} {message}", flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(run())
