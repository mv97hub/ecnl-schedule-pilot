"""Predicted standings: expected points, actual results, and the girls filter."""

from __future__ import annotations

import sys
import unittest
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.database import engine
from app.main import app
from app.models import Base, Club, ScheduleGame, ScheduleTeam
from app.predictions import POINTS_RULE, expected_points, projected_result

EASTERN = ZoneInfo("America/New_York")
CONFERENCE = "Probe Predicted East"
ALPHA = 910001401
HEAVY = 910001402
SPARE = 910001403
FRESH = 910001404
GAMMA = 910001405
CLUB = 910001390
SOURCES = (ALPHA, HEAVY, SPARE, FRESH, GAMMA)


def _team(source_id: int, name: str, gender: str, club_id: int | None = None) -> ScheduleTeam:
    return ScheduleTeam(
        name=name,
        age_group="U16",
        tier="ECNL",
        conference=CONFERENCE,
        city="Jacksonville",
        state="FL",
        gender=gender,
        source_id=source_id,
        club_id=club_id,
    )


def _game(
    source_id: int,
    home_id: int,
    away_id: int,
    *,
    status: str,
    when: datetime,
    home_score: int | None = None,
    away_score: int | None = None,
    conference: bool = True,
) -> ScheduleGame:
    return ScheduleGame(
        source_id=source_id,
        home_team_id=home_id,
        away_team_id=away_id,
        starts_at=when,
        venue_name="Probe Park",
        city="Jacksonville",
        state="FL",
        timezone="America/New_York",
        status=status,
        home_score=home_score,
        away_score=away_score,
        is_conference_game=conference,
    )


class ExpectedPointsTests(unittest.TestCase):
    def test_opponent_ppg_of_2_6_is_worth_0_4(self) -> None:
        self.assertEqual(expected_points(13, 5), Decimal("0.4"))

    def test_opponent_with_no_completed_games_is_worth_3(self) -> None:
        self.assertEqual(expected_points(0, 0), Decimal("3"))
        self.assertEqual(float(expected_points(0, 0)), 3.0)

    def test_projected_result_bands(self) -> None:
        self.assertEqual(projected_result(Decimal("3")), "W")
        self.assertEqual(projected_result(Decimal("2")), "W")
        self.assertEqual(projected_result(Decimal("1.5")), "D")
        self.assertEqual(projected_result(Decimal("1")), "D")
        self.assertEqual(projected_result(Decimal("0.4")), "L")


class PredictedStandingsApiTests(unittest.TestCase):
    def setUp(self) -> None:
        Base.metadata.create_all(engine)
        self._cleanup()
        kickoff = datetime(2026, 9, 1, 18, 0, tzinfo=EASTERN)
        with Session(engine) as session:
            session.add(Club(id=CLUB, name="Probe Pred FC", logo_url="https://example.com/probe-pred.png"))
            session.add_all(
                (
                    _team(ALPHA, "ProbePredAlpha", "boys", CLUB),
                    _team(HEAVY, "ProbePredHeavy", "boys"),
                    _team(SPARE, "ProbePredSpare", "boys"),
                    _team(FRESH, "ProbePredFresh", "boys"),
                    _team(GAMMA, "ProbePredGamma", "girls"),
                )
            )
            session.flush()
            ids = {team.source_id: int(team.id) for team in session.scalars(select(ScheduleTeam).where(ScheduleTeam.source_id.in_(SOURCES)))}
            alpha, heavy, spare, fresh = ids[ALPHA], ids[HEAVY], ids[SPARE], ids[FRESH]
            games = [
                _game(910001411, alpha, spare, status="COMPLETED", when=kickoff, home_score=2, away_score=0),
                _game(910001419, alpha, spare, status="COMPLETED", when=kickoff, home_score=5, away_score=0, conference=False),
                _game(910001421, alpha, heavy, status="SCHEDULED", when=datetime(2026, 10, 18, 18, 0, tzinfo=EASTERN)),
                _game(910001422, alpha, fresh, status="SCHEDULED", when=datetime(2026, 10, 25, 18, 0, tzinfo=EASTERN)),
            ]
            for offset in range(3):
                games.append(
                    _game(
                        910001430 + offset,
                        heavy,
                        spare,
                        status="COMPLETED",
                        when=datetime(2026, 9, 6 + offset, 18, 0, tzinfo=EASTERN),
                        home_score=1,
                        away_score=0,
                    )
                )
            games.append(
                _game(
                    910001433,
                    spare,
                    heavy,
                    status="COMPLETED",
                    when=datetime(2026, 9, 10, 18, 0, tzinfo=EASTERN),
                    home_score=0,
                    away_score=1,
                )
            )
            games.append(
                _game(
                    910001434,
                    spare,
                    heavy,
                    status="COMPLETED",
                    when=datetime(2026, 9, 12, 18, 0, tzinfo=EASTERN),
                    home_score=1,
                    away_score=1,
                )
            )
            session.add_all(games)
            session.commit()

    def tearDown(self) -> None:
        self._cleanup()

    def _cleanup(self) -> None:
        with Session(engine) as session:
            team_ids = select(ScheduleTeam.id).where(ScheduleTeam.source_id.in_(SOURCES))
            session.execute(
                delete(ScheduleGame).where(
                    or_(
                        ScheduleGame.source_id.between(910001411, 910001440),
                        ScheduleGame.home_team_id.in_(team_ids),
                        ScheduleGame.away_team_id.in_(team_ids),
                    )
                )
            )
            session.execute(delete(ScheduleTeam).where(ScheduleTeam.source_id.in_(SOURCES)))
            session.execute(delete(Club).where(Club.id == CLUB))
            session.commit()

    def test_completed_points_stay_actual_and_remaining_games_use_opponent_ppg(self) -> None:
        with TestClient(app) as client:
            boys = client.get(
                "/standings/predicted",
                params={"conference": CONFERENCE, "tier": "ECNL", "age_group": "U16", "gender": "boys"},
            )
            girls = client.get(
                "/standings/predicted",
                params={"conference": CONFERENCE, "tier": "ECNL", "age_group": "U16", "gender": "girls"},
            )
            default = client.get(
                "/standings/predicted",
                params={"conference": CONFERENCE, "tier": "ECNL", "age_group": "U16"},
            )

        self.assertEqual(boys.status_code, 200, boys.text)
        self.assertEqual(girls.status_code, 200, girls.text)
        body = boys.json()
        self.assertEqual(body["gender"], "boys")
        self.assertEqual(body["points_rule"], POINTS_RULE)
        self.assertIn("at least 2 count as a win", body["record_rule"])
        self.assertIn("at least 1 and below 2 count as a draw", body["record_rule"])

        rows = {row["team_name"]: row for row in body["rows"]}
        self.assertEqual(set(rows), {"ProbePredAlpha", "ProbePredHeavy", "ProbePredSpare", "ProbePredFresh"})
        alpha = rows["ProbePredAlpha"]
        heavy = rows["ProbePredHeavy"]
        fresh = rows["ProbePredFresh"]
        self.assertEqual(alpha["points"], 3)
        self.assertEqual(alpha["games_played"], 1)
        self.assertEqual(alpha["wins"], 1)
        self.assertEqual(alpha["draws"], 0)
        self.assertEqual(alpha["losses"], 0)
        self.assertEqual(alpha["goals_for"], 2)
        self.assertEqual(alpha["goals_against"], 0)
        self.assertEqual(alpha["remaining"], 2)
        self.assertEqual(alpha["predicted_points"], 6.4)
        self.assertEqual(alpha["projected_wins"], 2)
        self.assertEqual(alpha["projected_draws"], 0)
        self.assertEqual(alpha["projected_losses"], 1)
        self.assertEqual(alpha["logo_url"], "https://example.com/probe-pred.png")
        self.assertEqual(heavy["points"], 13)
        self.assertEqual(heavy["games_played"], 5)
        self.assertEqual(heavy["predicted_points"], 13.0)
        self.assertIsNone(heavy["logo_url"])
        self.assertEqual(fresh["points"], 0)
        self.assertEqual(fresh["games_played"], 0)
        self.assertEqual(fresh["predicted_points"], 0.0)

        heavy_cell = next(cell for cell in alpha["cells"] if cell["opponent_id"] == heavy["team_id"])
        self.assertEqual(len(heavy_cell["fixtures"]), 1)
        scheduled = heavy_cell["fixtures"][0]
        self.assertEqual(scheduled["status"], "scheduled")
        self.assertEqual(scheduled["starts_on"], "10/18")
        self.assertIsNone(scheduled["score"])
        self.assertIsNone(scheduled["result"])
        self.assertEqual(scheduled["expected_points"], 0.4)

        fresh_cell = next(cell for cell in alpha["cells"] if cell["opponent_id"] == fresh["team_id"])
        self.assertEqual(fresh_cell["fixtures"][0]["expected_points"], 3.0)
        self.assertIsNone(fresh_cell["fixtures"][0]["score"])

        spare = rows["ProbePredSpare"]
        spare_cell = next(cell for cell in alpha["cells"] if cell["opponent_id"] == spare["team_id"])
        self.assertEqual(spare_cell["fixtures"], [{"game_id": spare_cell["fixtures"][0]["game_id"], "side": "home", "starts_on": "9/1", "status": "completed", "score": "2-0", "result": "W", "expected_points": None}])

        heavy_spare = next(cell for cell in heavy["cells"] if cell["opponent_id"] == spare["team_id"])
        self.assertEqual(len(heavy_spare["fixtures"]), 5)
        self.assertEqual({item["side"] for item in heavy_spare["fixtures"]}, {"home", "away"})
        self.assertTrue(all(item["score"] for item in heavy_spare["fixtures"]))

        self.assertEqual([row["team_name"] for row in body["rows"]], ["ProbePredHeavy", "ProbePredAlpha", "ProbePredSpare", "ProbePredFresh"])
        diagonal = next(cell for cell in alpha["cells"] if cell["opponent_id"] == alpha["team_id"])
        self.assertEqual(diagonal["fixtures"], [])

        girl_rows = girls.json()["rows"]
        self.assertEqual(girls.json()["gender"], "girls")
        self.assertEqual([row["team_name"] for row in girl_rows], ["ProbePredGamma"])
        self.assertFalse(any(row["team_name"].startswith("ProbePred") and row["team_name"] != "ProbePredGamma" for row in girl_rows))
        self.assertNotIn("ProbePredGamma", rows)
        self.assertEqual([row["team_name"] for row in default.json()["rows"]], [row["team_name"] for row in body["rows"]])
