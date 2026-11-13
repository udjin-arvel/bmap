from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import aiosqlite
import bcrypt

from app.config import get_settings

_db: aiosqlite.Connection | None = None


def _hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


async def get_connection() -> aiosqlite.Connection:
    if _db is None:
        raise RuntimeError("SQLite is not initialized")
    return _db


async def init_db() -> None:
    global _db
    settings = get_settings()
    path = Path(settings.sqlite_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    _db = await aiosqlite.connect(path)
    _db.row_factory = aiosqlite.Row
    await _db.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
            created_at TEXT NOT NULL
        )
        """
    )
    await _db.commit()
    await _db.execute(
        """
        CREATE TABLE IF NOT EXISTS applied_seeds (
            seed_id TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        )
        """
    )
    await _db.commit()


async def close_db() -> None:
    global _db
    if _db is not None:
        await _db.close()
        _db = None


async def count_users() -> int:
    db = await get_connection()
    async with db.execute("SELECT COUNT(*) AS c FROM users") as cur:
        row = await cur.fetchone()
        return int(row["c"]) if row else 0


async def seed_users() -> None:
    if await count_users() > 0:
        return
    settings = get_settings()
    now = datetime.now(timezone.utc).isoformat()
    password_hash = _hash_password(settings.seed_viewer_password)
    db = await get_connection()
    await db.execute(
        "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)",
        ("viewer", password_hash, "viewer", now),
    )
    await db.commit()


async def create_user(username: str, plain_password: str, role: str = "viewer") -> None:
    now = datetime.now(timezone.utc).isoformat()
    password_hash = _hash_password(plain_password)
    db = await get_connection()
    await db.execute(
        "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)",
        (username, password_hash, role, now),
    )
    await db.commit()


async def get_user_by_username(username: str) -> aiosqlite.Row | None:
    db = await get_connection()
    async with db.execute("SELECT * FROM users WHERE username = ?", (username,)) as cur:
        return await cur.fetchone()


async def update_user_role(username: str, role: str) -> None:
    db = await get_connection()
    await db.execute("UPDATE users SET role = ? WHERE username = ?", (role, username))
    await db.commit()


def verify_password(plain: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


async def ping() -> bool:
    db = await get_connection()
    async with db.execute("SELECT 1") as cur:
        row = await cur.fetchone()
        return row is not None


async def is_seed_applied(seed_id: str) -> bool:
    db = await get_connection()
    async with db.execute("SELECT 1 FROM applied_seeds WHERE seed_id = ?", (seed_id,)) as cur:
        return await cur.fetchone() is not None


async def mark_seed_applied(seed_id: str) -> None:
    db = await get_connection()
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        "INSERT OR IGNORE INTO applied_seeds (seed_id, applied_at) VALUES (?, ?)",
        (seed_id, now),
    )
    await db.commit()
