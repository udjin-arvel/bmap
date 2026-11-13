from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth.schemas import AuthUser, LoginRequest, LoginResponse, RegisterRequest, Role
from app.auth.security import create_access_token, get_current_user
from app.config import get_settings
from app.db import sqlite as sqlite_db

router = APIRouter()


@router.post("/register", response_model=LoginResponse, status_code=201)
async def register(body: RegisterRequest) -> LoginResponse:
    username = body.username.strip()
    if not username:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"detail": "Username is required", "code": "VALIDATION_ERROR"},
        )
    if await sqlite_db.get_user_by_username(username) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"detail": "Username already taken", "code": "USERNAME_TAKEN"},
        )
    await sqlite_db.create_user(username, body.password, "viewer")
    token = create_access_token(username, "viewer")
    return LoginResponse(access_token=token, role="viewer")


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest) -> LoginResponse:
    username = body.username.strip()
    row = await sqlite_db.get_user_by_username(username)
    if row is None or not sqlite_db.verify_password(body.password, row["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"detail": "Invalid credentials", "code": "UNAUTHORIZED"},
        )

    role: Role = row["role"]
    settings = get_settings()
    if body.editorKey and body.editorKey == settings.editor_key:
        if role != "editor":
            await sqlite_db.update_user_role(username, "editor")
        role = "editor"

    token = create_access_token(username, role)
    return LoginResponse(access_token=token, role=role)


@router.get("/me", response_model=AuthUser)
async def me(user: Annotated[AuthUser, Depends(get_current_user)]) -> AuthUser:
    return user
