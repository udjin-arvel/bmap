from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.ai.router import router as ai_router
from app.auth.router import router as auth_router
from app.config import get_settings
from app.db import neo4j as neo4j_db
from app.db import sqlite as sqlite_db
from app.graph import service as graph_service
from app.graph.router import router as graph_router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await sqlite_db.init_db()
    await sqlite_db.seed_users()
    await neo4j_db.init_driver()
    await graph_service.ensure_schema()
    await graph_service.apply_base_seeds()
    yield
    await neo4j_db.close_driver()
    await sqlite_db.close_db()


app = FastAPI(title="BMap API", lifespan=lifespan)

settings = get_settings()
origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
if origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(graph_router)
app.include_router(ai_router)


@app.get("/api/health")
async def health():
    neo_ok = await neo4j_db.ping()
    sql_ok = await sqlite_db.ping()
    status_text = "ok" if neo_ok and sql_ok else "degraded"
    return {
        "status": status_text,
        "neo4j": "ok" if neo_ok else "error",
        "sqlite": "ok" if sql_ok else "error",
    }
