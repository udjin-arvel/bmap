from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import TypeAdapter, ValidationError

from app.auth.schemas import AuthUser
from app.auth.security import require_editor
from app.graph import service
from app.graph.errors import graph_error
from app.graph.schemas import (
    BatchPatchItem,
    EdgeCreate,
    GraphOut,
    GraphRootOut,
    MarketEdgeOut,
    MarketNodeFull,
    NodeCreate,
    NodeUpdate,
)

router = APIRouter(prefix="/api", tags=["graph"])

_batch_adapter = TypeAdapter(list[BatchPatchItem])


@router.get("/graph/roots", response_model=list[GraphRootOut])
async def graph_roots() -> list[GraphRootOut]:
    return await service.get_roots()


@router.get("/graph", response_model=GraphOut)
async def get_graph(
    focusId: Annotated[str | None, Query(alias="focusId")] = None,
) -> GraphOut:
    return await service.get_graph(focusId)


@router.get("/nodes/{node_id}", response_model=MarketNodeFull)
async def get_node(node_id: str) -> MarketNodeFull:
    return await service.get_node(node_id)


@router.post("/nodes", response_model=MarketNodeFull, status_code=status.HTTP_201_CREATED)
async def create_node(
    body: NodeCreate,
    _user: Annotated[AuthUser, Depends(require_editor)],
) -> MarketNodeFull:
    return await service.create_node(body)


@router.patch("/nodes/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
async def patch_node(
    node_id: str,
    body: NodeUpdate,
    _user: Annotated[AuthUser, Depends(require_editor)],
) -> Response:
    await service.update_node(node_id, body)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/nodes/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_node(
    node_id: str,
    _user: Annotated[AuthUser, Depends(require_editor)],
) -> Response:
    await service.delete_node(node_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/nodes/batch-patch", status_code=status.HTTP_204_NO_CONTENT)
async def batch_patch(
    request: Request,
    _user: Annotated[AuthUser, Depends(require_editor)],
) -> Response:
    raw = await request.body()
    if not raw.strip():
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    try:
        payload = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise graph_error(400, "UNKNOWN", "Invalid JSON body") from exc
    try:
        items = _batch_adapter.validate_python(payload)
    except ValidationError as exc:
        raise graph_error(400, "UNKNOWN", "Invalid batch payload") from exc
    await service.batch_patch(items)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/edges", response_model=MarketEdgeOut, status_code=status.HTTP_201_CREATED)
async def create_edge(
    body: EdgeCreate,
    _user: Annotated[AuthUser, Depends(require_editor)],
) -> MarketEdgeOut:
    return await service.create_edge(body)


@router.delete("/edges/{edge_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_edge(
    edge_id: str,
    _user: Annotated[AuthUser, Depends(require_editor)],
) -> Response:
    await service.delete_edge(edge_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
