"""Scheduled league refresh.

Downloads the public AthleteOne JSON, then upserts teams, games, and scores
in place. Does not drop the database and does not use Playwright.

From the repository root: cd api && python refresh_league.py
Pass --full to update completed games older than 7 days. The cron run omits it.
"""

from __future__ import annotations

import argparse
import sys
from datetime import UTC, datetime

from app.refresh import complete_refresh, fail_refresh, open_refresh, public_error, upsert_published
from load_league import load


def _stamp(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def run(full_pass: bool = False) -> int:
    started = datetime.now(UTC)
    print(f"League refresh start {_stamp(started)}", flush=True)
    run_id: int | None = None
    try:
        run_id = open_refresh(started)
        counts = upsert_published(load(), full_pass=full_pass)
        finished = datetime.now(UTC)
        complete_refresh(run_id, finished, counts)
        print(f"teams={counts.teams} games={counts.games} scores={counts.scores}", flush=True)
        print(f"League refresh success {_stamp(finished)}", flush=True)
        return 0
    except Exception as exc:
        finished = datetime.now(UTC)
        message = public_error(exc)
        if run_id is not None:
            try:
                fail_refresh(run_id, finished, message)
            except Exception as record_exc:
                print(f"League refresh failure {_stamp(finished)} {public_error(record_exc)}", flush=True)
        print(f"League refresh failure {_stamp(finished)} {message}", flush=True)
        return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Refresh the published ECNL league in place.")
    parser.add_argument(
        "--full",
        action="store_true",
        help="Update every stored game. The cron default skips completed games older than 7 days.",
    )
    args = parser.parse_args(argv)
    return run(full_pass=args.full)


if __name__ == "__main__":
    sys.exit(main())
