"""Copy an ingested final score onto the published league game when the clubs and date match."""

from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.ingestion.normalizer import standardize_team_name
from app.ingestion.upsert import ParsedScore
from app.models import ScheduleGame

EASTERN = ZoneInfo("America/New_York")


def apply_league_scores(session: Session, scores: list[ParsedScore]) -> int:
    updated = 0
    try:
        for score in scores:
            home_name = standardize_team_name(score.home_name).casefold()
            away_name = standardize_team_name(score.away_name).casefold()
            window_start = datetime.combine(score.game_date - timedelta(days=2), time.min, tzinfo=timezone.utc)
            window_end = datetime.combine(score.game_date + timedelta(days=3), time.min, tzinfo=timezone.utc)
            candidates = session.scalars(
                select(ScheduleGame)
                .options(selectinload(ScheduleGame.home_team), selectinload(ScheduleGame.away_team))
                .where(ScheduleGame.starts_at >= window_start, ScheduleGame.starts_at < window_end)
            ).all()
            for game in candidates:
                try:
                    zone = ZoneInfo(game.timezone or "America/New_York")
                except Exception:
                    zone = EASTERN
                if game.starts_at.astimezone(zone).date() != score.game_date:
                    continue
                home = standardize_team_name(game.home_team.name).casefold()
                away = standardize_team_name(game.away_team.name).casefold()
                if home == home_name and away == away_name:
                    game.home_score = score.home_score
                    game.away_score = score.away_score
                elif home == away_name and away == home_name:
                    game.home_score = score.away_score
                    game.away_score = score.home_score
                else:
                    continue
                game.status = "COMPLETED"
                updated += 1
        session.commit()
    except Exception:
        session.rollback()
        raise
    return updated
