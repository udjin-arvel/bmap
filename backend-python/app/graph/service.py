from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.db import neo4j as neo4j_db
from app.db import sqlite as sqlite_db
from app.graph.errors import graph_error
from app.graph.schemas import (
    BatchPatchItem,
    EdgeCreate,
    GraphOut,
    GraphRootOut,
    MarketEdgeOut,
    MarketNodeFull,
    MarketNodeListItem,
    NodeCreate,
    NodeUpdate,
)

SEEDS_PATH = Path(__file__).resolve().parent.parent / "seeds" / "base_markets.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _props_to_node(props: dict[str, Any]) -> dict[str, Any]:
    description = props.get("description")
    pinned = bool(props.get("descriptionPinned", False))
    has_desc = description is not None and str(description).strip() != ""
    return {
        "id": props["id"],
        "name": props["name"],
        "nodeType": props["nodeType"],
        "color": props.get("color"),
        "note": props.get("note"),
        "positionX": float(props.get("positionX", 0)),
        "positionY": float(props.get("positionY", 0)),
        "descriptionPinned": pinned,
        "hasDescription": has_desc,
        "isBase": bool(props.get("isBase", False)),
        "origin": props.get("origin") or "user",
        "createdAt": props.get("createdAt") or _now_iso(),
        "updatedAt": props.get("updatedAt") or _now_iso(),
        "_rawDescription": description,
    }


def _list_item(raw: dict[str, Any]) -> MarketNodeListItem:
    n = _props_to_node(raw)
    desc = n.pop("_rawDescription", None)
    pinned = n["descriptionPinned"]
    n["description"] = desc if pinned else None
    n["hasDescription"] = bool(desc and str(desc).strip())
    return MarketNodeListItem(**n)


def _full_node(raw: dict[str, Any]) -> MarketNodeFull:
    n = _props_to_node(raw)
    desc = n.pop("_rawDescription", None)
    n["description"] = desc
    n["hasDescription"] = bool(desc and str(desc).strip())
    return MarketNodeFull(**n)


async def ensure_schema() -> None:
    driver = neo4j_db.get_driver()
    statements = [
        "CREATE CONSTRAINT market_node_id IF NOT EXISTS FOR (n:MarketNode) REQUIRE n.id IS UNIQUE",
        "CREATE INDEX market_node_name IF NOT EXISTS FOR (n:MarketNode) ON (n.name)",
        "CREATE INDEX market_node_type IF NOT EXISTS FOR (n:MarketNode) ON (n.nodeType)",
    ]
    async with driver.session() as session:
        for stmt in statements:
            await session.run(stmt)


async def apply_base_seeds() -> None:
    if not SEEDS_PATH.is_file():
        return
    seeds = json.loads(SEEDS_PATH.read_text(encoding="utf-8"))
    driver = neo4j_db.get_driver()
    for entry in seeds:
        seed_id = entry["id"]
        if await sqlite_db.is_seed_applied(seed_id):
            continue
        now = _now_iso()
        props = {
            "id": seed_id,
            "name": entry["name"],
            "nodeType": entry["nodeType"],
            "description": entry.get("description"),
            "color": entry.get("color"),
            "note": None,
            "positionX": float(entry.get("positionX", 0)),
            "positionY": float(entry.get("positionY", 0)),
            "descriptionPinned": bool(entry.get("descriptionPinned", False)),
            "isBase": True,
            "origin": "base",
            "createdAt": now,
            "updatedAt": now,
        }
        async with driver.session() as session:
            await session.run(
                """
                MERGE (n:MarketNode {id: $id})
                ON CREATE SET n = $props
                """,
                id=seed_id,
                props=props,
            )
        await sqlite_db.mark_seed_applied(seed_id)


async def _node_ids_for_focus(focus_id: str) -> set[str]:
    driver = neo4j_db.get_driver()
    async with driver.session() as session:
        exists = await session.run(
            "MATCH (f:MarketNode {id: $id}) RETURN f.id AS id LIMIT 1",
            id=focus_id,
        )
        if await exists.single() is None:
            raise graph_error(404, "NODE_NOT_FOUND", "Node not found")

        down = await session.run(
            """
            MATCH (f:MarketNode {id: $id})
            MATCH (f)-[:NEXT_STEP*0..]->(n:MarketNode)
            RETURN collect(DISTINCT n.id) AS ids
            """,
            id=focus_id,
        )
        down_rec = await down.single()
        ids = set(down_rec["ids"] if down_rec else [])

        up = await session.run(
            """
            MATCH (f:MarketNode {id: $id})
            MATCH (n:MarketNode)-[:NEXT_STEP*0..]->(f)
            RETURN collect(DISTINCT n.id) AS ids
            """,
            id=focus_id,
        )
        up_rec = await up.single()
        if up_rec:
            ids.update(up_rec["ids"])
        return ids


async def get_graph(focus_id: str | None = None) -> GraphOut:
    driver = neo4j_db.get_driver()
    allowed: set[str] | None = None
    if focus_id:
        allowed = await _node_ids_for_focus(focus_id)

    async with driver.session() as session:
        nodes_result = await session.run("MATCH (n:MarketNode) RETURN n")
        nodes: list[MarketNodeListItem] = []
        async for record in nodes_result:
            props = dict(record["n"])
            if allowed is not None and props["id"] not in allowed:
                continue
            nodes.append(_list_item(props))

        edges_result = await session.run(
            """
            MATCH (s:MarketNode)-[r:NEXT_STEP]->(t:MarketNode)
            RETURN r.id AS id, s.id AS sourceId, t.id AS targetId, r.createdAt AS createdAt
            """
        )
        edges: list[MarketEdgeOut] = []
        async for record in edges_result:
            if allowed is not None and (
                record["sourceId"] not in allowed or record["targetId"] not in allowed
            ):
                continue
            edges.append(
                MarketEdgeOut(
                    id=record["id"],
                    sourceId=record["sourceId"],
                    targetId=record["targetId"],
                    createdAt=record["createdAt"],
                )
            )

    return GraphOut(nodes=nodes, edges=edges)


async def get_roots() -> list[GraphRootOut]:
    driver = neo4j_db.get_driver()
    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (n:MarketNode)
            WHERE coalesce(n.isBase, false) = true
               OR NOT EXISTS { ()-[:NEXT_STEP]->(n) }
            OPTIONAL MATCH (n)-[:NEXT_STEP]->(c:MarketNode)
            WITH n, count(c) AS childCount
            RETURN n.id AS id, n.name AS name, coalesce(n.isBase, false) AS isBase, childCount
            ORDER BY n.name
            """
        )
        roots: list[GraphRootOut] = []
        async for record in result:
            roots.append(
                GraphRootOut(
                    id=record["id"],
                    name=record["name"],
                    isBase=bool(record["isBase"]),
                    childCount=int(record["childCount"]),
                )
            )
        return roots


async def get_node(node_id: str) -> MarketNodeFull:
    driver = neo4j_db.get_driver()
    async with driver.session() as session:
        result = await session.run(
            "MATCH (n:MarketNode {id: $id}) RETURN n LIMIT 1",
            id=node_id,
        )
        record = await result.single()
        if record is None:
            raise graph_error(404, "NODE_NOT_FOUND", "Node not found")
        return _full_node(dict(record["n"]))


async def create_node(body: NodeCreate) -> MarketNodeFull:
    driver = neo4j_db.get_driver()
    node_id = body.id or str(uuid.uuid4())
    now = _now_iso()
    pinned = body.descriptionPinned if body.descriptionPinned is not None else False
    if body.description and body.description.strip() and body.descriptionPinned is None:
        pinned = False

    props = {
        "id": node_id,
        "name": body.name.strip(),
        "nodeType": body.nodeType,
        "description": body.description,
        "color": body.color,
        "note": body.note,
        "positionX": float(body.positionX),
        "positionY": float(body.positionY),
        "descriptionPinned": pinned,
        "isBase": False,
        "origin": "user",
        "createdAt": now,
        "updatedAt": now,
    }

    async with driver.session() as session:
        exists = await session.run(
            "MATCH (n:MarketNode {id: $id}) RETURN n LIMIT 1",
            id=node_id,
        )
        if await exists.single() is not None:
            raise graph_error(400, "UNKNOWN", "Node id already exists")

        await session.run(
            "CREATE (n:MarketNode) SET n = $props",
            props=props,
        )
    return _full_node(props)


async def update_node(node_id: str, patch: NodeUpdate) -> None:
    driver = neo4j_db.get_driver()
    data = patch.model_dump(exclude_unset=True)
    if not data:
        return

    async with driver.session() as session:
        result = await session.run(
            "MATCH (n:MarketNode {id: $id}) RETURN n LIMIT 1",
            id=node_id,
        )
        record = await result.single()
        if record is None:
            raise graph_error(404, "NODE_NOT_FOUND", "Node not found")

        props = dict(record["n"])
        for key, value in data.items():
            props[key] = value
        props["updatedAt"] = _now_iso()

        await session.run(
            "MATCH (n:MarketNode {id: $id}) SET n = $props",
            id=node_id,
            props=props,
        )


async def delete_node(node_id: str) -> None:
    driver = neo4j_db.get_driver()
    async with driver.session() as session:
        result = await session.run(
            "MATCH (n:MarketNode {id: $id}) DETACH DELETE n RETURN count(n) AS c",
            id=node_id,
        )
        record = await result.single()
        if not record or record["c"] == 0:
            raise graph_error(404, "NODE_NOT_FOUND", "Node not found")


async def batch_patch(items: list[BatchPatchItem]) -> None:
    driver = neo4j_db.get_driver()
    async with driver.session() as session:
        for item in items:
            data = item.model_dump(exclude={"id"}, exclude_unset=True)
            if not data:
                continue
            result = await session.run(
                "MATCH (n:MarketNode {id: $id}) RETURN n LIMIT 1",
                id=item.id,
            )
            record = await result.single()
            if record is None:
                continue
            props = dict(record["n"])
            for key, value in data.items():
                props[key] = value
            props["updatedAt"] = _now_iso()
            await session.run(
                "MATCH (n:MarketNode {id: $id}) SET n = $props",
                id=item.id,
                props=props,
            )


async def _would_create_cycle(session, source_id: str, target_id: str) -> bool:
    result = await session.run(
        """
        MATCH (target:MarketNode {id: $targetId})
        MATCH (target)-[:NEXT_STEP*]->(source:MarketNode {id: $sourceId})
        RETURN count(source) > 0 AS cycle
        """,
        sourceId=source_id,
        targetId=target_id,
    )
    record = await result.single()
    return bool(record and record["cycle"])


async def create_edge(body: EdgeCreate) -> MarketEdgeOut:
    if body.sourceId == body.targetId:
        raise graph_error(400, "SELF_CONNECTION", "Cannot connect node to itself")

    driver = neo4j_db.get_driver()
    edge_id = str(uuid.uuid4())
    now = _now_iso()

    async with driver.session() as session:
        nodes = await session.run(
            """
            MATCH (s:MarketNode {id: $sourceId})
            MATCH (t:MarketNode {id: $targetId})
            RETURN s, t
            """,
            sourceId=body.sourceId,
            targetId=body.targetId,
        )
        if await nodes.single() is None:
            raise graph_error(404, "NODE_NOT_FOUND", "Node not found")

        dup = await session.run(
            """
            MATCH (s:MarketNode {id: $sourceId})-[r:NEXT_STEP]->(t:MarketNode {id: $targetId})
            RETURN r LIMIT 1
            """,
            sourceId=body.sourceId,
            targetId=body.targetId,
        )
        if await dup.single() is not None:
            raise graph_error(400, "DUPLICATE_EDGE", "Edge already exists")

        if await _would_create_cycle(session, body.sourceId, body.targetId):
            raise graph_error(400, "CYCLE_DETECTED", "Edge would create a cycle")

        await session.run(
            """
            MATCH (s:MarketNode {id: $sourceId})
            MATCH (t:MarketNode {id: $targetId})
            CREATE (s)-[r:NEXT_STEP {id: $edgeId, createdAt: $createdAt}]->(t)
            """,
            sourceId=body.sourceId,
            targetId=body.targetId,
            edgeId=edge_id,
            createdAt=now,
        )

    return MarketEdgeOut(
        id=edge_id,
        sourceId=body.sourceId,
        targetId=body.targetId,
        createdAt=now,
    )


async def delete_edge(edge_id: str) -> None:
    driver = neo4j_db.get_driver()
    async with driver.session() as session:
        result = await session.run(
            "MATCH ()-[r:NEXT_STEP {id: $id}]->() DELETE r RETURN count(r) AS c",
            id=edge_id,
        )
        record = await result.single()
        if not record or record["c"] == 0:
            raise graph_error(404, "NODE_NOT_FOUND", "Edge not found")
