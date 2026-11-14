"""Trailing-dash squads collapse on refresh, then standings are rebuilt from games."""

from __future__ import annotations

import io
import sys
import unittest
from contextlib import redirect_stdout
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.database import engine
from app.models import ConferenceStanding, Player, ScheduleGame, ScheduleTeam
from app.refresh import ensure_refresh_tables, upsert_published
from app.standings import ecnl_standings
from app.team_repair import merge_trailing_dash_teams

PLAIN = 910000951
KEEPER = 910000952
RIVAL = 910000953
WEST = 910000954
GIRL = 910000955
NORTH_PLAIN = 910000956
NORTH_KEEPER = 910000957
NORTH_RIVAL = 910000958
METRO = 910000959
METRO_PLAIN = 910000966
PLAYER = 910000960
GAME_KEEP = 910000961
GAME_DUP = 910000962
GAME_MOVE = 910000963
GAME_NORTH_KEEP = 910000964
GAME_NORTH_DUP = 910000965


def _cleanup() -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                DELETE FROM game
                WHERE source_id BETWEEN :first_game AND :last_game
                   OR home_team_id IN (
                        SELECT id FROM team
                        WHERE name LIKE 'Probe Dash %' OR source_id BETWEEN :first_team AND :last_team
                   )
                   OR away_team_id IN (
                        SELECT id FROM team
                        WHERE name LIKE 'Probe Dash %' OR source_id BETWEEN :first_team AND :last_team
                   )
                """
            ),
            {"first_game": GAME_KEEP, "last_game": GAME_NORTH_DUP, "first_team": PLAIN, "last_team": METRO_PLAIN},
        )
        connection.execute(text("DELETE FROM player WHERE source_id = :player"), {"player": PLAYER})
        connection.execute(
            text(
                """
                DELETE FROM conference_standing
                WHERE conference LIKE 'Probe Dash %' OR team_name LIKE 'Probe Dash %'
                """
            )
        )
        connection.execute(
            text(
                """
                DELETE FROM team
                WHERE name LIKE 'Probe Dash %' OR source_id BETWEEN :first_team AND :last_team
                """
            ),
            {"first_team": PLAIN, "last_team": METRO_PLAIN},
        )


def _team(
    session: Session,
    source_id: int,
    name: str,
    *,
    age_group: str = "U13",
    conference: str = "Probe Dash Conf",
    gender: str = "boys",
) -> ScheduleTeam:
    team = ScheduleTeam(
        name=name,
        age_group=age_group,
        tier="ECNL",
        conference=conference,
        city="Jacksonville",
        state="FL",
        gender=gender,
        source_id=source_id,
    )
    session.add(team)
    session.flush()
    return team


def _game(
    session: Session,
    home: ScheduleTeam,
    away: ScheduleTeam,
    source_id: int,
    kickoff: datetime,
    home_score: int,
    away_score: int,
) -> None:
    session.add(
        ScheduleGame(
            home_team_id=home.id,
            away_team_id=away.id,
            starts_at=kickoff,
            venue_name="Probe Dash Park",
            city="Jacksonville",
            state="FL",
            timezone="America/New_York",
            event=None,
            status="COMPLETED",
            home_score=home_score,
            away_score=away_score,
            is_conference_game=True,
            source_id=source_id,
        )
    )


class TrailingDashRepairTests(unittest.TestCase):
    def setUp(self) -> None:
        ensure_refresh_tables()
        _cleanup()

    def tearDown(self) -> None:
        _cleanup()

    def test_plain_twin_moves_onto_the_published_dash_and_duplicate_games_drop(self) -> None:
        shared = datetime(2026, 8, 30, 18, 0, tzinfo=UTC)
        later = datetime(2026, 9, 12, 18, 0, tzinfo=UTC)
        with Session(engine) as session:
            plain = _team(session, PLAIN, "Probe Dash Club")
            keeper = _team(session, KEEPER, "Probe Dash Club -")
            rival = _team(session, RIVAL, "Probe Dash Rival")
            _team(session, WEST, "Probe Dash Club", conference="Probe Dash West")
            _team(session, GIRL, "Probe Dash Club", gender="girls")
            north_plain = _team(session, NORTH_PLAIN, "Probe Dash North", age_group="U14")
            north_keeper = _team(session, NORTH_KEEPER, "Probe Dash North -", age_group="U14")
            north_rival = _team(session, NORTH_RIVAL, "Probe Dash South", age_group="U14")
            _team(session, METRO, "Probe Dash Metro - City")
            _team(session, METRO_PLAIN, "Probe Dash Metro")
            _game(session, rival, keeper, GAME_KEEP, shared, 1, 0)
            _game(session, rival, plain, GAME_DUP, shared, 1, 0)
            _game(session, plain, rival, GAME_MOVE, later, 3, 1)
            _game(session, north_keeper, north_rival, GAME_NORTH_KEEP, shared, 2, 0)
            _game(session, north_plain, north_rival, GAME_NORTH_DUP, shared, 2, 0)
            session.add(
                ConferenceStanding(
                    conference="Probe Dash Conf",
                    tier="ECNL",
                    gender="boys",
                    age_group="U13",
                    team_id=plain.id,
                    team_name="Probe Dash Club",
                )
            )
            session.add(Player(source_id=PLAYER, first_name="Probe", last_name="Dash", team_id=plain.id))
            plain_id = int(plain.id)
            keeper_id = int(keeper.id)
            session.commit()

        with Session(engine) as session:
            merged = merge_trailing_dash_teams(session)
            session.commit()

        by_dropped = {item.dropped_name: item for item in merged}
        self.assertEqual(set(by_dropped), {"Probe Dash Club", "Probe Dash North"})
        self.assertEqual(by_dropped["Probe Dash Club"].kept_id, keeper_id)
        self.assertEqual(by_dropped["Probe Dash Club"].kept_name, "Probe Dash Club -")
        self.assertEqual(by_dropped["Probe Dash Club"].dropped_id, plain_id)
        self.assertEqual(by_dropped["Probe Dash Club"].games_removed, 1)
        self.assertEqual(by_dropped["Probe Dash North"].kept_name, "Probe Dash North -")
        self.assertEqual(by_dropped["Probe Dash North"].games_removed, 1)

        with Session(engine) as session:
            self.assertIsNone(session.get(ScheduleTeam, plain_id))
            kept = session.get(ScheduleTeam, keeper_id)
            self.assertIsNotNone(kept)
            assert kept is not None
            self.assertEqual(kept.name, "Probe Dash Club -")
            self.assertEqual(
                session.scalar(select(ScheduleTeam.name).where(ScheduleTeam.source_id == WEST)),
                "Probe Dash Club",
            )
            self.assertEqual(
                session.scalar(select(ScheduleTeam.name).where(ScheduleTeam.source_id == GIRL)),
                "Probe Dash Club",
            )
            self.assertEqual(
                set(
                    session.scalars(
                        select(ScheduleTeam.name).where(ScheduleTeam.source_id.in_([METRO, METRO_PLAIN]))
                    ).all()
                ),
                {"Probe Dash Metro - City", "Probe Dash Metro"},
            )
            sources = set(
                session.scalars(
                    select(ScheduleGame.source_id).where(
                        ScheduleGame.source_id.between(GAME_KEEP, GAME_NORTH_DUP)
                    )
                ).all()
            )
            self.assertEqual(sources, {GAME_KEEP, GAME_MOVE, GAME_NORTH_KEEP})
            moved = session.scalar(select(ScheduleGame).where(ScheduleGame.source_id == GAME_MOVE))
            self.assertIsNotNone(moved)
            assert moved is not None
            self.assertEqual(moved.home_team_id, keeper_id)
            self.assertEqual(
                session.scalar(select(Player.team_id).where(Player.source_id == PLAYER)),
                keeper_id,
            )
            standing = session.scalar(
                select(ConferenceStanding).where(ConferenceStanding.team_name == "Probe Dash Club")
            )
            self.assertIsNotNone(standing)
            assert standing is not None
            self.assertEqual(standing.team_id, keeper_id)

            boys = {row["team_name"]: row for row in ecnl_standings(session, "Probe Dash Conf", "U13", "ECNL", "boys")}
            self.assertNotIn("Probe Dash Club", boys)
            self.assertEqual(boys["Probe Dash Club -"]["games_played"], 2)
            self.assertEqual(boys["Probe Dash Club -"]["wins"], 1)
            self.assertEqual(boys["Probe Dash Club -"]["losses"], 1)
            self.assertEqual(boys["Probe Dash Club -"]["draws"], 0)
            self.assertEqual((boys["Probe Dash Club -"]["goals_for"], boys["Probe Dash Club -"]["goals_against"]), (3, 2))
            self.assertEqual(boys["Probe Dash Rival"]["games_played"], 2)

            older = {row["team_name"]: row for row in ecnl_standings(session, "Probe Dash Conf", "U14", "ECNL", "boys")}
            self.assertNotIn("Probe Dash North", older)
            self.assertEqual(older["Probe Dash North -"]["games_played"], 1)
            self.assertEqual(older["Probe Dash North -"]["wins"], 1)

        with Session(engine) as session:
            self.assertEqual(merge_trailing_dash_teams(session), [])
            session.commit()

    def test_refresh_merges_before_rebuilding_standings(self) -> None:
        order: list[str] = []

        def merge(_session):
            order.append("merge")
            return []

        def replace(_session, tier="ECNL"):
            order.append(tier)
            return 0

        with (
            patch("app.refresh.merge_trailing_dash_teams", side_effect=merge),
            patch("app.refresh.replace_ecnl_standings", side_effect=replace),
            redirect_stdout(io.StringIO()),
        ):
            upsert_published({"teams": [], "games": []}, refresh_standings=True)
        self.assertEqual(order, ["merge", "ECNL", "ECNL-RL"])

        order.clear()
        with (
            patch("app.refresh.merge_trailing_dash_teams", side_effect=merge),
            patch("app.refresh.replace_ecnl_standings", side_effect=replace),
            redirect_stdout(io.StringIO()),
        ):
            upsert_published({"teams": [], "games": []}, refresh_standings=False)
        self.assertEqual(order, [])


if __name__ == "__main__":
    unittest.main()
