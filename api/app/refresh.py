"""Upsert the published league in place and record each refresh run.

This path does not drop tables. `load_league.py` downloads the JSON with urllib.
Playwright is not used.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlmodel import SQLModel

from app.database import engine, ensure_capture_columns, ensure_result_columns, ensure_source_columns
from app.ingestion.normalizer import counts_as_conference
from app.models import Base, DataRefresh, ScheduleGame, ScheduleTeam
from app.standings import replace_ecnl_standings

_STATUSES = {"SCHEDULED", "COMPLETED", "POSTPONED", "CANCELLED"}
_OLD_COMPLETED = timedelta(days=7)


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
    ensure_capture_columns()


def open_refresh(started: datetime, job: str = "schedule") -> int:
    ensure_refresh_tables()
    with Session(engine) as session:
        row = DataRefresh(started_at=started, status="running", job=job if job in {"schedule", "people", "reference"} else "schedule")
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
    return counts_as_conference(event or "")


def _gender_value(value: object) -> str:
    text = str(value or "boys").strip().casefold()
    return text if text in {"boys", "girls"} else "boys"


def _conference_flag(row: dict) -> bool:
    if "is_conference_game" in row and row["is_conference_game"] is not None:
        return bool(row["is_conference_game"])
    return _conference(row.get("event"))


def _optional_text(row: dict, key: str, limit: int) -> str | None:
    if key not in row or row[key] is None:
        return None
    text = str(row[key]).strip()
    if not text:
        return None
    return text[:limit]


def _optional_float(row: dict, key: str) -> float | None:
    if key not in row or row[key] in (None, ""):
        return None
    try:
        return float(row[key])
    except (TypeError, ValueError):
        return None


_PLACE_FIELDS = (
    ("venue_address", 240),
    ("venue_zip", 16),
    ("field_name", 160),
    ("stream_link", 400),
    ("field_surface", 80),
    ("postponement_reason", 240),
)


def _apply_place(game: ScheduleGame, row: dict) -> bool:
    changed = False
    for key, limit in _PLACE_FIELDS:
        if key not in row:
            continue
        value = _optional_text(row, key, limit)
        if getattr(game, key) != value:
            setattr(game, key, value)
            changed = True
    for key in ("venue_lat", "venue_lng"):
        if key not in row:
            continue
        value = _optional_float(row, key)
        if getattr(game, key) != value:
            setattr(game, key, value)
            changed = True
    return changed


def _has_result(status: str, home_score: int | None, away_score: int | None) -> bool:
    return status != "SCHEDULED" or home_score is not None or away_score is not None


def _natural_key(name: str, age_group: str, tier: str, conference: str, gender: str) -> tuple[str, str, str, str, str]:
    return (name, age_group, tier, conference, gender)


def _index_teams(
    teams: list[ScheduleTeam],
) -> tuple[dict[int, ScheduleTeam], dict[tuple[str, str, str, str, str], ScheduleTeam], dict[tuple[str, str, str, str], list[ScheduleTeam]]]:
    by_source: dict[int, ScheduleTeam] = {}
    by_natural: dict[tuple[str, str, str, str, str], ScheduleTeam] = {}
    by_identity: dict[tuple[str, str, str, str], list[ScheduleTeam]] = {}
    for team in teams:
        if team.source_id is not None:
            by_source[team.source_id] = team
        gender = _gender_value(team.gender)
        by_natural[_natural_key(team.name, team.age_group, team.tier, team.conference, gender)] = team
        by_identity.setdefault((team.name, team.age_group, team.tier, gender), []).append(team)
    return by_source, by_natural, by_identity


def _find_team(
    by_source: dict[int, ScheduleTeam],
    by_natural: dict[tuple[str, str, str, str, str], ScheduleTeam],
    by_identity: dict[tuple[str, str, str, str], list[ScheduleTeam]],
    row: dict,
) -> ScheduleTeam | None:
    source_id = int(row["source_id"])
    found = by_source.get(source_id)
    if found is not None:
        return found
    tier = (row.get("tier") or "ECNL")[:16]
    gender = _gender_value(row.get("gender"))
    natural = _natural_key(row["name"][:160], row["age_group"][:8], tier, row["conference"][:120], gender)
    found = by_natural.get(natural)
    if found is not None and (found.source_id is None or found.source_id == source_id):
        return found
    matches = [
        team
        for team in by_identity.get((natural[0], natural[1], natural[2], gender), [])
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
        "gender": _gender_value(row.get("gender")),
    }
    changed = False
    for key, value in fields.items():
        if getattr(team, key) != value:
            setattr(team, key, value)
            changed = True
    if "club_id" in row and row["club_id"] is not None:
        club_id = int(row["club_id"])
        if team.club_id != club_id:
            team.club_id = club_id
            changed = True
    source_id = int(row["source_id"])
    if team.source_id != source_id:
        team.source_id = source_id
        changed = True
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
    conference = _conference_flag(row)
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
    if _apply_place(game, row):
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


def _remember_team(
    by_source: dict[int, ScheduleTeam],
    by_natural: dict[tuple[str, str, str, str, str], ScheduleTeam],
    by_identity: dict[tuple[str, str, str, str], list[ScheduleTeam]],
    team: ScheduleTeam,
) -> None:
    if team.source_id is not None:
        by_source[team.source_id] = team
    gender = _gender_value(team.gender)
    by_natural[_natural_key(team.name, team.age_group, team.tier, team.conference, gender)] = team
    by_identity.setdefault((team.name, team.age_group, team.tier, gender), []).append(team)


def _drop_identity(
    by_identity: dict[tuple[str, str, str, str], list[ScheduleTeam]],
    key: tuple[str, str, str, str],
    team: ScheduleTeam,
) -> None:
    remaining = [item for item in by_identity.get(key, []) if item is not team]
    if remaining:
        by_identity[key] = remaining
    elif key in by_identity:
        del by_identity[key]


def _reindex_team(
    by_source: dict[int, ScheduleTeam],
    by_natural: dict[tuple[str, str, str, str, str], ScheduleTeam],
    by_identity: dict[tuple[str, str, str, str], list[ScheduleTeam]],
    team: ScheduleTeam,
    row: dict,
) -> bool:
    old_source = team.source_id
    old_gender = _gender_value(team.gender)
    old_natural = _natural_key(team.name, team.age_group, team.tier, team.conference, old_gender)
    old_identity = (team.name, team.age_group, team.tier, old_gender)
    changed = _assign_team(team, row)
    if team.source_id != old_source:
        if old_source is not None and by_source.get(old_source) is team:
            del by_source[old_source]
        if team.source_id is not None:
            by_source[team.source_id] = team
    gender = _gender_value(team.gender)
    new_natural = _natural_key(team.name, team.age_group, team.tier, team.conference, gender)
    if new_natural != old_natural:
        if by_natural.get(old_natural) is team:
            del by_natural[old_natural]
        by_natural[new_natural] = team
    new_identity = (team.name, team.age_group, team.tier, gender)
    if new_identity != old_identity:
        _drop_identity(by_identity, old_identity, team)
        by_identity.setdefault(new_identity, []).append(team)
    return changed


def _game_key(home_id: int, away_id: int, starts: datetime) -> tuple[int, int, datetime]:
    return (home_id, away_id, _instant(starts))


def _remember_game(
    by_source: dict[int, ScheduleGame],
    by_key: dict[tuple[int, int, datetime], list[ScheduleGame]],
    game: ScheduleGame,
) -> None:
    if game.source_id is not None:
        by_source[game.source_id] = game
    if game.starts_at is not None:
        by_key.setdefault(_game_key(game.home_team_id, game.away_team_id, game.starts_at), []).append(game)


def _forget_game_key(
    by_key: dict[tuple[int, int, datetime], list[ScheduleGame]],
    game: ScheduleGame,
    home_id: int,
    away_id: int,
    starts: datetime,
) -> None:
    key = _game_key(home_id, away_id, starts)
    remaining = [item for item in by_key.get(key, []) if item is not game]
    if remaining:
        by_key[key] = remaining
    elif key in by_key:
        del by_key[key]


def _reindex_game(
    by_source: dict[int, ScheduleGame],
    by_key: dict[tuple[int, int, datetime], list[ScheduleGame]],
    game: ScheduleGame,
    home_id: int,
    away_id: int,
    starts: datetime,
    row: dict,
    status: str,
    home_score: int | None,
    away_score: int | None,
) -> tuple[bool, bool]:
    old_source = game.source_id
    old_home = game.home_team_id
    old_away = game.away_team_id
    old_starts = game.starts_at
    schedule_changed, score_changed = _assign_game(game, home_id, away_id, starts, row, status, home_score, away_score)
    if game.source_id != old_source:
        if old_source is not None and by_source.get(old_source) is game:
            del by_source[old_source]
        if game.source_id is not None:
            by_source[game.source_id] = game
    old_key = None if old_starts is None else _game_key(old_home, old_away, old_starts)
    new_key = None if game.starts_at is None else _game_key(game.home_team_id, game.away_team_id, game.starts_at)
    if old_key != new_key:
        if old_starts is not None:
            _forget_game_key(by_key, game, old_home, old_away, old_starts)
        if new_key is not None:
            by_key.setdefault(new_key, []).append(game)
    return schedule_changed, score_changed


def _is_old_completed(game: ScheduleGame, now: datetime) -> bool:
    return (
        game.status == "COMPLETED"
        and game.starts_at is not None
        and _instant(game.starts_at) < _instant(now) - _OLD_COMPLETED
    )


def _squads(teams: list[ScheduleTeam]) -> dict[tuple[int, str, str], list[ScheduleTeam]]:
    grouped: dict[tuple[int, str, str], list[ScheduleTeam]] = {}
    for team in teams:
        if team.club_id is None:
            continue
        grouped.setdefault((int(team.club_id), team.age_group, _gender_value(team.gender)), []).append(team)
    return grouped


def _side_team(
    source_to_team: dict[int, ScheduleTeam],
    squads: dict[tuple[int, str, str], list[ScheduleTeam]],
    row: dict,
    side: str,
) -> ScheduleTeam | None:
    source_id = int(row[f"{side}_source_id"])
    found = source_to_team.get(source_id)
    if found is not None:
        return found
    if _conference_flag(row):
        return None
    club_id = row.get(f"{side}_club_id")
    age_group = row.get("age_group")
    if club_id is None or not age_group:
        return None
    matches = squads.get((int(club_id), str(age_group), _gender_value(row.get("gender"))), [])
    if len(matches) == 1:
        return matches[0]
    return None


def upsert_published(payload: dict, *, refresh_standings: bool = True, full_pass: bool = False) -> RefreshCounts:
    """Insert or update published teams, games, and scores. Does not drop tables."""

    ensure_refresh_tables()
    teams_written = games_written = scores_written = 0
    examined = skipped_old = 0
    print("Teams started", flush=True)
    with Session(engine) as session:
        stored_teams = list(session.scalars(select(ScheduleTeam)).all())
        by_source, by_natural, by_identity = _index_teams(stored_teams)
        for row in payload.get("teams") or []:
            if row.get("source_id") is None:
                continue
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
                _remember_team(by_source, by_natural, by_identity, team)
                teams_written += 1
            elif _reindex_team(by_source, by_natural, by_identity, team, row):
                teams_written += 1
        print(f"Teams finished written={teams_written}", flush=True)
        session.flush()

        stored_games = list(session.scalars(select(ScheduleGame)).all())
        games_by_source, games_by_key = _index_games(stored_games)
        source_to_team = {team.source_id: team for team in stored_teams if team.source_id is not None}
        squads = _squads(stored_teams)
        now = datetime.now(UTC)
        print("Games started full pass" if full_pass else "Games started seven-day window", flush=True)
        for row in payload.get("games") or []:
            if row.get("source_id") is None or row.get("home_source_id") is None or row.get("away_source_id") is None:
                continue
            examined += 1
            home = _side_team(source_to_team, squads, row, "home")
            away = _side_team(source_to_team, squads, row, "away")
            same_gender = home is not None and away is not None and _gender_value(home.gender) == _gender_value(away.gender)
            if home is not None and away is not None and home.id is not None and away.id is not None and home.age_group == away.age_group and same_gender:
                starts = datetime.fromisoformat(row["starts_at"])
                status, home_score, away_score = _score(row)
                venue = (row.get("venue_name") or "TBD")[:160]
                game = _find_game(games_by_source, games_by_key, int(row["source_id"]), home.id, away.id, starts, venue)
                if game is not None and not full_pass and _is_old_completed(game, now):
                    skipped_old += 1
                elif game is None:
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
                        is_conference_game=_conference_flag(row),
                        source_id=int(row["source_id"]),
                    )
                    _apply_place(game, row)
                    session.add(game)
                    _remember_game(games_by_source, games_by_key, game)
                    games_written += 1
                    if _has_result(status, home_score, away_score):
                        scores_written += 1
                else:
                    schedule_changed, score_changed = _reindex_game(
                        games_by_source,
                        games_by_key,
                        game,
                        home.id,
                        away.id,
                        starts,
                        row,
                        status,
                        home_score,
                        away_score,
                    )
                    if schedule_changed:
                        games_written += 1
                    if score_changed:
                        scores_written += 1
            if examined % 5000 == 0:
                print(
                    f"Games progress examined={examined} written={games_written} skipped={skipped_old} old completed games",
                    flush=True,
                )
        session.commit()
    print(
        f"Games finished examined={examined} written={games_written} skipped={skipped_old} old completed games",
        flush=True,
    )

    if refresh_standings:
        with Session(engine) as session:
            for tier in ("ECNL", "ECNL-RL"):
                print(f"Standings started {tier}", flush=True)
                replace_ecnl_standings(session, tier)
                print(f"Standings finished {tier}", flush=True)
    return RefreshCounts(teams=teams_written, games=games_written, scores=scores_written)
