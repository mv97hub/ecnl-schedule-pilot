"""Checks for venue splitting and the three ingest endpoints."""

from __future__ import annotations

import sys
import unittest
from datetime import time
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import event, text
from fastapi.testclient import TestClient

from app.database import engine
from app.ingestion.normalizer import split_venue, standardize_team_name
from app.ingestion.parsing import extract_games_from_html, parse_ics, parse_score_text, parse_standings_text
from app.main import app

ICS = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//ecnl-schedule-pilot//test//EN
BEGIN:VEVENT
UID:probe-ics-1
DTSTART:20260913T140000
SUMMARY:Probe Away at Probe Central
LOCATION:Matt Park - Field 2, Jacksonville, FL
DESCRIPTION:Florida Showcase
END:VEVENT
END:VCALENDAR
"""

HTML = """
<table>
  <tr><th>Date</th><th>Time</th><th>Home</th><th>Away</th><th>Venue</th><th>Location</th></tr>
  <tr>
    <td>2026-10-03</td><td>1:00 PM</td>
    <td>Probe North ECNL B2013/14</td><td>Probe South</td>
    <td>Central Park #3</td><td>Savannah, GA</td>
  </tr>
</table>
"""

PROSE_HTML = """
<div>2026-10-04 2:00 PM Probe East vs Probe West @ Matt Park - Field 2, Tampa, FL</div>
"""


class NormalizerTests(unittest.TestCase):
    def test_splits_hash_and_dashed_field(self) -> None:
        self.assertEqual(split_venue("Central Park #3"), ("Central Park", "3"))
        self.assertEqual(split_venue("Matt Park - Field 2"), ("Matt Park", "2"))
        self.assertEqual(split_venue("Veterans Park"), ("Veterans Park", ""))

    def test_standardizes_team_names(self) -> None:
        self.assertEqual(standardize_team_name("  Sporting SA JAX ECNL B2013/14 "), "Sporting SA JAX")
        self.assertEqual(standardize_team_name("GSA"), "GSA")

    def test_ics_and_html_parsers(self) -> None:
        ics_games = parse_ics(ICS, age_group="U13", tier=None)
        self.assertEqual(ics_games[0].home_name, "Probe Central")
        self.assertEqual(ics_games[0].away_name, "Probe Away")
        self.assertEqual(ics_games[0].complex_name, "Matt Park")
        self.assertEqual(ics_games[0].field_number, "2")
        self.assertIsNone(parse_ics("BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART;VALUE=DATE:20260913\nSUMMARY:Probe Away at Probe Central\nEND:VEVENT\nEND:VCALENDAR", age_group="U13", tier=None)[0].kickoff_time)

        html_games = extract_games_from_html(HTML, age_group="U13", tier=None)
        self.assertEqual(html_games[0].home_name, "Probe North ECNL B2013/14")
        self.assertEqual(html_games[0].complex_name, "Central Park")
        self.assertEqual(html_games[0].field_number, "3")
        self.assertEqual(html_games[0].city_state, "Savannah, GA")

        prose_games = extract_games_from_html(PROSE_HTML, age_group="U14", tier=None)
        self.assertEqual(prose_games[0].home_name, "Probe East")
        self.assertEqual(prose_games[0].complex_name, "Matt Park")
        self.assertEqual(prose_games[0].field_number, "2")
        self.assertEqual(prose_games[0].city_state, "Tampa, FL")

    def test_score_and_standings_text(self) -> None:
        scores = parse_score_text(
            "\n".join(
                [
                    "2026-08-29 | Probe Central | Probe Coastal | 3 - 1",
                    "2026-08-30 Probe Central W 4-0 Probe Coastal",
                    "2026-08-31 Probe Central 2-2 Probe Coastal",
                ]
            ),
            age_group="U13",
        )
        self.assertEqual([(score.home_score, score.away_score) for score in scores], [(3, 1), (4, 0), (2, 2)])
        rows = parse_standings_text("Team GP W L D GF GA\nProbe Central 4 3 1 0 8 2\n")
        self.assertEqual(rows[0]["games_played"], 4)
        self.assertEqual(rows[0]["wins"], 3)
        self.assertIsNone(rows[0]["points"])


class EndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._client_cm = TestClient(app)
        cls.client = cls._client_cm.__enter__()
        cls.statements: list[str] = []

        def capture(_conn, _cursor, statement, _parameters, _context, _executemany) -> None:
            if "ingest_game" in statement and "ON CONFLICT" in statement:
                cls.statements.append(statement)

        cls.capture = capture
        event.listen(engine, "before_cursor_execute", capture)

    @classmethod
    def tearDownClass(cls) -> None:
        event.remove(engine, "before_cursor_execute", cls.capture)
        with engine.begin() as connection:
            connection.execute(
                text(
                    """
                    DELETE FROM ingest_game
                    WHERE home_team_id IN (SELECT id FROM ingest_team WHERE name LIKE 'Probe %')
                       OR away_team_id IN (SELECT id FROM ingest_team WHERE name LIKE 'Probe %')
                    """
                )
            )
            connection.execute(text("DELETE FROM ingest_team WHERE name LIKE 'Probe %'"))
            connection.execute(text("DELETE FROM conference_standing WHERE team_name LIKE 'Probe %' OR conference = 'Probe Conference'"))
        cls._client_cm.__exit__(None, None, None)

    def setUp(self) -> None:
        self.statements.clear()

    def test_schedule_tables_are_unchanged(self) -> None:
        with engine.connect() as connection:
            team_columns = set(connection.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'team'")).scalars())
            game_columns = set(connection.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'game'")).scalars())
            team_count = connection.execute(text("SELECT count(*) FROM team")).scalar_one()
            game_count = connection.execute(text("SELECT count(*) FROM game")).scalar_one()
            rl_teams = connection.execute(text("SELECT count(*) FROM team WHERE tier = 'ECNL-RL'")).scalar_one()
        self.assertIn("conference", team_columns)
        self.assertIn("tier", team_columns)
        self.assertIn("home_score", game_columns)
        self.assertNotIn("match_key", game_columns)
        self.assertEqual(team_count, 3271)
        self.assertEqual(game_count, 27380)
        self.assertEqual(rl_teams, 2233)

    def test_raw_text_reimport_updates_field_and_time(self) -> None:
        first = self.client.post(
            "/ingest/raw-text",
            json={
                "age_group": "U13",
                "text": "2026-09-12 | 9:00 AM | Probe Central ECNL B2013/14 | Probe Coastal | Central Park #3 | Jacksonville, FL |",
            },
        )
        self.assertEqual(first.status_code, 200, first.text)
        body = first.json()
        self.assertEqual(body["inserted"], 1)
        self.assertEqual(body["updated"], 0)
        self.assertEqual(body["games"][0]["home_team"], "Probe Central")
        self.assertEqual(body["games"][0]["field_number"], "3")
        self.assertEqual(body["games"][0]["kickoff_time"], "09:00")
        self.assertFalse(body["games"][0]["is_showcase"])
        self.assertIn("ON CONFLICT", self.statements[-1])
        self.assertIn("DO UPDATE", self.statements[-1])
        self.assertIn("field_number", self.statements[-1])
        self.assertIn("kickoff_time", self.statements[-1])

        second = self.client.post(
            "/ingest/raw-text",
            json={
                "age_group": "U13",
                "text": "2026-09-12 | 10:30 AM | Probe Central | Probe Coastal | Central Park #4 | Jacksonville, FL | showcase",
            },
        )
        self.assertEqual(second.status_code, 200, second.text)
        updated = second.json()
        self.assertEqual(updated["inserted"], 0)
        self.assertEqual(updated["updated"], 1)
        self.assertEqual(updated["games"][0]["id"], body["games"][0]["id"])
        self.assertEqual(updated["games"][0]["match_key"], body["games"][0]["match_key"])
        self.assertEqual(updated["games"][0]["field_number"], "4")
        self.assertEqual(updated["games"][0]["kickoff_time"], "10:30")
        self.assertTrue(updated["games"][0]["is_showcase"])
        self.assertEqual(updated["games"][0]["kickoff_time"], time(10, 30).strftime("%H:%M"))

        with engine.connect() as connection:
            count = connection.execute(
                text("SELECT count(*) FROM ingest_game WHERE match_key = :key"),
                {"key": body["games"][0]["match_key"]},
            ).scalar_one()
        self.assertEqual(count, 1)

    def test_ics_endpoint_upserts(self) -> None:
        with patch("app.routers.ingest.fetch_calendar", new_callable=AsyncMock) as fetch_calendar:
            fetch_calendar.return_value = ICS
            response = self.client.post(
                "/ingest/ics",
                json={"url": "https://schedules.example.com/playmetrics.ics", "age_group": "U13"},
            )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["inserted"], 1)
        self.assertEqual(body["games"][0]["home_team"], "Probe Central")
        self.assertEqual(body["games"][0]["away_team"], "Probe Away")
        self.assertEqual(body["games"][0]["complex_name"], "Matt Park")
        self.assertEqual(body["games"][0]["field_number"], "2")
        self.assertEqual(body["games"][0]["kickoff_time"], "14:00")
        self.assertTrue(body["games"][0]["is_showcase"])
        self.assertIn("ON CONFLICT", self.statements[-1])

        with patch("app.routers.ingest.fetch_calendar", new_callable=AsyncMock) as fetch_calendar:
            fetch_calendar.return_value = ICS.replace("Field 2", "Field 9").replace("T140000", "T153000")
            again = self.client.post(
                "/ingest/ics",
                json={"url": "https://schedules.example.com/playmetrics.ics", "age_group": "U13"},
            )
        self.assertEqual(again.status_code, 200, again.text)
        self.assertEqual(again.json()["updated"], 1)
        self.assertEqual(again.json()["games"][0]["field_number"], "9")
        self.assertEqual(again.json()["games"][0]["kickoff_time"], "15:30")
        self.assertEqual(again.json()["games"][0]["id"], body["games"][0]["id"])

    def test_url_endpoint_upserts_without_a_browser(self) -> None:
        with patch("app.routers.ingest.fetch_rendered_html", new_callable=AsyncMock) as fetch_html:
            fetch_html.return_value = HTML
            response = self.client.post(
                "/ingest/url",
                json={"url": "https://schedules.example.com/gotsport", "age_group": "U15"},
            )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["games"][0]["home_team"], "Probe North")
        self.assertEqual(body["games"][0]["field_number"], "3")
        self.assertEqual(body["games"][0]["city_state"], "Savannah, GA")
        self.assertIn("ON CONFLICT", self.statements[-1])

        with patch("app.routers.ingest.fetch_rendered_html", new_callable=AsyncMock) as fetch_html:
            fetch_html.return_value = HTML.replace("#3", "#8").replace("1:00 PM", "4:15 PM")
            again = self.client.post(
                "/ingest/url",
                json={"url": "https://schedules.example.com/gotsport", "age_group": "U15"},
            )
        self.assertEqual(again.status_code, 200, again.text)
        self.assertEqual(again.json()["updated"], 1)
        self.assertEqual(again.json()["games"][0]["field_number"], "8")
        self.assertEqual(again.json()["games"][0]["kickoff_time"], "16:15")

    def test_private_urls_are_rejected(self) -> None:
        ics = self.client.post("/ingest/ics", json={"url": "http://127.0.0.1/club.ics"})
        page = self.client.post("/ingest/url", json={"url": "http://10.0.0.8/schedule"})
        self.assertEqual(ics.status_code, 400)
        self.assertEqual(page.status_code, 400)

    def test_scores_reimport_keeps_one_row_and_schedule_import_keeps_the_score(self) -> None:
        first = self.client.post(
            "/ingest/scores",
            json={
                "age_group": "U13",
                "text": "2026-09-20 | Probe Central | Probe Coastal | 3-1",
            },
        )
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json()["inserted"], 1)
        self.assertEqual(first.json()["games"][0]["home_score"], 3)
        self.assertIn("home_score", self.statements[-1])
        self.assertIn("ON CONFLICT", self.statements[-1])

        second = self.client.post(
            "/ingest/scores",
            json={
                "age_group": "U13",
                "games": [
                    {
                        "date": "2026-09-20",
                        "home_team": "Probe Central",
                        "away_team": "Probe Coastal",
                        "home_score": 2,
                        "away_score": 2,
                    }
                ],
            },
        )
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(second.json()["updated"], 1)
        self.assertEqual(second.json()["games"][0]["id"], first.json()["games"][0]["id"])
        self.assertEqual(second.json()["games"][0]["away_score"], 2)

        schedule = self.client.post(
            "/ingest/raw-text",
            json={
                "age_group": "U13",
                "text": "2026-09-20 | 11:00 AM | Probe Central | Probe Coastal | Matt Park - Field 2 | Jacksonville, FL |",
            },
        )
        self.assertEqual(schedule.status_code, 200, schedule.text)
        with engine.connect() as connection:
            row = connection.execute(
                text("SELECT home_score, away_score, status, field_number FROM ingest_game WHERE match_key = :key"),
                {"key": first.json()["games"][0]["match_key"]},
            ).one()
        self.assertEqual(row.home_score, 2)
        self.assertEqual(row.away_score, 2)
        self.assertEqual(row.status, "COMPLETED")
        self.assertEqual(row.field_number, "2")

    def test_standings_upsert_computes_points(self) -> None:
        created = self.client.post(
            "/ingest/standings",
            json={
                "conference": "Probe Conference",
                "tier": "ECNL",
                "age_group": "U13/B2013",
                "text": "Team GP W L D GF GA\nProbe Central 4 3 1 0 8 2\nProbe Coastal 4 1 1 2 4 4\n",
            },
        )
        self.assertEqual(created.status_code, 200, created.text)
        self.assertEqual(created.json()["age_group"], "U13")
        listed = self.client.get("/standings?conference=Probe%20Conference&tier=ECNL&age_group=U13")
        self.assertEqual(listed.status_code, 200, listed.text)
        rows = listed.json()
        self.assertEqual(rows[0]["team_name"], "Probe Central")
        self.assertEqual(rows[0]["points"], 9)
        self.assertEqual(rows[0]["points_per_game"], 2.25)
        self.assertEqual(rows[0]["goal_diff"], 6)
        self.assertEqual(rows[0]["rank"], 1)
        self.assertEqual(rows[0]["form"], [])
        rejected = self.client.get("/standings?conference=Probe%20Conference&tier=ECNL&age_group=U13&mode=nope")
        self.assertEqual(rejected.status_code, 400)

    def test_schedule_payload_includes_record(self) -> None:
        with engine.connect() as connection:
            team_id = connection.execute(
                text("SELECT id FROM team WHERE name = 'Sporting SA JAX' AND age_group = 'U13' AND tier = 'ECNL'")
            ).scalar_one()
        response = self.client.get(f"/teams/{team_id}/schedule")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertIn("team_record_summary", body)
        self.assertRegex(body["team_record_summary"]["overall_record"], r"^\d+-\d+-\d+$")
        self.assertIn(body["games"][0]["venue_type"], ["Home", "Away", "Showcase"])
        self.assertIn(body["games"][0]["status"], ["SCHEDULED", "COMPLETED", "POSTPONED", "CANCELLED"])
        october = {game["starts_at"][:10]: game for game in body["games"]}
        self.assertEqual((october["2026-10-03"]["home_score"], october["2026-10-03"]["away_score"]), (1, 0))
        self.assertEqual(october["2026-10-03"]["opponent"]["name"], "Athletic Club Florida")
        self.assertEqual((october["2026-10-04"]["home_score"], october["2026-10-04"]["away_score"]), (1, 2))
        self.assertEqual(october["2026-10-04"]["opponent"]["name"], "Parkland Soccer Club")
        standings = self.client.get("/standings?conference=Florida&tier=ECNL&age_group=U13")
        self.assertEqual(standings.status_code, 200, standings.text)
        sporting = next(row for row in standings.json() if row["team_name"] == "Sporting SA JAX")
        self.assertEqual(sporting["form"], ["W", "W", "D", "W", "L"])

    def test_head_to_head_sporting_versus_parkland(self) -> None:
        missing = self.client.get("/head-to-head")
        self.assertEqual(missing.status_code, 400)
        with engine.connect() as connection:
            sporting = connection.execute(
                text("SELECT id FROM team WHERE name = 'Sporting SA JAX' AND age_group = 'U13' AND tier = 'ECNL'")
            ).scalar_one()
            parkland = connection.execute(
                text("SELECT id FROM team WHERE name = 'Parkland Soccer Club' AND age_group = 'U13' AND tier = 'ECNL'")
            ).scalar_one()
        same = self.client.get(f"/head-to-head?team_a_id={sporting}&team_b_id={sporting}")
        self.assertEqual(same.status_code, 400)
        unknown = self.client.get(f"/head-to-head?team_a_id={sporting}&team_b_id=99999999")
        self.assertEqual(unknown.status_code, 404)

        response = self.client.get(f"/head-to-head?team_a_id={sporting}&team_b_id={parkland}")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        tape = body["team_a_stats"]
        self.assertEqual(tape["name"], "Sporting SA JAX")
        self.assertEqual(tape["overall_record"]["w"], 4)
        self.assertEqual(tape["overall_record"]["l"], 1)
        self.assertEqual(tape["overall_record"]["d"], 1)
        self.assertEqual(tape["overall_record"]["gd"], 11)
        self.assertEqual(tape["overall_record"]["ppg"], 2.17)
        self.assertEqual(
            tape["home_record"]["gp"] + tape["away_record"]["gp"],
            tape["overall_record"]["gp"],
        )
        self.assertEqual([item["result"] for item in tape["last_5_form"]], ["W", "W", "D", "W", "L"])
        self.assertEqual(tape["last_5_form"][-1]["score"], "1-2")
        self.assertEqual(tape["last_5_form"][-1]["opponent_name"], "Parkland Soccer Club")

        summary = body["direct_matches"]["summary"]
        self.assertEqual(summary["team_a_wins"], 0)
        self.assertEqual(summary["team_b_wins"], 1)
        self.assertEqual(summary["draws"], 0)
        self.assertEqual(summary["team_a_goals"], 1)
        self.assertEqual(summary["team_b_goals"], 2)
        meetings = body["direct_matches"]["games"]
        self.assertEqual(len(meetings), 2)
        self.assertEqual([game["date"] for game in meetings], ["2026-10-04", "2026-10-31"])
        self.assertEqual(meetings[0]["status"], "COMPLETED")
        self.assertEqual((meetings[0]["home_score"], meetings[0]["away_score"]), (1, 2))
        self.assertEqual(meetings[0]["winner"], "team_b")
        self.assertEqual(meetings[0]["venue_type"], "Home")
        self.assertEqual(meetings[0]["complex_name"], "Veterans Park")
        self.assertEqual(meetings[0]["kickoff_time"], "09:00")
        self.assertIsNone(meetings[0]["field_number"])
        self.assertEqual(meetings[1]["status"], "SCHEDULED")
        self.assertEqual(meetings[1]["venue_type"], "Away")
        self.assertEqual(meetings[1]["complex_name"], "Terramar Park")
        self.assertIsNone(meetings[1]["winner"])

        opponents = body["common_opponents"]
        self.assertGreaterEqual(len(opponents), 3)
        ppgs = [row["conference_ppg"] for row in opponents]
        numeric = [value for value in ppgs if value is not None]
        self.assertEqual(numeric, sorted(numeric, reverse=True))
        self.assertTrue(all(row["team_a_games"] and row["team_b_games"] for row in opponents))
        self.assertTrue(all(row["advantage"] in {"team_a", "team_b", "even", "incomplete"} for row in opponents))
        self.assertGreater(body["common_opponents_rollup"]["team_a_vs_common"]["gp"], 0)
        self.assertGreater(body["common_opponents_rollup"]["team_b_vs_common"]["gp"], 0)

        conference = self.client.get(
            f"/head-to-head?team_a_id={sporting}&team_b_id={parkland}&conference_only=true"
        )
        self.assertEqual(conference.status_code, 200, conference.text)
        kept = conference.json()["direct_matches"]["games"]
        self.assertEqual(kept[0]["status"], "COMPLETED")
        self.assertGreaterEqual(len(conference.json()["common_opponents"]), 3)

    def test_empty_raw_text_is_400(self) -> None:
        response = self.client.post("/ingest/raw-text", json={"text": "   "})
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
