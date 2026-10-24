from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

GameStatus = Literal["SCHEDULED", "COMPLETED", "POSTPONED", "CANCELLED"]
VenueType = Literal["Home", "Away", "Showcase"]
TeamResult = Literal["W", "L", "D"]


class TeamOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    age_group: str
    conference: str
    city: str
    state: str


class OpponentOut(BaseModel):
    id: int
    name: str


class ScheduleGameOut(BaseModel):
    id: int
    starts_at: datetime
    opponent: OpponentOut
    side: Literal["home", "away"]
    venue_name: str
    city: str
    state: str
    timezone: str
    event: str | None
    status: GameStatus
    home_score: int | None
    away_score: int | None
    is_conference_game: bool
    venue_type: VenueType
    team_result: TeamResult | None


class TeamRecordSummary(BaseModel):
    overall_record: str
    conference_record: str
    goals_for: int
    goals_against: int
    ppg: float
    conference_rank: int | None
    conference: str


class ScheduleResponse(BaseModel):
    team_record_summary: TeamRecordSummary
    games: list[ScheduleGameOut]


class StandingOut(BaseModel):
    rank: int
    team_id: int | None
    team_name: str
    games_played: int
    wins: int
    losses: int
    draws: int
    goals_for: int
    goals_against: int
    goal_diff: int
    points: int
    points_per_game: float
