"""A trailing published dash still finds the club that stores the crest."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.database import engine
from app.models import Club, ScheduleTeam
from app.refresh import ensure_refresh_tables, upsert_published
from app.team_repair import attach_missing_club_ids, club_id_for_team_name, club_ids_by_normalized_name

CLUB = 910001379
OTHER = 910001380
TWIN_A = 910001381
TWIN_B = 910001382
TEAM = 910001046
HELD = 910001047
AMBIGUOUS = 910001048
INTERNAL = 910001049
UPSERT_TEAM = 910001050


def _cleanup() -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                DELETE FROM team
                WHERE source_id BETWEEN :first_team AND :last_team
                   OR name LIKE 'Probe Link %'
                """
            ),
            {"first_team": TEAM, "last_team": UPSERT_TEAM},
        )
        connection.execute(
            text("DELETE FROM club WHERE id BETWEEN :first_club AND :last_club OR name LIKE 'Probe Link %'"),
            {"first_club": CLUB, "last_club": TWIN_B},
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
            self.assertEqual(team.name, "Probe Link Kraze -")
            self.assertEqual(team.club_id, CLUB)
            self.assertEqual(club.logo_url, "https://example.com/kraze.png")

    def test_upsert_keeps_the_published_dash_when_the_feed_drops_it(self) -> None:
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
            self.assertEqual(team.name, "Probe Link Kraze -")
            self.assertEqual(team.club_id, CLUB)


if __name__ == "__main__":
    unittest.main()
