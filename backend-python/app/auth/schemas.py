from typing import Literal

from pydantic import BaseModel, Field


Role = Literal["viewer", "editor"]


class LoginRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)
    editorKey: str | None = None


class RegisterRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=4, max_length=128)


class LoginResponse(BaseModel):
    access_token: str
    role: Role


class AuthUser(BaseModel):
    username: str
    role: Role
