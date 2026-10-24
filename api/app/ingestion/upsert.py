"""Insert imported games with PostgreSQL ON CONFLICT (match_key) DO UPDATE."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, time

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.ingestion.normalizer import build_match_key, standardize_team_name
from app.models import Game, Team


@dataclass(frozen=True)
class ParsedScore:
    game_date: date
    home_name: str
    away_name: str
    home_score: int
    away_score: int
    age_group: str
    tier: str | None = None
    status: str = "COMPLETED"


@dataclass(frozen=True)
class ParsedGame:
    game_date: date
    kickoff_time: time | None
    home_name: str
    away_name: str
    complex_name: str
    field_number: str
    city_state: str
    is_showcase: bool
    age_group: str
    tier: str | None = None


@dataclass(frozen=True)
class SavedGame:
    id: int
    match_key: str
    date: date
    kickoff_time: time | None
    home_team: str
    away_team: str
    complex_name: str
    field_number: str
    city_state: str
    is_showcase: bool


@dataclass(frozen=True)
class UpsertResult:
    inserted: int
    updated: int
    games: list[SavedGame]

    @property
    def upserted(self) -> int:
        return self.inserted + self.updated


def _team(
    session: Session,
    cache: dict[tuple[str, str], Team],
    name: str,
    age_group: str,
    tier: str | None,
    home_complex: str | None,
) -> Team:
    key = (name, age_group)
    team = cache.get(key)
    if team is None:
        team = session.scalar(select(Team).where(Team.name == name, Team.age_group == age_group))
        if team is None:
            team = Team(
                name=name,
                age_group=age_group,
                tier=tier or None,
                home_complex=home_complex or None,
            )
            session.add(team)
            session.flush()
        cache[key] = team
    if home_complex and not team.home_complex:
        team.home_complex = home_complex
    if tier and not team.tier:
        team.tier = tier
    return team


def upsert_games(session: Session, games: list[ParsedGame]) -> UpsertResult:
    """Write every parsed game. A repeated match_key updates time, field, and venue."""

    cache: dict[tuple[str, str], Team] = {}
    staged: dict[str, dict[str, object]] = {}
    for game in games:
        home_name = standardize_team_name(game.home_name)[:160]
        away_name = standardize_team_name(game.away_name)[:160]
        if not home_name or not away_name or home_name.casefold() == away_name.casefold():
            continue
        age_group = " ".join((game.age_group or "Unknown").split())[:16] or "Unknown"
        tier = " ".join((game.tier or "").split())[:40] or None
        complex_name = " ".join(game.complex_name.split())[:200]
        field_number = " ".join(game.field_number.split())[:40]
        city_state = " ".join(game.city_state.split())[:120]
        home = _team(session, cache, home_name, age_group, tier, complex_name or None)
        away = _team(session, cache, away_name, age_group, tier, None)
        match_key = build_match_key(game.game_date, home_name, away_name, age_group)
        staged[match_key] = {
            "match_key": match_key,
            "date": game.game_date,
            "kickoff_time": game.kickoff_time,
            "home_team_id": home.id,
            "away_team_id": away.id,
            "complex_name": complex_name,
            "field_number": field_number,
            "city_state": city_state,
            "is_showcase": game.is_showcase,
            "status": "SCHEDULED",
            "home_score": None,
            "away_score": None,
            "is_conference_game": not game.is_showcase,
        }

    if not staged:
        return UpsertResult(inserted=0, updated=0, games=[])

    keys = list(staged)
    existing = set(session.scalars(select(Game.match_key).where(Game.match_key.in_(keys))).all())
    statement = pg_insert(Game.__table__).values(list(staged.values()))
    excluded = statement.excluded
    session.execute(
        statement.on_conflict_do_update(
            index_elements=["match_key"],
            set_={
                "date": excluded["date"],
                "kickoff_time": excluded.kickoff_time,
                "home_team_id": excluded.home_team_id,
                "away_team_id": excluded.away_team_id,
                "complex_name": excluded.complex_name,
                "field_number": excluded.field_number,
                "city_state": excluded.city_state,
                "is_showcase": excluded.is_showcase,
                "is_conference_game": excluded.is_conference_game,
            },
        )
    )
    session.commit()

    rows = session.scalars(select(Game).where(Game.match_key.in_(keys)).order_by(Game.date, Game.kickoff_time, Game.id)).all()
    team_ids = {row.home_team_id for row in rows} | {row.away_team_id for row in rows}
    teams = {team.id: team.name for team in session.scalars(select(Team).where(Team.id.in_(team_ids))).all() if team.id is not None}
    saved = [
        SavedGame(
            id=row.id or 0,
            match_key=row.match_key,
            date=row.date,
            kickoff_time=row.kickoff_time,
            home_team=teams.get(row.home_team_id, ""),
            away_team=teams.get(row.away_team_id, ""),
            complex_name=row.complex_name,
            field_number=row.field_number,
            city_state=row.city_state,
            is_showcase=row.is_showcase,
        )
        for row in rows
    ]
    updated = sum(1 for key in keys if key in existing)
    return UpsertResult(inserted=len(keys) - updated, updated=updated, games=saved)


@dataclass(frozen=True)
class SavedScore:
    id: int
    match_key: str
    date: date
    home_team: str
    away_team: str
    home_score: int
    away_score: int
    status: str


def upsert_scores(session: Session, scores: list[ParsedScore]) -> tuple[int, int, list[SavedScore]]:
    """Insert or update a final score. A schedule re-import does not clear these columns."""

    cache: dict[tuple[str, str], Team] = {}
    staged: dict[str, dict[str, object]] = {}
    for score in scores:
        home_name = standardize_team_name(score.home_name)[:160]
        away_name = standardize_team_name(score.away_name)[:160]
        if not home_name or not away_name or home_name.casefold() == away_name.casefold():
            continue
        age_group = " ".join((score.age_group or "Unknown").split())[:16] or "Unknown"
        tier = " ".join((score.tier or "").split())[:40] or None
        home = _team(session, cache, home_name, age_group, tier, None)
        away = _team(session, cache, away_name, age_group, tier, None)
        match_key = build_match_key(score.game_date, home_name, away_name, age_group)
        staged[match_key] = {
            "match_key": match_key,
            "date": score.game_date,
            "kickoff_time": None,
            "home_team_id": home.id,
            "away_team_id": away.id,
            "complex_name": "",
            "field_number": "",
            "city_state": "",
            "is_showcase": False,
            "status": score.status if score.status in {"COMPLETED", "POSTPONED", "CANCELLED"} else "COMPLETED",
            "home_score": score.home_score,
            "away_score": score.away_score,
            "is_conference_game": True,
        }

    if not staged:
        return 0, 0, []

    keys = list(staged)
    existing = set(session.scalars(select(Game.match_key).where(Game.match_key.in_(keys))).all())
    statement = pg_insert(Game.__table__).values(list(staged.values()))
    excluded = statement.excluded
    session.execute(
        statement.on_conflict_do_update(
            index_elements=["match_key"],
            set_={
                "date": excluded["date"],
                "home_team_id": excluded.home_team_id,
                "away_team_id": excluded.away_team_id,
                "status": excluded.status,
                "home_score": excluded.home_score,
                "away_score": excluded.away_score,
            },
        )
    )
    session.commit()

    rows = session.scalars(select(Game).where(Game.match_key.in_(keys)).order_by(Game.date, Game.id)).all()
    team_ids = {row.home_team_id for row in rows} | {row.away_team_id for row in rows}
    teams = {
        team.id: team.name
        for team in session.scalars(select(Team).where(Team.id.in_(team_ids))).all()
        if team.id is not None
    }
    saved = [
        SavedScore(
            id=row.id or 0,
            match_key=row.match_key,
            date=row.date,
            home_team=teams.get(row.home_team_id, ""),
            away_team=teams.get(row.away_team_id, ""),
            home_score=row.home_score or 0,
            away_score=row.away_score or 0,
            status=row.status,
        )
        for row in rows
    ]
    updated = sum(1 for key in keys if key in existing)
    return len(keys) - updated, updated, saved
