"""Load the published 2026-27 ECNL Boys schedule into Postgres.

Re-runnable. Drops and recreates team and game, then inserts
api/data/ecnl_boys_2026_27.json. Refresh that file with load_league.py.
"""

from __future__ import annotations

import json
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session
from sqlmodel import SQLModel

from app.database import engine, ensure_result_columns
from app.ingestion.normalizer import looks_like_showcase
from app.models import Base, ScheduleGame as Game, ScheduleTeam as Team
from app.standings import replace_ecnl_standings

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
        connection.execute(text("DROP TABLE IF EXISTS conference_standing CASCADE"))
        connection.execute(text("DROP TABLE IF EXISTS game CASCADE"))
        connection.execute(text("DROP TABLE IF EXISTS team CASCADE"))
    Base.metadata.create_all(engine)
    SQLModel.metadata.create_all(engine)
    ensure_result_columns()


def _conference_game(event: str | None, _venue: str) -> bool:
    """League group play stays a conference game.

    Venue names such as Festival Park are places, so only the event label
    can mark a published match as a showcase, friendly, or invitational.
    """

    label = event or ""
    if looks_like_showcase(label):
        return False
    lowered = label.casefold()
    return "friendly" not in lowered and "invitational" not in lowered


def _published_score(row: dict) -> tuple[str, int | None, int | None]:
    status = row.get("status") or "SCHEDULED"
    if status not in {"SCHEDULED", "COMPLETED", "POSTPONED", "CANCELLED"}:
        status = "SCHEDULED"
    home_score = row.get("home_score")
    away_score = row.get("away_score")
    if status != "COMPLETED" or home_score is None or away_score is None:
        if status == "COMPLETED":
            status = "SCHEDULED"
        return status, None, None
    return "COMPLETED", int(home_score), int(away_score)


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
                tier=row.get("tier") or "ECNL",
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
            starts_at = datetime.fromisoformat(row["starts_at"])
            status, home_score, away_score = _published_score(row)
            games.append(
                Game(
                    home_team_id=home.id,
                    away_team_id=away.id,
                    starts_at=starts_at,
                    venue_name=row["venue_name"],
                    city=row["city"],
                    state=row["state"],
                    timezone=row["timezone"],
                    event=row.get("event"),
                    status=status,
                    home_score=home_score,
                    away_score=away_score,
                    is_conference_game=_conference_game(row.get("event"), row["venue_name"]),
                )
            )
        session.add_all(games)
        session.commit()

        ecnl_rows = replace_ecnl_standings(session, "ECNL")
        rl_rows = replace_ecnl_standings(session, "ECNL-RL")
        team_count = int(session.scalar(select(func.count()).select_from(Team)) or 0)
        game_count = int(session.scalar(select(func.count()).select_from(Game)) or 0)
        completed = int(session.scalar(select(func.count()).select_from(Game).where(Game.status == "COMPLETED")) or 0)
        jax_teams = session.scalars(select(Team).where(Team.name.ilike("%jax%"))).all()

    print(
        f"Seeded ECNL Boys {payload.get('season')}: teams={team_count} games={game_count} "
        f"completed={completed} ecnl_standings={ecnl_rows} rl_standings={rl_rows}"
    )
    for team in jax_teams:
        print(f"  {team.name} {team.age_group} {team.conference} {team.city}, {team.state}")
    return {"teams": team_count, "games": game_count}


def _instant(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def apply_published_scores() -> dict[str, int]:
    """Replace stored results with the box scores saved in the league file. Does not drop tables."""

    if not DATA_PATH.is_file():
        raise RuntimeError(f"Missing {DATA_PATH}. Run: python load_league.py --scores")
    payload = json.loads(DATA_PATH.read_text())
    teams_by_source = {row["source_id"]: row for row in payload["teams"]}
    published: dict[tuple, list[dict]] = {}
    for row in payload["games"]:
        home = teams_by_source[row["home_source_id"]]
        away = teams_by_source[row["away_source_id"]]
        key = (
            home["name"],
            away["name"],
            home["age_group"],
            home.get("tier") or "ECNL",
            home["conference"],
            _instant(datetime.fromisoformat(row["starts_at"])),
        )
        published.setdefault(key, []).append(row)

    updated = unmatched = ambiguous = 0
    with Session(engine) as session:
        db_teams = {team.id: team for team in session.scalars(select(Team)).all()}
        for game in session.scalars(select(Game)).all():
            home = db_teams[game.home_team_id]
            away = db_teams[game.away_team_id]
            key = (home.name, away.name, home.age_group, home.tier, home.conference, _instant(game.starts_at))
            choices = published.get(key, [])
            if len(choices) > 1:
                choices = [row for row in choices if row["venue_name"] == game.venue_name]
            if len(choices) != 1:
                if len(choices) > 1:
                    ambiguous += 1
                else:
                    unmatched += 1
                game.status = "SCHEDULED"
                game.home_score = None
                game.away_score = None
                continue
            status, home_score, away_score = _published_score(choices[0])
            game.status = status
            game.home_score = home_score
            game.away_score = away_score
            updated += 1
        if unmatched + ambiguous > 50:
            session.rollback()
            raise RuntimeError(f"Refusing to apply scores: {unmatched} unmatched and {ambiguous} ambiguous games.")
        session.commit()
        if unmatched or ambiguous:
            print(f"Score match left {unmatched} unmatched and {ambiguous} ambiguous games scheduled.", flush=True)
        ecnl_rows = replace_ecnl_standings(session)
        completed = int(session.scalar(select(func.count()).select_from(Game).where(Game.status == "COMPLETED")) or 0)

    print(f"Applied published scores: updated={updated} completed={completed} ecnl_standings={ecnl_rows}", flush=True)
    return {"updated": updated, "unmatched": unmatched, "ambiguous": ambiguous, "completed": completed}


if __name__ == "__main__":
    if "--apply-scores" in sys.argv:
        apply_published_scores()
    else:
        seed()
