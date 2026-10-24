from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import SQLModel

from app.database import engine
from app.models import Base
from app.routers.ingest import router as ingest_router
from app.routers.teams import router as teams_router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(engine)
    SQLModel.metadata.create_all(engine)
    yield


app = FastAPI(title="ECNL Boys Southeast Schedule", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(teams_router)
app.include_router(ingest_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
