from __future__ import annotations

from neo4j import AsyncGraphDatabase, AsyncDriver

from app.config import get_settings

_driver: AsyncDriver | None = None


async def init_driver() -> None:
    global _driver
    settings = get_settings()
    _driver = AsyncGraphDatabase.driver(
        settings.neo4j_uri,
        auth=(settings.neo4j_user, settings.neo4j_password),
    )
    await _driver.verify_connectivity()


async def close_driver() -> None:
    global _driver
    if _driver is not None:
        await _driver.close()
        _driver = None


def get_driver() -> AsyncDriver:
    if _driver is None:
        raise RuntimeError("Neo4j driver is not initialized")
    return _driver


async def ping() -> bool:
    driver = get_driver()
    async with driver.session() as session:
        result = await session.run("RETURN 1 AS ok")
        record = await result.single()
        return record is not None and record["ok"] == 1
