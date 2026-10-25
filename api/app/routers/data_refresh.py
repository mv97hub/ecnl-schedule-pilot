from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_session
from app.models import DataRefresh
from app.schemas import DataRefreshOut

router = APIRouter()


@router.get("/data-refresh", response_model=DataRefreshOut)
def last_data_refresh(session: Annotated[Session, Depends(get_session)]) -> DataRefreshOut:
    finished = session.scalar(
        select(DataRefresh.finished_at)
        .where(DataRefresh.status == "success", DataRefresh.finished_at.is_not(None), DataRefresh.job == "schedule")
        .order_by(DataRefresh.finished_at.desc(), DataRefresh.id.desc())
        .limit(1)
    )
    return DataRefreshOut(last_successful_finish=finished)
