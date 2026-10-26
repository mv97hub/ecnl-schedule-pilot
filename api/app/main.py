import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import SQLModel

from app.database import engine, ensure_capture_columns, ensure_result_columns, ensure_source_columns
from app.models import Base
from app.routers.clubs import router as clubs_router
from app.routers.data_refresh import router as data_refresh_router
from app.routers.head_to_head import router as head_to_head_router
from app.routers.ingest import router as ingest_router
from app.routers.standings import router as standings_router
from app.routers.teams import router as teams_router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(engine)
    SQLModel.metadata.create_all(engine)
    ensure_result_columns()
    ensure_source_columns()
    ensure_capture_columns()
    yield


def allowed_origins() -> list[str]:
    """Local dev origins, plus comma-separated ALLOWED_ORIGINS when set."""
    origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
    for piece in os.environ.get("ALLOWED_ORIGINS", "").split(","):
        origin = piece.strip()
        if origin and origin != "*" and origin not in origins:
            origins.append(origin)
    return origins


app = FastAPI(title="ECNL Boys Southeast Schedule", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(data_refresh_router)
app.include_router(teams_router)
app.include_router(standings_router)
app.include_router(head_to_head_router)
app.include_router(clubs_router)
app.include_router(ingest_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
