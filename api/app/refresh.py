"""Upsert the published league in place and record each refresh run.

This path does not drop tables. `load_league.py` downloads the JSON with urllib.
Playwright is not used.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlmodel import SQLModel

from app.database import engine, ensure_result_columns, ensure_source_columns
from app.ingestion.normalizer import looks_like_showcase
from app.models import Base, DataRefresh, ScheduleGame, ScheduleTeam
from app.standings import replace_ecnl_standings

_STATUSES = {"SCHEDULED", "COMPLETED", "POSTPONED", "CANCELLED"}


@dataclass(frozen=True)
class RefreshCounts:
    teams: int
    games: int
    scores: int


def public_error(exc: BaseException) -> str:
    message = re.sub(r"postgres(?:ql)?(?:\+\w+)?://\S+", "postgresql://***", str(exc), flags=re.IGNORECASE)
    return f"{type(exc).__name__}: {message}"


def ensure_refresh_tables() -> None:
    Base.metadata.create_all(engine)
    SQLModel.metadata.create_all(engine)
    ensure_result_columns()
    ensure_source_columns()


def open_refresh(started: datetime) -> int:
    ensure_refresh_tables()
    with Session(engine) as session:
        row = DataRefresh(started_at=started, status="running")
        session.add(row)
        session.commit()
        session.refresh(row)
        return int(row.id)


def complete_refresh(run_id: int, finished: datetime, counts: RefreshCounts) -> None:
    with Session(engine) as session:
        row = session.get(DataRefresh, run_id)
        if row is None or row.status != "running":
            return
        row.status = "success"
        row.finished_at = finished
        row.teams_count = counts.teams
        row.games_count = counts.games
        row.scores_count = counts.scores
        row.error = None
        session.commit()


def fail_refresh(run_id: int, finished: datetime, error: str) -> None:
    """Mark this run failed. Leave every earlier success row alone."""

    with Session(engine) as session:
        row = session.get(DataRefresh, run_id)
        if row is None or row.status != "running":
            return
        row.status = "failure"
        row.finished_at = finished
        row.error = error[:4000]
        session.commit()


def _instant(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _score(row: dict) -> tuple[str, int | None, int | None]:
    status = row.get("status") or "SCHEDULED"
    if status not in _STATUSES:
        status = "SCHEDULED"
    home_score = row.get("home_score")
    away_score = row.get("away_score")
    if status != "COMPLETED" or home_score is None or away_score is None:
        if status == "COMPLETED":
            status = "SCHEDULED"
        return status, None, None
    return "COMPLETED", int(home_score), int(away_score)


def _conference(event: str | None) -> bool:
    label = event or ""
    if looks_like_showcase(label):
        return False
    lowered = label.casefold()
    return "friendly" not in lowered and "invitational" not in lowered


def _has_result(status: str, home_score: int | None, away_score: int | None) -> bool:
    return status != "SCHEDULED" or home_score is not None or away_score is not None


def _index_teams(
    teams: list[ScheduleTeam],
) -> tuple[dict[int, ScheduleTeam], dict[tuple[str, str, str, str], ScheduleTeam], dict[tuple[str, str, str], list[ScheduleTeam]]]:
    by_source: dict[int, ScheduleTeam] = {}
    by_natural: dict[tuple[str, str, str, str], ScheduleTeam] = {}
    by_identity: dict[tuple[str, str, str], list[ScheduleTeam]] = {}
    for team in teams:
        if team.source_id is not None:
            by_source[team.source_id] = team
        by_natural[(team.name, team.age_group, team.tier, team.conference)] = team
        by_identity.setdefault((team.name, team.age_group, team.tier), []).append(team)
    return by_source, by_natural, by_identity


def _find_team(
    by_source: dict[int, ScheduleTeam],
    by_natural: dict[tuple[str, str, str, str], ScheduleTeam],
    by_identity: dict[tuple[str, str, str], list[ScheduleTeam]],
    row: dict,
) -> ScheduleTeam | None:
    source_id = int(row["source_id"])
    found = by_source.get(source_id)
    if found is not None:
        return found
    tier = (row.get("tier") or "ECNL")[:16]
    natural = (row["name"][:160], row["age_group"][:8], tier, row["conference"][:120])
    found = by_natural.get(natural)
    if found is not None and (found.source_id is None or found.source_id == source_id):
        return found
    matches = [
        team
        for team in by_identity.get((natural[0], natural[1], natural[2]), [])
        if team.source_id is None or team.source_id == source_id
    ]
    if len(matches) == 1:
        return matches[0]
    return None


def _assign_team(team: ScheduleTeam, row: dict) -> bool:
    tier = (row.get("tier") or "ECNL")[:16]
    fields = {
        "name": row["name"][:160],
        "age_group": row["age_group"][:8],
        "tier": tier,
        "conference": row["conference"][:120],
        "city": (row.get("city") or "Unknown")[:80] or "Unknown",
        "state": (row.get("state") or "NA")[:2] or "NA",
    }
    changed = False
    for key, value in fields.items():
        if getattr(team, key) != value:
            setattr(team, key, value)
            changed = True
    source_id = int(row["source_id"])
    if team.source_id != source_id:
        team.source_id = source_id
    return changed


def _index_games(
    games: list[ScheduleGame],
) -> tuple[dict[int, ScheduleGame], dict[tuple[int, int, datetime], list[ScheduleGame]]]:
    by_source: dict[int, ScheduleGame] = {}
    by_key: dict[tuple[int, int, datetime], list[ScheduleGame]] = {}
    for game in games:
        if game.source_id is not None:
            by_source[game.source_id] = game
        if game.starts_at is not None:
            by_key.setdefault((game.home_team_id, game.away_team_id, _instant(game.starts_at)), []).append(game)
    return by_source, by_key


def _find_game(
    by_source: dict[int, ScheduleGame],
    by_key: dict[tuple[int, int, datetime], list[ScheduleGame]],
    source_id: int,
    home_id: int,
    away_id: int,
    starts: datetime,
    venue: str,
) -> ScheduleGame | None:
    found = by_source.get(source_id)
    if found is not None:
        return found
    choices = [
        game
        for game in by_key.get((home_id, away_id, _instant(starts)), [])
        if game.source_id is None or game.source_id == source_id
    ]
    if len(choices) > 1:
        venue_matches = [game for game in choices if game.venue_name == venue]
        choices = venue_matches
    if len(choices) == 1:
        return choices[0]
    return None


def _assign_game(
    game: ScheduleGame,
    home_id: int,
    away_id: int,
    starts: datetime,
    row: dict,
    status: str,
    home_score: int | None,
    away_score: int | None,
) -> tuple[bool, bool]:
    venue = (row.get("venue_name") or "TBD")[:160]
    city = (row.get("city") or "Unknown")[:80] or "Unknown"
    state = (row.get("state") or "NA")[:2] or "NA"
    timezone = (row.get("timezone") or "America/New_York")[:64]
    event = row.get("event")
    conference = _conference(event)
    schedule_changed = False
    if game.home_team_id != home_id:
        game.home_team_id = home_id
        schedule_changed = True
    if game.away_team_id != away_id:
        game.away_team_id = away_id
        schedule_changed = True
    if _instant(game.starts_at) != _instant(starts):
        game.starts_at = starts
        schedule_changed = True
    for key, value in (
        ("venue_name", venue),
        ("city", city),
        ("state", state),
        ("timezone", timezone),
        ("event", event),
        ("is_conference_game", conference),
    ):
        if getattr(game, key) != value:
            setattr(game, key, value)
            schedule_changed = True
    score_changed = game.status != status or game.home_score != home_score or game.away_score != away_score
    if score_changed:
        game.status = status
        game.home_score = home_score
        game.away_score = away_score
    source_id = int(row["source_id"])
    if game.source_id != source_id:
        game.source_id = source_id
    return schedule_changed, score_changed


def upsert_published(payload: dict, *, refresh_standings: bool = True) -> RefreshCounts:
    """Insert or update published teams, games, and scores. Does not drop tables."""

    ensure_refresh_tables()
    teams_written = games_written = scores_written = 0
    with Session(engine) as session:
        stored_teams = list(session.scalars(select(ScheduleTeam)).all())
        for row in payload.get("teams") or []:
            if row.get("source_id") is None:
                continue
            by_source, by_natural, by_identity = _index_teams(stored_teams)
            team = _find_team(by_source, by_natural, by_identity, row)
            if team is None:
                team = ScheduleTeam(
                    name="Pending",
                    age_group="U13",
                    tier="ECNL",
                    conference="Pending",
                    city="Unknown",
                    state="NA",
                )
                session.add(team)
                stored_teams.append(team)
                _assign_team(team, row)
                teams_written += 1
            elif _assign_team(team, row):
                teams_written += 1
        session.flush()

        stored_games = list(session.scalars(select(ScheduleGame)).all())
        source_to_team = {team.source_id: team for team in stored_teams if team.source_id is not None}
        for row in payload.get("games") or []:
            if row.get("source_id") is None or row.get("home_source_id") is None or row.get("away_source_id") is None:
                continue
            home = source_to_team.get(int(row["home_source_id"]))
            away = source_to_team.get(int(row["away_source_id"]))
            if home is None or away is None or home.id is None or away.id is None or home.age_group != away.age_group:
                continue
            starts = datetime.fromisoformat(row["starts_at"])
            status, home_score, away_score = _score(row)
            venue = (row.get("venue_name") or "TBD")[:160]
            by_source, by_key = _index_games(stored_games)
            game = _find_game(by_source, by_key, int(row["source_id"]), home.id, away.id, starts, venue)
            if game is None:
                game = ScheduleGame(
                    home_team_id=home.id,
                    away_team_id=away.id,
                    starts_at=starts,
                    venue_name=venue,
                    city=(row.get("city") or "Unknown")[:80] or "Unknown",
                    state=(row.get("state") or "NA")[:2] or "NA",
                    timezone=(row.get("timezone") or "America/New_York")[:64],
                    event=row.get("event"),
                    status=status,
                    home_score=home_score,
                    away_score=away_score,
                    is_conference_game=_conference(row.get("event")),
                    source_id=int(row["source_id"]),
                )
                session.add(game)
                stored_games.append(game)
                games_written += 1
                if _has_result(status, home_score, away_score):
                    scores_written += 1
                continue
            schedule_changed, score_changed = _assign_game(
                game, home.id, away.id, starts, row, status, home_score, away_score
            )
            if schedule_changed:
                games_written += 1
            if score_changed:
                scores_written += 1
        session.commit()

    if refresh_standings:
        with Session(engine) as session:
            replace_ecnl_standings(session, "ECNL")
            replace_ecnl_standings(session, "ECNL-RL")
    return RefreshCounts(teams=teams_written, games=games_written, scores=scores_written)
