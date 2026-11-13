from __future__ import annotations

import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, status

from app.ai.expand import has_ai_outgoing, start_expand
from app.ai.hub import editor_hub, ws_keepalive
from app.ai.jobs import job_store
from app.ai.schemas import AiJobOut, AiOutgoingOut, ExpandRequest, ExpandResponse
from app.auth.schemas import AuthUser
from app.auth.security import decode_token, require_editor
from app.db import sqlite as sqlite_db

router = APIRouter(prefix="/api", tags=["ai"])


async def _ws_editor(token: str) -> AuthUser:
    user = decode_token(token)
    row = await sqlite_db.get_user_by_username(user.username)
    if row is None or row["role"] != "editor":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
    return AuthUser(username=user.username, role=row["role"])


@router.websocket("/ws")
async def editor_ws(websocket: WebSocket, token: Annotated[str, Query()]):
    try:
        await _ws_editor(token)
    except HTTPException:
        await websocket.close(code=4403)
        return

    await websocket.accept()
    await editor_hub.register(websocket)
    try:
        await ws_keepalive(websocket)
    finally:
        await editor_hub.unregister(websocket)


@router.get("/nodes/{node_id}/ai-outgoing", response_model=AiOutgoingOut)
async def ai_outgoing(node_id: str) -> AiOutgoingOut:
    return AiOutgoingOut(hasAiOutgoing=await has_ai_outgoing(node_id))


@router.post("/nodes/{node_id}/expand", response_model=ExpandResponse)
async def expand_node(
    node_id: str,
    body: ExpandRequest,
    _user: Annotated[AuthUser, Depends(require_editor)],
) -> ExpandResponse:
    job_id = await start_expand(node_id, body.force)
    return ExpandResponse(jobId=job_id)


@router.get("/ai/jobs/{job_id}", response_model=AiJobOut)
async def get_job(
    job_id: str,
    _user: Annotated[AuthUser, Depends(require_editor)],
) -> AiJobOut:
    job = await job_store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail={"detail": "Job not found", "code": "UNKNOWN"})
    return job_store.to_out(job)
