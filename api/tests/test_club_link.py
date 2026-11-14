"""A trailing published dash still finds the club that stores the crest."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.database import engine
from app.main import app
from app.models import Club, ScheduleTeam
from app.refresh import ensure_refresh_tables, upsert_published
from app.team_repair import attach_missing_club_ids, club_id_for_team_name, club_ids_by_normalized_name
from load_league import display_name

CLUB = 910001379
OTHER = 910001380
TWIN_A = 910001381
TWIN_B = 910001382
TEAM = 910001046
HELD = 910001047
AMBIGUOUS = 910001048
INTERNAL = 910001049
UPSERT_TEAM = 910001050
FKK_CLUB = 910001479
LEGENDS_CLUB = 910001480
FKK_U13 = 910001461
FKK_U14 = 910001462
FKK_U15 = 910001463
LEGENDS_TEAM = 910001464


def _cleanup() -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                DELETE FROM team
                WHERE source_id BETWEEN :first_team AND :last_team
                   OR source_id BETWEEN :fkk_first AND :fkk_last
                   OR club_id IN (:fkk_club, :legends_club)
                   OR name LIKE 'Probe Link %'
                """
            ),
            {
                "first_team": TEAM,
                "last_team": UPSERT_TEAM,
                "fkk_first": FKK_U13,
                "fkk_last": LEGENDS_TEAM,
                "fkk_club": FKK_CLUB,
                "legends_club": LEGENDS_CLUB,
            },
        )
        connection.execute(
            text(
                """
                DELETE FROM club
                WHERE id BETWEEN :first_club AND :last_club
                   OR id IN (:fkk_club, :legends_club)
                   OR name LIKE 'Probe Link %'
                """
            ),
            {
                "first_club": CLUB,
                "last_club": TWIN_B,
                "fkk_club": FKK_CLUB,
                "legends_club": LEGENDS_CLUB,
            },
        )


def _team(session: Session, source_id: int, name: str, *, club_id: int | None = None) -> ScheduleTeam:
    team = ScheduleTeam(
        name=name,
        age_group="U13",
        tier="ECNL",
        conference="Probe Link Conf",
        city="Winter Springs",
        state="FL",
        gender="boys",
        source_id=source_id,
        club_id=club_id,
    )
    session.add(team)
    return team


class ClubNameMatchTests(unittest.TestCase):
    def test_dashed_name_matches_the_undashed_club(self) -> None:
        clubs = club_ids_by_normalized_name(
            [
                Club(id=379, name="Florida Kraze Krush", logo_url="https://example.com/kraze.png"),
                Club(id=380, name="Legends FC - Del Mar"),
                Club(id=381, name="Probe Link Twin"),
                Club(id=382, name="Probe Link Twin -"),
            ]
        )

        self.assertEqual(club_id_for_team_name("Florida Kraze Krush -", clubs), 379)
        self.assertEqual(club_id_for_team_name("Florida Kraze Krush", clubs), 379)
        self.assertIsNone(club_id_for_team_name("Legends FC", clubs))
        self.assertIsNone(club_id_for_team_name("Probe Link Twin -", clubs))


class ClubLinkRepairTests(unittest.TestCase):
    def setUp(self) -> None:
        ensure_refresh_tables()
        _cleanup()

    def tearDown(self) -> None:
        _cleanup()

    def test_repair_assigns_club_id_without_renaming_or_copying_the_logo(self) -> None:
        with Session(engine) as session:
            session.add(Club(id=CLUB, name="Probe Link Kraze", logo_url="https://example.com/kraze.png"))
            session.add(Club(id=OTHER, name="Probe Link Held"))
            session.add(Club(id=TWIN_A, name="Probe Link Twin"))
            session.add(Club(id=TWIN_B, name="Probe Link Twin -"))
            dashed = _team(session, TEAM, "Probe Link Kraze -")
            _team(session, HELD, "Probe Link Held", club_id=OTHER)
            _team(session, AMBIGUOUS, "Probe Link Twin -")
            _team(session, INTERNAL, "Probe Link Metro - City")
            session.commit()
            dashed_id = int(dashed.id)

        with Session(engine) as session:
            linked = attach_missing_club_ids(session)
            session.commit()

        self.assertEqual([(item.team_id, item.team_name, item.club_id) for item in linked], [(dashed_id, "Probe Link Kraze -", CLUB)])
        with Session(engine) as session:
            stored = session.get(ScheduleTeam, dashed_id)
            club = session.get(Club, CLUB)
            held = session.scalar(select(ScheduleTeam).where(ScheduleTeam.source_id == HELD))
            ambiguous = session.scalar(select(ScheduleTeam).where(ScheduleTeam.source_id == AMBIGUOUS))
            internal = session.scalar(select(ScheduleTeam).where(ScheduleTeam.source_id == INTERNAL))
            assert stored is not None and club is not None
            assert held is not None and ambiguous is not None and internal is not None
            self.assertEqual(stored.name, "Probe Link Kraze -")
            self.assertEqual(stored.club_id, CLUB)
            self.assertEqual(club.logo_url, "https://example.com/kraze.png")
            self.assertFalse(hasattr(stored, "logo_url"))
            self.assertEqual(held.club_id, OTHER)
            self.assertIsNone(ambiguous.club_id)
            self.assertIsNone(internal.club_id)

    def test_schedule_upsert_attaches_a_dashed_team_when_the_feed_omits_club_id(self) -> None:
        with Session(engine) as session:
            session.add(Club(id=CLUB, name="Probe Link Kraze", logo_url="https://example.com/kraze.png"))
            session.commit()

        upsert_published(
            {
                "teams": [
                    {
                        "source_id": UPSERT_TEAM,
                        "name": "Probe Link Kraze -",
                        "age_group": "U13",
                        "tier": "ECNL",
                        "conference": "Probe Link Conf",
                        "city": "Winter Springs",
                        "state": "FL",
                        "gender": "boys",
                    }
                ],
                "games": [],
            },
            refresh_standings=False,
        )

        with Session(engine) as session:
            team = session.scalar(select(ScheduleTeam).where(ScheduleTeam.source_id == UPSERT_TEAM))
            club = session.get(Club, CLUB)
            assert team is not None and club is not None
            self.assertEqual(team.name, "Probe Link Kraze")
            self.assertEqual(team.club_id, CLUB)
            self.assertEqual(club.logo_url, "https://example.com/kraze.png")

    def test_upsert_rewrites_a_stored_trailing_dash(self) -> None:
        with Session(engine) as session:
            session.add(Club(id=CLUB, name="Probe Link Kraze", logo_url="https://example.com/kraze.png"))
            _team(session, UPSERT_TEAM, "Probe Link Kraze -")
            session.commit()

        upsert_published(
            {
                "teams": [
                    {
                        "source_id": UPSERT_TEAM,
                        "name": "Probe Link Kraze",
                        "age_group": "U13",
                        "tier": "ECNL",
                        "conference": "Probe Link Conf",
                        "city": "Winter Springs",
                        "state": "FL",
                        "gender": "boys",
                    }
                ],
                "games": [],
            },
            refresh_standings=False,
        )

        with Session(engine) as session:
            team = session.scalar(select(ScheduleTeam).where(ScheduleTeam.source_id == UPSERT_TEAM))
            assert team is not None
            self.assertEqual(team.name, "Probe Link Kraze")
            self.assertEqual(team.club_id, CLUB)

    def test_stored_kraze_dash_is_rewritten_and_the_club_page_includes_other_ages(self) -> None:
        """A stored trailing dash is rewritten, and every age is on the one club page."""

        self.assertEqual(display_name("Florida Kraze Krush -"), "Florida Kraze Krush")
        self.assertEqual(display_name("Legends FC - Del Mar"), "Legends FC - Del Mar")
        self.assertEqual(display_name("San Diego Surf - White"), "San Diego Surf - White")

        with Session(engine) as session:
            session.add(Club(id=FKK_CLUB, name="Florida Kraze Krush", logo_url="https://example.com/kraze.png"))
            session.add(Club(id=LEGENDS_CLUB, name="Legends FC - Del Mar", logo_url=None))
            u13 = _team(session, FKK_U13, "Florida Kraze Krush -", club_id=FKK_CLUB)
            u14 = _team(session, FKK_U14, "Florida Kraze Krush", club_id=FKK_CLUB)
            u14.age_group = "U14"
            u15 = _team(session, FKK_U15, "Florida Kraze Krush", club_id=FKK_CLUB)
            u15.age_group = "U15"
            u15.gender = "girls"
            legends = _team(session, LEGENDS_TEAM, "Legends FC - Del Mar", club_id=LEGENDS_CLUB)
            session.commit()
            u13_id = int(u13.id)
            legends_id = int(legends.id)

        dashed_key = f"{FKK_CLUB}-florida-kraze-krush--"
        plain_key = f"{FKK_CLUB}-florida-kraze-krush"
        with TestClient(app) as client:
            before = client.get(f"/clubs/{FKK_CLUB}")
            dashed_page = client.get(f"/clubs/{dashed_key}")
            plain_page = client.get(f"/clubs/{plain_key}")
        self.assertEqual(before.status_code, 404)
        self.assertEqual(dashed_page.status_code, 200)
        self.assertEqual([row["age_group"] for row in dashed_page.json()["squads"]], ["U13"])
        self.assertEqual(plain_page.status_code, 200)
        self.assertEqual(sorted(row["age_group"] for row in plain_page.json()["squads"]), ["U14", "U15"])

        def team_row(source_id: int, name: str, age_group: str, gender: str = "boys") -> dict:
            return {
                "source_id": source_id,
                "name": name,
                "age_group": age_group,
                "tier": "ECNL",
                "conference": "Probe Link Conf",
                "city": "Winter Springs",
                "state": "FL",
                "gender": gender,
                "club_id": FKK_CLUB if source_id != LEGENDS_TEAM else LEGENDS_CLUB,
            }

        upsert_published(
            {
                "teams": [
                    team_row(FKK_U13, "Florida Kraze Krush -", "U13"),
                    team_row(FKK_U14, "Florida Kraze Krush", "U14"),
                    team_row(FKK_U15, "Florida Kraze Krush", "U15", "girls"),
                    team_row(LEGENDS_TEAM, "Legends FC - Del Mar", "U13"),
                ],
                "games": [],
            },
            refresh_standings=False,
        )

        with Session(engine) as session:
            stored = session.get(ScheduleTeam, u13_id)
            legends_row = session.get(ScheduleTeam, legends_id)
            names = session.scalars(select(ScheduleTeam.name).where(ScheduleTeam.club_id == FKK_CLUB)).all()
            club_count = session.scalar(select(func.count()).select_from(Club).where(Club.id.in_([FKK_CLUB, LEGENDS_CLUB])))
            assert stored is not None and legends_row is not None
            self.assertEqual(stored.name, "Florida Kraze Krush")
            self.assertEqual(stored.club_id, FKK_CLUB)
            self.assertEqual(stored.source_id, FKK_U13)
            self.assertEqual(sorted(names), ["Florida Kraze Krush", "Florida Kraze Krush", "Florida Kraze Krush"])
            self.assertEqual(legends_row.name, "Legends FC - Del Mar")
            self.assertEqual(legends_row.club_id, LEGENDS_CLUB)
            self.assertEqual(club_count, 2)

        with TestClient(app) as client:
            page = client.get(f"/clubs/{FKK_CLUB}")
            listed = client.get("/clubs", params={"q": "Florida Kraze Krush", "all": "true"})
            dashed_after = client.get(f"/clubs/{dashed_key}")
            plain_after = client.get(f"/clubs/{plain_key}")
        self.assertEqual(page.status_code, 200)
        body = page.json()
        self.assertEqual(body["id"], FKK_CLUB)
        self.assertEqual(body["name"], "Florida Kraze Krush")
        self.assertEqual(sorted(squad["age_group"] for squad in body["squads"]), ["U13", "U14", "U15"])
        self.assertEqual({squad["name"] for squad in body["squads"]}, {"Florida Kraze Krush"})
        self.assertIn(u13_id, {squad["id"] for squad in body["squads"]})
        self.assertEqual(dashed_after.status_code, 404)
        self.assertEqual(plain_after.status_code, 404)
        ours = [row for row in listed.json() if row["id"] == FKK_CLUB]
        self.assertEqual(
            ours,
            [
                {
                    "id": FKK_CLUB,
                    "name": "Florida Kraze Krush",
                    "logo_url": "https://example.com/kraze.png",
                    "team_count": 3,
                }
            ],
        )


if __name__ == "__main__":
    unittest.main()
