"""Schedule tables (`team`, `game`) and ingested schedules (`ingest_team`, `ingest_game`)."""

from datetime import date as DateValue
from datetime import UTC, datetime
from datetime import time as TimeValue

from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
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
        CheckConstraint(
            "gender IN ('boys', 'girls')",
            name="ck_team_gender",
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
    gender: Mapped[str] = mapped_column(String(8), nullable=False, default="boys", server_default="boys")
    club_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)

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
    venue_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    venue_zip: Mapped[str | None] = mapped_column(String(16), nullable=True)
    venue_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    venue_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    field_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    stream_link: Mapped[str | None] = mapped_column(Text, nullable=True)
    field_surface: Mapped[str | None] = mapped_column(String(80), nullable=True)
    postponement_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

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
        CheckConstraint(
            "job IN ('schedule', 'people', 'reference')",
            name="ck_data_refresh_job",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    job: Mapped[str] = mapped_column(String(16), nullable=False, default="schedule", server_default="schedule")
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
            "gender",
            "age_group",
            "team_name",
            name="uq_conference_standing_with_gender",
        ),
        CheckConstraint(
            "gender IN ('boys', 'girls')",
            name="ck_conference_standing_gender",
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    conference: str = Field(max_length=80, index=True)
    tier: str = Field(max_length=16, index=True)
    gender: str = Field(default="boys", max_length=8, index=True)
    age_group: str = Field(max_length=16, index=True)
    capped_goal_diff: int | None = Field(default=None)
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


class Club(Base):
    """AthleteOne club. `id` is the AthleteOne club id. Parent id stays null when the feed omits it."""

    __tablename__ = "club"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    parent_club_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    logo_url: Mapped[str | None] = mapped_column(Text, nullable=True)


class TeamEvent(Base):
    """One squad inside a league event or showcase flight. Does not create a second team row."""

    __tablename__ = "team_event"
    __table_args__ = (
        UniqueConstraint("event_id", "flight_id", "source_team_id", name="uq_team_event_squad"),
        CheckConstraint("gender IN ('boys', 'girls')", name="ck_team_event_gender"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    source_team_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    event_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    flight_id: Mapped[int] = mapped_column(Integer, nullable=False)
    team_id: Mapped[int | None] = mapped_column(ForeignKey("team.id", ondelete="SET NULL"), nullable=True, index=True)
    club_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    age_group: Mapped[str] = mapped_column(String(16), nullable=False)
    gender: Mapped[str] = mapped_column(String(8), nullable=False)
    tier: Mapped[str] = mapped_column(String(16), nullable=False)
    event_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    flight_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="league", server_default="league")


class CoachingStaff(Base):
    """Coach attached to a club or team. Phone numbers and personal emails are not stored."""

    __tablename__ = "coaching_staff"
    __table_args__ = (UniqueConstraint("source_team_id", "name", "role", name="uq_coaching_staff_post"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    source_team_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    club_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    team_id: Mapped[int | None] = mapped_column(ForeignKey("team.id", ondelete="SET NULL"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    role: Mapped[str | None] = mapped_column(String(80), nullable=True)


class Player(Base):
    """Public player profile. Email, home address, date of birth, and parent contact are not columns."""

    __tablename__ = "player"
    __table_args__ = (CheckConstraint("gender IS NULL OR gender IN ('boys', 'girls')", name="ck_player_gender"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)
    first_name: Mapped[str] = mapped_column(String(80), nullable=False)
    last_name: Mapped[str] = mapped_column(String(80), nullable=False)
    photo_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    gender: Mapped[str | None] = mapped_column(String(8), nullable=True)
    position: Mapped[str | None] = mapped_column(String(40), nullable=True)
    graduation_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    jersey_number: Mapped[str | None] = mapped_column(String(8), nullable=True)
    height: Mapped[str | None] = mapped_column(String(16), nullable=True)
    weight: Mapped[str | None] = mapped_column(String(16), nullable=True)
    club_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    team_id: Mapped[int | None] = mapped_column(ForeignKey("team.id", ondelete="SET NULL"), nullable=True, index=True)
    gpa: Mapped[str | None] = mapped_column(String(16), nullable=True)
    college_commitment: Mapped[str | None] = mapped_column(String(160), nullable=True)
    high_school: Mapped[str | None] = mapped_column(String(160), nullable=True)


class MatchPlayer(Base):
    """Lineup slot and match stats for one player in one game, only when AthleteOne sends them."""

    __tablename__ = "match_player"
    __table_args__ = (UniqueConstraint("game_id", "source_player_id", name="uq_match_player"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("game.id", ondelete="CASCADE"), nullable=False, index=True)
    player_id: Mapped[int | None] = mapped_column(ForeignKey("player.id", ondelete="SET NULL"), nullable=True)
    source_player_id: Mapped[int] = mapped_column(Integer, nullable=False)
    lineup_slot: Mapped[str | None] = mapped_column(String(40), nullable=True)
    minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    yellow_cards: Mapped[int | None] = mapped_column(Integer, nullable=True)
    red_cards: Mapped[int | None] = mapped_column(Integer, nullable=True)
    formation: Mapped[str | None] = mapped_column(String(32), nullable=True)


class TeamRating(Base):
    """RPI, strength of schedule, and national rank. Conference rank stays on the standings table."""

    __tablename__ = "team_rating"
    __table_args__ = (UniqueConstraint("gender", "tier", "age_group", "source_team_id", name="uq_team_rating"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    source_team_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    team_id: Mapped[int | None] = mapped_column(ForeignKey("team.id", ondelete="SET NULL"), nullable=True, index=True)
    gender: Mapped[str] = mapped_column(String(8), nullable=False)
    tier: Mapped[str] = mapped_column(String(16), nullable=False)
    age_group: Mapped[str] = mapped_column(String(16), nullable=False)
    rpi: Mapped[float | None] = mapped_column(Float, nullable=True)
    strength_of_schedule: Mapped[float | None] = mapped_column(Float, nullable=True)
    national_rank: Mapped[int | None] = mapped_column(Integer, nullable=True)


class PlayoffPicture(Base):
    """National playoff status for one squad. Seed stays here, separate from conference rank."""

    __tablename__ = "playoff_picture"
    __table_args__ = (UniqueConstraint("gender", "tier", "age_group", "source_team_id", name="uq_playoff_picture"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    source_team_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    team_id: Mapped[int | None] = mapped_column(ForeignKey("team.id", ondelete="SET NULL"), nullable=True)
    gender: Mapped[str] = mapped_column(String(8), nullable=False)
    tier: Mapped[str] = mapped_column(String(16), nullable=False)
    age_group: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str | None] = mapped_column(String(80), nullable=True)
    playoff_seed: Mapped[int | None] = mapped_column(Integer, nullable=True)


class WildcardCutoff(Base):
    """Points-per-game cutoff for a gender, tier, and age. No row is stored when the feed omits it."""

    __tablename__ = "wildcard_cutoff"
    __table_args__ = (UniqueConstraint("gender", "tier", "age_group", name="uq_wildcard_cutoff"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    gender: Mapped[str] = mapped_column(String(8), nullable=False)
    tier: Mapped[str] = mapped_column(String(16), nullable=False)
    age_group: Mapped[str] = mapped_column(String(16), nullable=False)
    points_per_game: Mapped[float] = mapped_column(Float, nullable=False)


class Showcase(Base):
    """National showcase catalog entry, keyed by the AthleteOne id when one is published."""

    __tablename__ = "showcase"

    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[int | None] = mapped_column(Integer, nullable=True, unique=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    season: Mapped[str | None] = mapped_column(String(16), nullable=True)
    gender: Mapped[str | None] = mapped_column(String(8), nullable=True)
    tier: Mapped[str | None] = mapped_column(String(16), nullable=True)


class ScoutAttendance(Base):
    """Scout attendance for an event or game. Contact details are not stored."""

    __tablename__ = "scout_attendance"

    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[int | None] = mapped_column(Integer, nullable=True, unique=True)
    event_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    game_id: Mapped[int | None] = mapped_column(ForeignKey("game.id", ondelete="SET NULL"), nullable=True)
    name: Mapped[str | None] = mapped_column(String(160), nullable=True)


class CollegeCoach(Base):
    """College coach directory: name, school, and role only."""

    __tablename__ = "college_coach"
    __table_args__ = (UniqueConstraint("name", "school", "role", name="uq_college_coach"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    school: Mapped[str] = mapped_column(String(160), nullable=False)
    role: Mapped[str | None] = mapped_column(String(80), nullable=True)


class GameWeather(Base):
    """One weather snapshot for an upcoming game. Old games are not kept."""

    __tablename__ = "game_weather"

    id: Mapped[int] = mapped_column(primary_key=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("game.id", ondelete="CASCADE"), nullable=False, unique=True)
    summary: Mapped[str | None] = mapped_column(String(200), nullable=True)
    temperature: Mapped[float | None] = mapped_column(Float, nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class MatchEvent(Base):
    """A real-time match event for an upcoming game. Old games are not kept."""

    __tablename__ = "match_event"
    __table_args__ = (UniqueConstraint("game_id", "source_id", name="uq_match_event"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("game.id", ondelete="CASCADE"), nullable=False, index=True)
    source_id: Mapped[int] = mapped_column(Integer, nullable=False)
    minute: Mapped[int | None] = mapped_column(Integer, nullable=True)
    kind: Mapped[str | None] = mapped_column(String(40), nullable=True)
    detail: Mapped[str | None] = mapped_column(String(240), nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


def _utc_now() -> datetime:
    return datetime.now(UTC)


class VenueRating(Base):
    """One family's stars for a complex. A second submit from the same browser profile updates this row."""

    __tablename__ = "venue_rating"
    __table_args__ = (
        UniqueConstraint("venue_key", "author_key", name="uq_venue_rating_author"),
        CheckConstraint("field_quality BETWEEN 1 AND 5", name="ck_venue_rating_field_quality"),
        CheckConstraint("referees BETWEEN 1 AND 5", name="ck_venue_rating_referees"),
        CheckConstraint("parent_vibe BETWEEN 1 AND 5", name="ck_venue_rating_parent_vibe"),
        CheckConstraint("parking_access BETWEEN 1 AND 5", name="ck_venue_rating_parking_access"),
        CheckConstraint("amenities BETWEEN 1 AND 5", name="ck_venue_rating_amenities"),
        CheckConstraint(
            "surface_vote IS NULL OR surface_vote IN ('GRASS', 'TURF', 'MIXED')",
            name="ck_venue_rating_surface",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    venue_key: Mapped[str] = mapped_column(String(300), nullable=False, index=True)
    venue_name: Mapped[str] = mapped_column(String(160), nullable=False)
    city: Mapped[str] = mapped_column(String(80), nullable=False)
    state: Mapped[str] = mapped_column(String(2), nullable=False)
    author_key: Mapped[str] = mapped_column(String(80), nullable=False)
    user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    author_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    field_quality: Mapped[int] = mapped_column(Integer, nullable=False)
    referees: Mapped[int] = mapped_column(Integer, nullable=False)
    parent_vibe: Mapped[int] = mapped_column(Integer, nullable=False)
    parking_access: Mapped[int] = mapped_column(Integer, nullable=False)
    amenities: Mapped[int] = mapped_column(Integer, nullable=False)
    surface_vote: Mapped[str | None] = mapped_column(String(8), nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utc_now)


class VenueRecommendation(Base):
    """A hotel, meal, between-game stop, or sideline tip for one complex."""

    __tablename__ = "venue_recommendation"
    __table_args__ = (
        CheckConstraint(
            "category IN ('HOTEL', 'RESTAURANT', 'COFFEE_GAP', 'ACTIVITY', 'SIDELINE_TIP')",
            name="ck_venue_recommendation_category",
        ),
        CheckConstraint("rating BETWEEN 1 AND 5", name="ck_venue_recommendation_rating"),
        CheckConstraint("upvotes >= 0", name="ck_venue_recommendation_upvotes"),
        CheckConstraint("downvotes >= 0", name="ck_venue_recommendation_downvotes"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    venue_key: Mapped[str] = mapped_column(String(300), nullable=False, index=True)
    venue_name: Mapped[str] = mapped_column(String(160), nullable=False)
    city: Mapped[str] = mapped_column(String(80), nullable=False)
    state: Mapped[str] = mapped_column(String(2), nullable=False)
    category: Mapped[str] = mapped_column(String(16), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    review_text: Mapped[str] = mapped_column(Text, nullable=False)
    tags: Mapped[str | None] = mapped_column(Text, nullable=True)
    author_name: Mapped[str] = mapped_column(String(80), nullable=False, default="ECNL Family", server_default="ECNL Family")
    author_key: Mapped[str] = mapped_column(String(80), nullable=False)
    user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    upvotes: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    downvotes: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utc_now)


class VenueTipVote(Base):
    """The current thumbs up or down from one browser profile. A later vote updates this row."""

    __tablename__ = "venue_tip_vote"
    __table_args__ = (
        UniqueConstraint("recommendation_id", "author_key", name="uq_venue_tip_vote_author"),
        CheckConstraint("choice IN ('up', 'down')", name="ck_venue_tip_vote_choice"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    recommendation_id: Mapped[int] = mapped_column(
        ForeignKey("venue_recommendation.id", ondelete="CASCADE"), nullable=False
    )
    author_key: Mapped[str] = mapped_column(String(80), nullable=False)
    choice: Mapped[str] = mapped_column(String(8), nullable=False)
