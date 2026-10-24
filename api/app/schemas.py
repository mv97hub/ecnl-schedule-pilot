from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


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
