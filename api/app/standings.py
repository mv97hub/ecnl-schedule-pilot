"""Conference tables, both the official snapshot and the one played games imply."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session, selectinload

from app.ingestion.normalizer import standardize_team_name
from app.models import ConferenceStanding, ScheduleGame, ScheduleTeam

AGE_GROUPS = ("U13", "U14", "U15", "U16", "U17", "U18/19")
TIERS = ("ECNL", "ECNL-RL")

_AGE_ALIASES = {
    "U13": "U13",
    "B2013": "U13",
    "U14": "U14",
    "B2012": "U14",
    "U15": "U15",
    "B2011": "U15",
    "U16": "U16",
    "B2010": "U16",
    "B2010-11": "U16",
    "U17": "U17",
    "B2009": "U17",
    "U18": "U18/19",
    "U19": "U18/19",
    "U18/19": "U18/19",
    "B2008": "U18/19",
    "B2008/07": "U18/19",
    "B2007": "U18/19",
}
_NAME_ALIASES = {
    "sporting jax": "sporting sa jax",
    "sporting jacksonville": "sporting sa jax",
    "concorde fire": "concorde fire premier",
    "nasa tophat": "nth nasa",
    "tophat": "nth nasa",
    "florida premier": "florida premier fc",
    "fort lauderdale united": "fort lauderdale united fc",
}

def short_conference(name: str) -> str:
    text = " ".join((name or "").split())
    text = re.sub(r"^ECNL(?:\s+RL)?\s+Boys\s+", "", text, flags=re.IGNORECASE)
    return re.sub(r"\s+20\d{2}-\d{2}$", "", text).strip()


def normalize_age_group(value: str) -> str:
    text = " ".join((value or "").split())
    head = text.split("/")[0].strip()
    if head in AGE_GROUPS:
        return head
    compact = text.upper().replace(" ", "")
    if compact in _AGE_ALIASES:
        return _AGE_ALIASES[compact]
    slash = compact.split("/")[-1]
    if slash in _AGE_ALIASES:
        return _AGE_ALIASES[slash]
    raise ValueError("age_group must be U13, U14, U15, U16, U17, or U18/19")


def normalize_tier(value: str) -> str:
    compact = "".join((value or "").split()).upper().replace("_", "-")
    if compact in {"ECNL", "ECNLBOYS"}:
        return "ECNL"
    if compact in {"ECNL-RL", "ECNLRL", "RL"}:
        return "ECNL-RL"
    raise ValueError("tier must be ECNL or ECNL-RL")


def _canonical_name(name: str) -> str:
    standard = standardize_team_name(name).casefold()
    return _NAME_ALIASES.get(standard, standard)


def link_team_id(
    teams: list[ScheduleTeam],
    team_name: str,
    age_group: str,
    conference: str,
    tier: str | None = None,
) -> int | None:
    target = _canonical_name(team_name)
    short = short_conference(conference).casefold()
    matches = [
        team
        for team in teams
        if team.age_group == age_group and _canonical_name(team.name) == target and (tier is None or team.tier == tier)
    ]
    if not matches:
        return None
    preferred = [team for team in matches if short_conference(team.conference).casefold() == short]
    if preferred:
        return preferred[0].id
    if len(matches) == 1:
        return matches[0].id
    return None


def _ppg(points: int, games_played: int) -> float:
    if games_played <= 0:
        return 0.0
    return float((Decimal(points) / Decimal(games_played)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _row_from_parts(
    *,
    conference: str,
    tier: str,
    age_group: str,
    team_id: int | None,
    team_name: str,
    games_played: int,
    wins: int,
    losses: int,
    draws: int,
    goals_for: int,
    goals_against: int,
    goal_diff: int | None = None,
    points: int | None = None,
    points_per_game: float | None = None,
) -> dict[str, object]:
    played = max(games_played, 0)
    earned = wins * 3 + draws if points is None else points
    difference = goals_for - goals_against if goal_diff is None else goal_diff
    return {
        "conference": short_conference(conference),
        "tier": tier,
        "age_group": age_group,
        "team_id": team_id,
        "team_name": " ".join(team_name.split())[:160],
        "games_played": played,
        "wins": wins,
        "losses": losses,
        "draws": draws,
        "goals_for": goals_for,
        "goals_against": goals_against,
        "goal_diff": difference,
        "points": earned,
        "points_per_game": _ppg(earned, played) if points_per_game is None else round(float(points_per_game), 2),
        "updated_at": datetime.now(UTC),
    }


def sort_standings(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    return sorted(
        rows,
        key=lambda row: (
            -float(row["points_per_game"]),
            -int(row["goal_diff"]),
            -int(row["goals_for"]),
            str(row["team_name"]).casefold(),
        ),
    )


def ecnl_standings(
    session: Session,
    conference: str | None = None,
    age_group: str | None = None,
    tier: str = "ECNL",
) -> list[dict[str, object]]:
    """Aggregate completed conference games. Teams with no results stay on the table at 0."""

    teams = list(session.scalars(select(ScheduleTeam)).all())
    wanted = short_conference(conference).casefold() if conference else None
    stats: dict[int, dict[str, object]] = {}
    for team in teams:
        if team.id is None:
            continue
        if age_group is not None and team.age_group != age_group:
            continue
        if team.tier != tier:
            continue
        if wanted is not None and short_conference(team.conference).casefold() != wanted:
            continue
        stats[team.id] = _row_from_parts(
            conference=short_conference(team.conference),
            tier=tier,
            age_group=team.age_group,
            team_id=team.id,
            team_name=team.name,
            games_played=0,
            wins=0,
            losses=0,
            draws=0,
            goals_for=0,
            goals_against=0,
        )

    if not stats:
        return []

    games = session.scalars(
        select(ScheduleGame)
        .options(selectinload(ScheduleGame.home_team), selectinload(ScheduleGame.away_team))
        .where(
            ScheduleGame.status == "COMPLETED",
            ScheduleGame.is_conference_game.is_(True),
            ScheduleGame.home_score.is_not(None),
            ScheduleGame.away_score.is_not(None),
            or_(ScheduleGame.home_team_id.in_(list(stats)), ScheduleGame.away_team_id.in_(list(stats))),
        )
    ).all()
    for game in games:
        _apply_result(stats, game.home_team_id, game.home_score or 0, game.away_score or 0)
        _apply_result(stats, game.away_team_id, game.away_score or 0, game.home_score or 0)
    return list(stats.values())


def _apply_result(stats: dict[int, dict[str, object]], team_id: int, goals_for: int, goals_against: int) -> None:
    row = stats.get(team_id)
    if row is None:
        return
    row["games_played"] = int(row["games_played"]) + 1
    row["goals_for"] = int(row["goals_for"]) + goals_for
    row["goals_against"] = int(row["goals_against"]) + goals_against
    if goals_for > goals_against:
        row["wins"] = int(row["wins"]) + 1
    elif goals_for < goals_against:
        row["losses"] = int(row["losses"]) + 1
    else:
        row["draws"] = int(row["draws"]) + 1
    row["goal_diff"] = int(row["goals_for"]) - int(row["goals_against"])
    row["points"] = int(row["wins"]) * 3 + int(row["draws"])
    row["points_per_game"] = _ppg(int(row["points"]), int(row["games_played"]))


def upsert_standings(session: Session, rows: list[dict[str, object]]) -> int:
    if not rows:
        return 0
    teams = list(session.scalars(select(ScheduleTeam)).all())
    prepared_by_key: dict[tuple[str, str, str, str], dict[str, object]] = {}
    for row in rows:
        team_name = " ".join(str(row["team_name"]).split())[:160]
        age_group = str(row["age_group"])
        conference = str(row["conference"])
        linked = row.get("team_id")
        if linked is None:
            linked = link_team_id(teams, team_name, age_group, conference, tier=str(row["tier"]))
        item = {**row, "team_id": linked, "team_name": team_name}
        key = (conference, str(row["tier"]), age_group, team_name)
        previous = prepared_by_key.get(key)
        if previous is not None and previous.get("team_id") != linked:
            item["team_name"] = f"{team_name} #{linked}"[:160]
            key = (conference, str(row["tier"]), age_group, str(item["team_name"]))
        prepared_by_key[key] = item
    prepared = list(prepared_by_key.values())

    statement = pg_insert(ConferenceStanding.__table__).values(prepared)
    excluded = statement.excluded
    session.execute(
        statement.on_conflict_do_update(
            index_elements=["conference", "tier", "age_group", "team_name"],
            set_={
                "team_id": excluded.team_id,
                "games_played": excluded.games_played,
                "wins": excluded.wins,
                "losses": excluded.losses,
                "draws": excluded.draws,
                "goals_for": excluded.goals_for,
                "goals_against": excluded.goals_against,
                "goal_diff": excluded.goal_diff,
                "points": excluded.points,
                "points_per_game": excluded.points_per_game,
                "updated_at": excluded.updated_at,
            },
        )
    )
    session.commit()
    return len(prepared)


def replace_ecnl_standings(session: Session, tier: str = "ECNL") -> int:
    rows = ecnl_standings(session, tier=tier)
    session.execute(delete(ConferenceStanding).where(ConferenceStanding.tier == tier))
    session.commit()
    return upsert_standings(session, rows)


def _result_mark(goals_for: int, goals_against: int) -> str:
    if goals_for > goals_against:
        return "W"
    if goals_for < goals_against:
        return "L"
    return "D"


def recent_form(session: Session, conference: str, tier: str, age_group: str) -> dict[int, list[str]]:
    """Last five completed conference results, oldest first, for each squad in the table."""

    short = short_conference(conference).casefold()
    teams = [
        team
        for team in session.scalars(select(ScheduleTeam).where(ScheduleTeam.tier == tier, ScheduleTeam.age_group == age_group)).all()
        if team.id is not None and short_conference(team.conference).casefold() == short
    ]
    ids = [int(team.id) for team in teams]
    if not ids:
        return {}
    games = session.scalars(
        select(ScheduleGame)
        .where(
            ScheduleGame.status == "COMPLETED",
            ScheduleGame.is_conference_game.is_(True),
            ScheduleGame.home_score.is_not(None),
            ScheduleGame.away_score.is_not(None),
            or_(ScheduleGame.home_team_id.in_(ids), ScheduleGame.away_team_id.in_(ids)),
        )
        .order_by(ScheduleGame.starts_at, ScheduleGame.id)
    ).all()
    marks: dict[int, list[str]] = {team_id: [] for team_id in ids}
    known = set(ids)
    for game in games:
        home_score = game.home_score
        away_score = game.away_score
        if home_score is None or away_score is None:
            continue
        if game.home_team_id in known:
            marks[game.home_team_id].append(_result_mark(home_score, away_score))
        if game.away_team_id in known:
            marks[game.away_team_id].append(_result_mark(away_score, home_score))
    return {team_id: results[-5:] for team_id, results in marks.items()}


def conference_rank(session: Session, team: ScheduleTeam) -> int | None:
    if team.id is None:
        return None
    short = short_conference(team.conference)
    peers = list(
        session.scalars(
            select(ConferenceStanding).where(
                func.lower(ConferenceStanding.conference) == short.casefold(),
                ConferenceStanding.tier == team.tier,
                ConferenceStanding.age_group == team.age_group,
            )
        ).all()
    )
    if not peers:
        return None
    ordered = sort_standings(
        [
            {
                "team_id": peer.team_id,
                "team_name": peer.team_name,
                "points_per_game": peer.points_per_game,
                "goal_diff": peer.goal_diff,
                "goals_for": peer.goals_for,
            }
            for peer in peers
        ]
    )
    for index, row in enumerate(ordered, start=1):
        if row["team_id"] == team.id or _canonical_name(str(row["team_name"])) == _canonical_name(team.name):
            return index
    return None
