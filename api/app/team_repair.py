"""Merge teams that are the same squad stored with and without a trailing dash.

The published name, such as ``Florida Kraze Krush -``, is the one that stays.
Games move onto that team. Rows that then share a match key are removed, and
the extra team is deleted. Standings are rebuilt by the caller.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date
from zoneinfo import ZoneInfo

from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import Session, selectinload

from app.ingestion.normalizer import build_match_key, has_published_trailing_dash, standardize_team_name
from app.models import (
    CoachingStaff,
    ConferenceStanding,
    GameWeather,
    MatchEvent,
    MatchPlayer,
    Player,
    PlayoffPicture,
    ScheduleGame,
    ScheduleTeam,
    ScoutAttendance,
    TeamEvent,
    TeamRating,
)
from app.standings import short_conference

_EASTERN = ZoneInfo("America/New_York")
_TEAM_LINKS = (ConferenceStanding, TeamEvent, CoachingStaff, Player, TeamRating, PlayoffPicture)


@dataclass(frozen=True)
class MergedTeam:
    kept_id: int
    kept_name: str
    dropped_id: int
    dropped_name: str
    conference: str
    age_group: str
    tier: str
    gender: str
    games_removed: int


def _division(team: ScheduleTeam) -> tuple[str, str, str, str]:
    return (
        short_conference(team.conference).casefold(),
        team.tier,
        team.age_group,
        team.gender or "boys",
    )


def _game_day(game: ScheduleGame) -> date:
    starts = game.starts_at
    if starts.tzinfo is None:
        starts = starts.replace(tzinfo=UTC)
    try:
        zone = ZoneInfo(game.timezone or "America/New_York")
    except Exception:
        zone = _EASTERN
    return starts.astimezone(zone).date()


def _match_key(game: ScheduleGame) -> str | None:
    home = game.home_team
    away = game.away_team
    if home is None or away is None or game.id is None:
        return None
    age = home.age_group or away.age_group or "Unknown"
    return build_match_key(_game_day(game), home.name, away.name, age)


def _delete_games(session: Session, game_ids: list[int]) -> None:
    if not game_ids:
        return
    session.execute(delete(MatchPlayer).where(MatchPlayer.game_id.in_(game_ids)))
    session.execute(delete(GameWeather).where(GameWeather.game_id.in_(game_ids)))
    session.execute(delete(MatchEvent).where(MatchEvent.game_id.in_(game_ids)))
    session.execute(
        update(ScoutAttendance)
        .where(ScoutAttendance.game_id.in_(game_ids))
        .values(game_id=None)
        .execution_options(synchronize_session=False)
    )
    session.execute(
        delete(ScheduleGame).where(ScheduleGame.id.in_(game_ids)).execution_options(synchronize_session=False)
    )


def merge_trailing_dash_teams(session: Session) -> list[MergedTeam]:
    """Fold every plain-name twin into the team that already has the published dash.

    A pair shares a division: conference, tier, age group, and gender. The scan
    covers every division. Nothing is committed; the refresh path commits when
    it replaces standings.
    """

    teams = [team for team in session.scalars(select(ScheduleTeam)).all() if team.id is not None]
    grouped: dict[tuple[tuple[str, str, str, str], str], list[ScheduleTeam]] = {}
    for team in teams:
        standard = standardize_team_name(team.name).casefold()
        if not standard:
            continue
        grouped.setdefault((_division(team), standard), []).append(team)

    plans: list[tuple[ScheduleTeam, list[ScheduleTeam]]] = []
    for members in grouped.values():
        dashed = [team for team in members if has_published_trailing_dash(team.name)]
        plain = [team for team in members if not has_published_trailing_dash(team.name)]
        if not dashed or not plain:
            continue
        keeper = min(dashed, key=lambda team: int(team.id))
        plans.append((keeper, plain))
    if not plans:
        return []

    snapshots: list[dict[str, object]] = []
    for keeper, extras in plans:
        for extra in extras:
            snapshots.append(
                {
                    "kept_id": int(keeper.id),
                    "kept_name": keeper.name,
                    "dropped_id": int(extra.id),
                    "dropped_name": extra.name,
                    "conference": short_conference(keeper.conference),
                    "age_group": keeper.age_group,
                    "tier": keeper.tier,
                    "gender": keeper.gender or "boys",
                }
            )

    id_to_keeper = {int(extra.id): int(keeper.id) for keeper, extras in plans for extra in extras}
    extra_ids = list(id_to_keeper)
    keeper_ids = {int(keeper.id) for keeper, _extras in plans}
    extra_game_ids: dict[int, set[int]] = {extra_id: set() for extra_id in extra_ids}
    moved_ids: set[int] = set()
    linked = session.execute(
        select(ScheduleGame.id, ScheduleGame.home_team_id, ScheduleGame.away_team_id).where(
            or_(ScheduleGame.home_team_id.in_(extra_ids), ScheduleGame.away_team_id.in_(extra_ids))
        )
    ).all()
    for game_id, home_id, away_id in linked:
        moved_ids.add(int(game_id))
        if int(home_id) in extra_game_ids:
            extra_game_ids[int(home_id)].add(int(game_id))
        if int(away_id) in extra_game_ids:
            extra_game_ids[int(away_id)].add(int(game_id))

    for extra_id, keeper_id in id_to_keeper.items():
        session.execute(
            update(ScheduleGame)
            .where(ScheduleGame.home_team_id == extra_id)
            .values(home_team_id=keeper_id)
            .execution_options(synchronize_session=False)
        )
        session.execute(
            update(ScheduleGame)
            .where(ScheduleGame.away_team_id == extra_id)
            .values(away_team_id=keeper_id)
            .execution_options(synchronize_session=False)
        )
        for model in _TEAM_LINKS:
            session.execute(
                update(model)
                .where(model.team_id == extra_id)
                .values(team_id=keeper_id)
                .execution_options(synchronize_session=False)
            )
    session.flush()
    session.expire_all()

    drop_ids: set[int] = set()
    if moved_ids:
        same_side = session.scalars(
            select(ScheduleGame.id).where(
                ScheduleGame.id.in_(moved_ids),
                ScheduleGame.home_team_id == ScheduleGame.away_team_id,
            )
        ).all()
        drop_ids.update(int(game_id) for game_id in same_side)

    games = session.scalars(
        select(ScheduleGame)
        .options(selectinload(ScheduleGame.home_team), selectinload(ScheduleGame.away_team))
        .where(or_(ScheduleGame.home_team_id.in_(keeper_ids), ScheduleGame.away_team_id.in_(keeper_ids)))
    ).all()
    buckets: dict[str, list[ScheduleGame]] = {}
    for game in games:
        if game.id is None or int(game.id) in drop_ids:
            continue
        key = _match_key(game)
        if key is None:
            continue
        buckets.setdefault(key, []).append(game)
    for rows in buckets.values():
        if len(rows) < 2:
            continue
        incoming = [game for game in rows if int(game.id) in moved_ids]
        if not incoming:
            continue
        stayed = [game for game in rows if int(game.id) not in moved_ids]
        if stayed:
            drop_ids.update(int(game.id) for game in incoming)
        else:
            ordered = sorted(incoming, key=lambda game: int(game.id))
            drop_ids.update(int(game.id) for game in ordered[1:])

    _delete_games(session, sorted(drop_ids))
    for extra_id in extra_ids:
        session.execute(
            delete(ScheduleTeam).where(ScheduleTeam.id == extra_id).execution_options(synchronize_session=False)
        )
    session.flush()

    return [
        MergedTeam(
            kept_id=int(item["kept_id"]),
            kept_name=str(item["kept_name"]),
            dropped_id=int(item["dropped_id"]),
            dropped_name=str(item["dropped_name"]),
            conference=str(item["conference"]),
            age_group=str(item["age_group"]),
            tier=str(item["tier"]),
            gender=str(item["gender"]),
            games_removed=len(extra_game_ids.get(int(item["dropped_id"]), set()) & drop_ids),
        )
        for item in snapshots
    ]
