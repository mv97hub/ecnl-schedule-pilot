"""Load the published 2026-27 ECNL Boys schedule into Postgres.

Re-runnable. Drops and recreates team and game, then inserts
api/data/ecnl_boys_2026_27.json. Refresh that file with load_league.py.
"""

from __future__ import annotations

import json
import time
from datetime import datetime
from pathlib import Path

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.database import engine
from app.models import Base, Game, Team

DATA_PATH = Path(__file__).resolve().parent / "data" / "ecnl_boys_2026_27.json"


def wait_for_database(timeout_seconds: int = 180) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with engine.connect() as connection:
                connection.execute(text("SELECT 1"))
            return
        except Exception as exc:
            last_error = exc
            time.sleep(2)
    raise RuntimeError(f"Postgres did not accept connections within {timeout_seconds}s: {last_error}")


def recreate_tables() -> None:
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE IF EXISTS game CASCADE"))
        connection.execute(text("DROP TABLE IF EXISTS team CASCADE"))
    Base.metadata.create_all(engine)


def seed() -> dict[str, int]:
    if not DATA_PATH.is_file():
        raise RuntimeError(f"Missing {DATA_PATH}. Run: python load_league.py")

    payload = json.loads(DATA_PATH.read_text())
    wait_for_database()
    recreate_tables()

    with Session(engine) as session:
        teams = {
            row["source_id"]: Team(
                name=row["name"],
                age_group=row["age_group"],
                conference=row["conference"],
                city=row["city"],
                state=row["state"],
            )
            for row in payload["teams"]
        }
        session.add_all(teams.values())
        session.flush()

        games = []
        for row in payload["games"]:
            home = teams.get(row["home_source_id"])
            away = teams.get(row["away_source_id"])
            if home is None or away is None or home.age_group != away.age_group:
                continue
            games.append(
                Game(
                    home_team_id=home.id,
                    away_team_id=away.id,
                    starts_at=datetime.fromisoformat(row["starts_at"]),
                    venue_name=row["venue_name"],
                    city=row["city"],
                    state=row["state"],
                    timezone=row["timezone"],
                    event=row.get("event"),
                )
            )
        session.add_all(games)
        session.commit()

        team_count = int(session.scalar(select(func.count()).select_from(Team)) or 0)
        game_count = int(session.scalar(select(func.count()).select_from(Game)) or 0)
        jax_teams = session.scalars(select(Team).where(Team.name.ilike("%jax%"))).all()

    print(f"Seeded ECNL Boys {payload.get('season')}: teams={team_count} games={game_count}")
    for team in jax_teams:
        print(f"  {team.name} {team.age_group} {team.conference} {team.city}, {team.state}")
    return {"teams": team_count, "games": game_count}


if __name__ == "__main__":
    seed()
