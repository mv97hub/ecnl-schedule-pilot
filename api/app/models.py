"""Schedule tables (`team`, `game`) and ingested schedules (`ingest_team`, `ingest_game`)."""

from datetime import date as DateValue
from datetime import UTC, datetime
from datetime import time as TimeValue

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlmodel import Field, SQLModel


class Base(DeclarativeBase):
    pass


SQLModel.metadata = Base.metadata


class ScheduleTeam(Base):
    """Home city and state are the club's home location."""

    __tablename__ = "team"
    __table_args__ = (
        CheckConstraint(
            "age_group IN ('U13', 'U14', 'U15', 'U16', 'U17', 'U18/19')",
            name="ck_team_age_group",
        ),
        CheckConstraint(
            "tier IN ('ECNL', 'ECNL-RL')",
            name="ck_team_tier",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    age_group: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    tier: Mapped[str] = mapped_column(String(16), nullable=False, default="ECNL", server_default="ECNL")
    conference: Mapped[str] = mapped_column(String(120), nullable=False)
    city: Mapped[str] = mapped_column(String(80), nullable=False)
    state: Mapped[str] = mapped_column(String(2), nullable=False)
    source_id: Mapped[int | None] = mapped_column(Integer, nullable=True, unique=True)

    home_games: Mapped[list["ScheduleGame"]] = relationship(
        back_populates="home_team",
        foreign_keys="ScheduleGame.home_team_id",
    )
    away_games: Mapped[list["ScheduleGame"]] = relationship(
        back_populates="away_team",
        foreign_keys="ScheduleGame.away_team_id",
    )


class ScheduleGame(Base):
    __tablename__ = "game"
    __table_args__ = (
        CheckConstraint(
            "status IN ('SCHEDULED', 'COMPLETED', 'POSTPONED', 'CANCELLED')",
            name="ck_game_status",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    home_team_id: Mapped[int] = mapped_column(ForeignKey("team.id"), nullable=False, index=True)
    away_team_id: Mapped[int] = mapped_column(ForeignKey("team.id"), nullable=False, index=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    venue_name: Mapped[str] = mapped_column(String(160), nullable=False)
    city: Mapped[str] = mapped_column(String(80), nullable=False)
    state: Mapped[str] = mapped_column(String(2), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="America/New_York")
    event: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="SCHEDULED", server_default="SCHEDULED")
    home_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    away_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_conference_game: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    source_id: Mapped[int | None] = mapped_column(Integer, nullable=True, unique=True)

    home_team: Mapped[ScheduleTeam] = relationship(back_populates="home_games", foreign_keys=[home_team_id])
    away_team: Mapped[ScheduleTeam] = relationship(back_populates="away_games", foreign_keys=[away_team_id])


class DataRefresh(Base):
    """One scheduled league refresh. A failure does not replace the last success."""

    __tablename__ = "data_refresh"
    __table_args__ = (
        CheckConstraint(
            "status IN ('running', 'success', 'failure')",
            name="ck_data_refresh_status",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    teams_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    games_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    scores_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class Team(SQLModel, table=True):
    """Club row created while importing a schedule. Separate from the published league table."""

    __tablename__ = "ingest_team"
    __table_args__ = (UniqueConstraint("name", "age_group", name="uq_ingest_team_name_age"),)

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(max_length=160, index=True)
    age_group: str = Field(default="Unknown", max_length=16, index=True)
    tier: str | None = Field(default=None, max_length=40)
    home_complex: str | None = Field(default=None, max_length=200)


class Game(SQLModel, table=True):
    """One imported match. `match_key` ignores kickoff and field so a re-import updates them."""

    __tablename__ = "ingest_game"
    __table_args__ = (
        CheckConstraint(
            "status IN ('SCHEDULED', 'COMPLETED', 'POSTPONED', 'CANCELLED')",
            name="ck_ingest_game_status",
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    match_key: str = Field(max_length=64, unique=True, index=True)
    date: DateValue = Field(index=True)
    kickoff_time: TimeValue | None = None
    home_team_id: int = Field(foreign_key="ingest_team.id", index=True)
    away_team_id: int = Field(foreign_key="ingest_team.id", index=True)
    complex_name: str = Field(default="", max_length=200)
    field_number: str = Field(default="", max_length=40)
    city_state: str = Field(default="", max_length=120)
    is_showcase: bool = Field(default=False)
    status: str = Field(default="SCHEDULED", max_length=16)
    home_score: int | None = None
    away_score: int | None = None
    is_conference_game: bool = Field(default=True)


class ConferenceStanding(SQLModel, table=True):
    """Official conference table. Re-importing the same club updates this row."""

    __tablename__ = "conference_standing"
    __table_args__ = (
        UniqueConstraint(
            "conference",
            "tier",
            "age_group",
            "team_name",
            name="uq_conference_standing_identity",
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    conference: str = Field(max_length=80, index=True)
    tier: str = Field(max_length=16, index=True)
    age_group: str = Field(max_length=16, index=True)
    team_id: int | None = Field(default=None, foreign_key="team.id", index=True)
    team_name: str = Field(max_length=160)
    games_played: int = Field(default=0)
    wins: int = Field(default=0)
    losses: int = Field(default=0)
    draws: int = Field(default=0)
    goals_for: int = Field(default=0)
    goals_against: int = Field(default=0)
    goal_diff: int = Field(default=0)
    points: int = Field(default=0)
    points_per_game: float = Field(default=0.0)
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
