from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth.schemas import AuthUser, Role
from app.config import get_settings
from app.db import sqlite as sqlite_db

bearer_scheme = HTTPBearer(auto_error=False)


def create_access_token(username: str, role: Role) -> str:
    settings = get_settings()
    expire = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expire_hours)
    payload = {"sub": username, "role": role, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> AuthUser:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"detail": "Invalid or expired token", "code": "UNAUTHORIZED"},
        ) from exc
    username = payload.get("sub")
    role = payload.get("role")
    if not isinstance(username, str) or role not in ("viewer", "editor"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"detail": "Invalid token payload", "code": "UNAUTHORIZED"},
        )
    return AuthUser(username=username, role=role)


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    token: Annotated[str | None, Query(alias="token")] = None,
) -> AuthUser:
    raw = credentials.credentials if credentials else token
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"detail": "Not authenticated", "code": "UNAUTHORIZED"},
        )
    user = decode_token(raw)
    row = await sqlite_db.get_user_by_username(user.username)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"detail": "User not found", "code": "UNAUTHORIZED"},
        )
    return AuthUser(username=user.username, role=row["role"])


async def require_editor(
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> AuthUser:
    if user.role != "editor":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"detail": "Editor role required", "code": "FORBIDDEN"},
        )
    return user
