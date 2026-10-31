"""Projected conference table from results already stored, plus remaining fixtures.

Completed conference games keep their actual points: win 3, draw 1, loss 0.
Each remaining scheduled conference game adds max(0, 3 − opponent PPG).
Opponent PPG is that opponent's season-to-date points divided by matches
played. An opponent with no completed games has PPG 0, so the fixture is
worth 3.0. Scores come from stored games only.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.logos import club_logos
from app.models import ScheduleGame, ScheduleTeam
from app.standings import short_conference

SEASON = "2026-27"
EASTERN = ZoneInfo("America/New_York")

POINTS_RULE = "Predicted points are current points plus max(0, 3 − opponent PPG) for each remaining game."
RECORD_RULE = (
    "The projected record adds each remaining game to the current W-D-L. "
    "Expected points of at least 2 count as a win, at least 1 and below 2 count as a draw, "
    "and anything lower counts as a loss."
)


def expected_points(opponent_points: int, opponent_matches_played: int) -> Decimal:
    """Points a team is expected to take from one remaining game against this opponent."""

    if opponent_matches_played <= 0:
        opponent_ppg = Decimal(0)
    else:
        opponent_ppg = Decimal(opponent_points) / Decimal(opponent_matches_played)
    return max(Decimal(0), Decimal(3) - opponent_ppg)


def projected_result(expected: Decimal) -> str:
    if expected >= 2:
        return "W"
    if expected >= 1:
        return "D"
    return "L"


def _result_points(goals_for: int, goals_against: int) -> int:
    if goals_for > goals_against:
        return 3
    if goals_for == goals_against:
        return 1
    return 0


def _result_mark(goals_for: int, goals_against: int) -> str:
    if goals_for > goals_against:
        return "W"
    if goals_for < goals_against:
        return "L"
    return "D"


def _as_points(value: Decimal) -> float:
    return float(value.quantize(Decimal("0.01")))


def _month_day(starts_at: datetime) -> str:
    moment = starts_at if starts_at.tzinfo is not None else starts_at.replace(tzinfo=UTC)
    local = moment.astimezone(EASTERN)
    return f"{local.month}/{local.day}"


def _empty_tally() -> dict[str, int]:
    return {
        "games_played": 0,
        "wins": 0,
        "draws": 0,
        "losses": 0,
        "goals_for": 0,
        "goals_against": 0,
        "points": 0,
    }


def _apply_actual(tally: dict[str, int], goals_for: int, goals_against: int) -> None:
    tally["games_played"] += 1
    tally["goals_for"] += goals_for
    tally["goals_against"] += goals_against
    if goals_for > goals_against:
        tally["wins"] += 1
    elif goals_for < goals_against:
        tally["losses"] += 1
    else:
        tally["draws"] += 1
    tally["points"] += _result_points(goals_for, goals_against)


def predicted_table(
    session: Session,
    conference: str,
    tier: str,
    age_group: str,
    gender: str,
) -> dict[str, object]:
    """One projected table for the requested gender, tier, age group, and conference."""

    short = short_conference(conference).casefold()
    teams = [
        team
        for team in session.scalars(
            select(ScheduleTeam).where(
                ScheduleTeam.tier == tier,
                ScheduleTeam.age_group == age_group,
                ScheduleTeam.gender == gender,
            )
        ).all()
        if team.id is not None and short_conference(team.conference).casefold() == short and (team.gender or "boys") == gender
    ]
    logos = club_logos(session, teams)
    base = {
        "season": SEASON,
        "gender": gender,
        "tier": tier,
        "age_group": age_group,
        "conference": short_conference(conference),
        "points_rule": POINTS_RULE,
        "record_rule": RECORD_RULE,
        "rows": [],
    }
    if not teams:
        return base

    ids = [int(team.id) for team in teams]
    games = session.scalars(
        select(ScheduleGame)
        .where(
            ScheduleGame.is_conference_game.is_(True),
            ScheduleGame.home_team_id.in_(ids),
            ScheduleGame.away_team_id.in_(ids),
            ScheduleGame.status.in_(("COMPLETED", "SCHEDULED")),
        )
        .order_by(ScheduleGame.starts_at, ScheduleGame.id)
    ).all()

    tallies = {team_id: _empty_tally() for team_id in ids}
    fixtures: dict[tuple[int, int], list[dict[str, object]]] = {}
    completed: list[ScheduleGame] = []
    scheduled: list[ScheduleGame] = []
    for game in games:
        if game.home_team_id == game.away_team_id:
            continue
        if game.status == "COMPLETED" and game.home_score is not None and game.away_score is not None:
            completed.append(game)
        elif game.status == "SCHEDULED":
            scheduled.append(game)

    for game in completed:
        home_score = int(game.home_score or 0)
        away_score = int(game.away_score or 0)
        _apply_actual(tallies[game.home_team_id], home_score, away_score)
        _apply_actual(tallies[game.away_team_id], away_score, home_score)
        _add_fixture(
            fixtures,
            game,
            team_id=game.home_team_id,
            opponent_id=game.away_team_id,
            goals_for=home_score,
            goals_against=away_score,
            status="completed",
            expected=None,
        )
        _add_fixture(
            fixtures,
            game,
            team_id=game.away_team_id,
            opponent_id=game.home_team_id,
            goals_for=away_score,
            goals_against=home_score,
            status="completed",
            expected=None,
        )

    extras: dict[int, Decimal] = {team_id: Decimal(0) for team_id in ids}
    added = {team_id: {"W": 0, "D": 0, "L": 0, "remaining": 0} for team_id in ids}
    for game in scheduled:
        for team_id, opponent_id in (
            (game.home_team_id, game.away_team_id),
            (game.away_team_id, game.home_team_id),
        ):
            opponent = tallies[opponent_id]
            expected = expected_points(opponent["points"], opponent["games_played"])
            mark = projected_result(expected)
            extras[team_id] += expected
            added[team_id][mark] += 1
            added[team_id]["remaining"] += 1
            _add_fixture(
                fixtures,
                game,
                team_id=team_id,
                opponent_id=opponent_id,
                goals_for=None,
                goals_against=None,
                status="scheduled",
                expected=expected,
            )

    built: list[dict[str, object]] = []
    for team in teams:
        team_id = int(team.id)
        tally = tallies[team_id]
        bump = added[team_id]
        predicted = Decimal(tally["points"]) + extras[team_id]
        built.append(
            {
                "team_id": team_id,
                "team_name": team.name,
                "logo_url": logos.get(team_id),
                "games_played": tally["games_played"],
                "wins": tally["wins"],
                "draws": tally["draws"],
                "losses": tally["losses"],
                "goals_for": tally["goals_for"],
                "goals_against": tally["goals_against"],
                "goal_diff": tally["goals_for"] - tally["goals_against"],
                "points": tally["points"],
                "remaining": bump["remaining"],
                "predicted_points": predicted,
                "projected_wins": tally["wins"] + bump["W"],
                "projected_draws": tally["draws"] + bump["D"],
                "projected_losses": tally["losses"] + bump["L"],
            }
        )

    built.sort(
        key=lambda row: (
            -Decimal(row["predicted_points"]),
            -int(row["points"]),
            -int(row["goal_diff"]),
            -int(row["goals_for"]),
            str(row["team_name"]).casefold(),
        )
    )
    order = [int(row["team_id"]) for row in built]
    rows: list[dict[str, object]] = []
    for index, row in enumerate(built, start=1):
        team_id = int(row["team_id"])
        cells = []
        for opponent_id in order:
            pair = sorted(fixtures.get((team_id, opponent_id), []), key=lambda item: item["order"])
            cells.append(
                {
                    "opponent_id": opponent_id,
                    "fixtures": [{key: value for key, value in item.items() if key != "order"} for item in pair],
                }
            )
        rows.append(
            {
                **row,
                "rank": index,
                "predicted_points": _as_points(Decimal(row["predicted_points"])),
                "cells": cells,
            }
        )
    return {**base, "rows": rows}


def _add_fixture(
    fixtures: dict[tuple[int, int], list[dict[str, object]]],
    game: ScheduleGame,
    *,
    team_id: int,
    opponent_id: int,
    goals_for: int | None,
    goals_against: int | None,
    status: str,
    expected: Decimal | None,
) -> None:
    side = "home" if game.home_team_id == team_id else "away"
    item: dict[str, object] = {
        "order": (game.starts_at, int(game.id), side),
        "game_id": int(game.id),
        "side": side,
        "starts_on": _month_day(game.starts_at),
        "status": status,
        "score": None if goals_for is None or goals_against is None else f"{goals_for}-{goals_against}",
        "result": None if goals_for is None or goals_against is None else _result_mark(goals_for, goals_against),
        "expected_points": None if expected is None else _as_points(expected),
    }
    fixtures.setdefault((team_id, opponent_id), []).append(item)
