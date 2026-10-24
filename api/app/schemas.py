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
    tier: str
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
    form: list[Literal["W", "L", "D"]] = []


class CountRecord(BaseModel):
    gp: int
    w: int
    l: int
    d: int
    gf: int
    ga: int
    gd: int
    pts: int
    ppg: float


class SplitRecord(BaseModel):
    gp: int
    w: int
    l: int
    d: int
    ppg: float


class FormGameOut(BaseModel):
    game_id: int
    date: str
    opponent_name: str
    result: TeamResult
    score: str
    venue_type: VenueType


class TeamTapeOut(BaseModel):
    team_id: int
    name: str
    age_group: str
    tier: str
    conference: str
    conference_rank: int | None
    official_ppg: float | None
    overall_record: CountRecord
    home_record: SplitRecord
    away_record: SplitRecord
    avg_gf: float
    avg_ga: float
    last_5_form: list[FormGameOut]


class DirectMatchOut(BaseModel):
    game_id: int
    date: str
    kickoff_time: str | None
    complex_name: str
    field_number: str | None
    city: str
    state: str
    status: GameStatus
    home_team_id: int
    away_team_id: int
    home_score: int | None
    away_score: int | None
    venue_type: VenueType
    team_a_result: TeamResult | None
    team_b_result: TeamResult | None
    winner: Literal["team_a", "team_b", "draw"] | None


class DirectSummaryOut(BaseModel):
    team_a_wins: int
    team_b_wins: int
    draws: int
    team_a_goals: int
    team_b_goals: int


class DirectMeetingsOut(BaseModel):
    summary: DirectSummaryOut
    games: list[DirectMatchOut]


class CommonGameOut(BaseModel):
    game_id: int
    date: str
    status: GameStatus
    venue_type: Literal["H", "A", "N"]
    team_score: int | None
    opponent_score: int | None
    result: Literal["W", "L", "D", "Scheduled"] | None


class OpponentMiniOut(BaseModel):
    gp: int
    pts: int
    ppg: float
    gf: int
    ga: int
    gd: int


class CommonOpponentOut(BaseModel):
    id: int
    name: str
    conference_rank: int | None
    conference_ppg: float | None
    team_a_games: list[CommonGameOut]
    team_b_games: list[CommonGameOut]
    team_a_summary: OpponentMiniOut
    team_b_summary: OpponentMiniOut
    advantage: Literal["team_a", "team_b", "even", "incomplete"]


class RollupOut(BaseModel):
    gp: int
    w: int
    l: int
    d: int
    gf: int
    ga: int
    gd: int
    ppg: float


class CommonRollupOut(BaseModel):
    team_a_vs_common: RollupOut
    team_b_vs_common: RollupOut


class HeadToHeadOut(BaseModel):
    team_a_stats: TeamTapeOut
    team_b_stats: TeamTapeOut
    direct_matches: DirectMeetingsOut
    common_opponents: list[CommonOpponentOut]
    common_opponents_rollup: CommonRollupOut
