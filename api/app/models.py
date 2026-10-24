from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Team(Base):
    """Home city and state are the club's home location."""

    __tablename__ = "team"
    __table_args__ = (
        CheckConstraint(
            "age_group IN ('U13', 'U14', 'U15', 'U16', 'U17', 'U18/19')",
            name="ck_team_age_group",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    age_group: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    conference: Mapped[str] = mapped_column(String(80), nullable=False)
    city: Mapped[str] = mapped_column(String(80), nullable=False)
    state: Mapped[str] = mapped_column(String(2), nullable=False)

    home_games: Mapped[list["Game"]] = relationship(back_populates="home_team", foreign_keys="Game.home_team_id")
    away_games: Mapped[list["Game"]] = relationship(back_populates="away_team", foreign_keys="Game.away_team_id")


class Game(Base):
    __tablename__ = "game"

    id: Mapped[int] = mapped_column(primary_key=True)
    home_team_id: Mapped[int] = mapped_column(ForeignKey("team.id"), nullable=False, index=True)
    away_team_id: Mapped[int] = mapped_column(ForeignKey("team.id"), nullable=False, index=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    venue_name: Mapped[str] = mapped_column(String(160), nullable=False)
    city: Mapped[str] = mapped_column(String(80), nullable=False)
    state: Mapped[str] = mapped_column(String(2), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="America/New_York")
    event: Mapped[str | None] = mapped_column(Text, nullable=True)

    home_team: Mapped[Team] = relationship(back_populates="home_games", foreign_keys=[home_team_id])
    away_team: Mapped[Team] = relationship(back_populates="away_games", foreign_keys=[away_team_id])
