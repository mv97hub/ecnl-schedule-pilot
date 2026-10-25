"""Weekly player profiles and coaching staff.

From the repository root: cd api && python refresh_people.py
This command does not change stored scores. A directory or roster failure
stays on the people job.
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime

from app.capture import UNAVAILABLE, pull_people
from app.refresh import complete_refresh, fail_refresh, open_refresh, public_error


def _stamp(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def run() -> int:
    started = datetime.now(UTC)
    print(f"People refresh start {_stamp(started)}", flush=True)
    for note in UNAVAILABLE:
        print(f"Unavailable: {note}", flush=True)
    run_id: int | None = None
    try:
        run_id = open_refresh(started, job="people")
        counts = pull_people()
        finished = datetime.now(UTC)
        complete_refresh(run_id, finished, counts)
        print(f"coaches={counts.teams} players={counts.games}", flush=True)
        print(f"People refresh success {_stamp(finished)}", flush=True)
        return 0
    except Exception as exc:
        finished = datetime.now(UTC)
        message = public_error(exc)
        if run_id is not None:
            try:
                fail_refresh(run_id, finished, message)
            except Exception as record_exc:
                print(f"People refresh failure {_stamp(finished)} {public_error(record_exc)}", flush=True)
        print(f"People refresh failure {_stamp(finished)} {message}", flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(run())
