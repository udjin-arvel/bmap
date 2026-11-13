from __future__ import annotations

import uuid
from typing import Any

from pydantic import ValidationError

from fastapi import HTTPException

from app.ai.deepseek import generate_expand_steps
from app.ai.hub import editor_hub
from app.ai.jobs import job_store
from app.ai.schemas import ExpandStep, ExpandStepsPayload
from app.graph import service as graph_service
from app.graph.errors import graph_error
from app.graph.schemas import COLOR_PALETTE, MarketEdgeOut, MarketNodeFull

STEP_X = 280.0
STEP_Y = 120.0


async def has_ai_outgoing(node_id: str) -> bool:
    from app.db import neo4j as neo4j_db

    driver = neo4j_db.get_driver()
    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (n:MarketNode {id: $id})-[:NEXT_STEP*1..]->(d:MarketNode)
            WHERE d.origin = 'ai'
            RETURN count(d) > 0 AS v
            """,
            id=node_id,
        )
        rec = await result.single()
        if rec and rec["v"]:
            return True
        result2 = await session.run(
            """
            MATCH (u:MarketNode {origin: 'ai'})-[:NEXT_STEP*1..]->(n:MarketNode {id: $id})
            RETURN count(u) > 0 AS v
            """,
            id=node_id,
        )
        rec2 = await result2.single()
        return bool(rec2 and rec2["v"])


async def remove_ai_chains_around(anchor_id: str) -> None:
    from app.db import neo4j as neo4j_db

    driver = neo4j_db.get_driver()
    async with driver.session() as session:
        await session.run(
            """
            MATCH (anchor:MarketNode {id: $id})
            OPTIONAL MATCH (anchor)-[:NEXT_STEP*]->(down:MarketNode {origin: 'ai'})
            DETACH DELETE down
            """,
            id=anchor_id,
        )
        await session.run(
            """
            MATCH (anchor:MarketNode {id: $id})
            OPTIONAL MATCH (up:MarketNode {origin: 'ai'})-[:NEXT_STEP*]->(anchor)
            DETACH DELETE up
            """,
            id=anchor_id,
        )


def _parse_steps(raw: dict[str, Any], anchor: MarketNodeFull) -> list[ExpandStep]:
    try:
        payload = ExpandStepsPayload.model_validate(raw)
    except ValidationError as exc:
        raise graph_error(400, "UNKNOWN", f"Invalid AI JSON: {exc}") from exc

    steps = payload.steps
    if len(steps) < 3 or len(steps) > 16:
        raise graph_error(400, "UNKNOWN", "AI must return 3–16 steps")

    anchor_indices = [i for i, s in enumerate(steps) if s.anchor]
    anchor_idx: int
    if anchor_indices:
        anchor_idx = anchor_indices[0]
    else:
        match = next(
            (i for i, s in enumerate(steps) if s.name.strip().lower() == anchor.name.strip().lower()),
            None,
        )
        if match is None:
            raise graph_error(400, "UNKNOWN", "AI response must mark the anchor step")
        anchor_idx = match

    normalized: list[ExpandStep] = []
    for i, s in enumerate(steps):
        if s.nodeType not in ("PROCESS", "ACTOR", "RESOURCE", "LOGISTICS"):
            raise graph_error(400, "UNKNOWN", f"Invalid nodeType: {s.nodeType}")
        if s.color is not None and s.color not in COLOR_PALETTE:
            raise graph_error(400, "INVALID_COLOR", "Color not in palette")
        normalized.append(s.model_copy(update={"anchor": i == anchor_idx}))

    return normalized


async def _occupied_positions() -> list[tuple[float, float]]:
    from app.db import neo4j as neo4j_db

    driver = neo4j_db.get_driver()
    async with driver.session() as session:
        result = await session.run(
            "MATCH (n:MarketNode) RETURN n.positionX AS x, n.positionY AS y"
        )
        pts: list[tuple[float, float]] = []
        async for rec in result:
            pts.append((float(rec["x"]), float(rec["y"])))
        return pts


def _avoid_overlap(x: float, y: float, occupied: list[tuple[float, float]]) -> tuple[float, float]:
    while any(abs(x - ox) < 200 and abs(y - oy) < 80 for ox, oy in occupied):
        y += STEP_Y
    occupied.append((x, y))
    return x, y


async def apply_expand_steps(anchor_id: str, steps: list[ExpandStep]) -> tuple[list[MarketNodeFull], list[MarketEdgeOut]]:
    from app.db import neo4j as neo4j_db

    anchor = await graph_service.get_node(anchor_id)
    anchor_idx = next(i for i, s in enumerate(steps) if s.anchor)
    occupied = await _occupied_positions()
    now = graph_service._now_iso()

    node_ids: list[str] = []
    new_nodes: list[MarketNodeFull] = []
    new_edges: list[MarketEdgeOut] = []

    for i, step in enumerate(steps):
        if step.anchor:
            node_ids.append(anchor_id)
            continue

        x = anchor.positionX + (i - anchor_idx) * STEP_X
        y = anchor.positionY
        x, y = _avoid_overlap(x, y, occupied)
        node_id = str(uuid.uuid4())
        props = {
            "id": node_id,
            "name": step.name.strip(),
            "nodeType": step.nodeType,
            "description": step.description,
            "color": step.color,
            "note": None,
            "positionX": x,
            "positionY": y,
            "descriptionPinned": False,
            "isBase": False,
            "origin": "ai",
            "createdAt": now,
            "updatedAt": now,
        }
        node_ids.append(node_id)
        new_nodes.append(graph_service._full_node(props))

    driver = neo4j_db.get_driver()
    async with driver.session() as session:
        for n in new_nodes:
            raw = {
                "id": n.id,
                "name": n.name,
                "nodeType": n.nodeType,
                "description": n.description,
                "color": n.color,
                "note": n.note,
                "positionX": n.positionX,
                "positionY": n.positionY,
                "descriptionPinned": False,
                "isBase": False,
                "origin": "ai",
                "createdAt": n.createdAt,
                "updatedAt": n.updatedAt,
            }
            await session.run("CREATE (node:MarketNode) SET node = $props", props=raw)

        for i in range(len(node_ids) - 1):
            src, tgt = node_ids[i], node_ids[i + 1]
            if await graph_service._would_create_cycle(session, src, tgt):
                raise graph_error(400, "CYCLE_DETECTED", "AI chain would create a cycle")
            edge_id = str(uuid.uuid4())
            await session.run(
                """
                MATCH (s:MarketNode {id: $sourceId})
                MATCH (t:MarketNode {id: $targetId})
                CREATE (s)-[r:NEXT_STEP {id: $edgeId, createdAt: $createdAt}]->(t)
                """,
                sourceId=src,
                targetId=tgt,
                edgeId=edge_id,
                createdAt=now,
            )
            new_edges.append(
                MarketEdgeOut(id=edge_id, sourceId=src, targetId=tgt, createdAt=now)
            )

    return new_nodes, new_edges


async def run_expand_job(job_id: str, anchor_id: str, force: bool) -> None:
    await job_store.update(job_id, status="running")
    await editor_hub.broadcast(
        {
            "type": "ai.status",
            "jobId": job_id,
            "nodeId": anchor_id,
            "status": "running",
        }
    )
    try:
        anchor = await graph_service.get_node(anchor_id)
        if force:
            await remove_ai_chains_around(anchor_id)

        raw = await generate_expand_steps(anchor.name, anchor.nodeType)
        steps = _parse_steps(raw, anchor)
        nodes, edges = await apply_expand_steps(anchor_id, steps)

        await job_store.update(job_id, status="completed", nodes=nodes, edges=edges)
        await editor_hub.broadcast(
            {
                "type": "graph.patch",
                "jobId": job_id,
                "nodeId": anchor_id,
                "nodes": [n.model_dump() for n in nodes],
                "edges": [e.model_dump() for e in edges],
            }
        )
        await editor_hub.broadcast(
            {
                "type": "ai.status",
                "jobId": job_id,
                "nodeId": anchor_id,
                "status": "completed",
            }
        )
    except HTTPException as exc:
        detail = exc.detail
        if isinstance(detail, dict) and "detail" in detail:
            msg = str(detail["detail"])
        else:
            msg = str(detail)
    except Exception as exc:
        msg = str(exc)
        await job_store.update(job_id, status="error", error=msg)
        await editor_hub.broadcast(
            {
                "type": "ai.status",
                "jobId": job_id,
                "nodeId": anchor_id,
                "status": "error",
                "message": msg,
            }
        )


async def start_expand(anchor_id: str, force: bool) -> str:
    await graph_service.get_node(anchor_id)
    if not force and await has_ai_outgoing(anchor_id):
        raise graph_error(
            409,
            "AI_CHAIN_EXISTS",
            "Node already has an AI continuation; confirm to replace",
        )

    job = await job_store.create(anchor_id)
    import asyncio as asyncio_mod

    asyncio_mod.create_task(run_expand_job(job.id, anchor_id, force))
    return job.id
