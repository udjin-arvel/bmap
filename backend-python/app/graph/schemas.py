from typing import Literal

from pydantic import BaseModel, Field, field_validator

NODE_TYPES = Literal["PROCESS", "ACTOR", "RESOURCE", "LOGISTICS"]
NODE_ORIGINS = Literal["base", "user", "ai"]
COLOR_PALETTE = frozenset(
    {"#4A90D9", "#E67E22", "#27AE60", "#8E44AD", "#C0392B", "#7F8C8D"}
)


def validate_color(v: str | None) -> str | None:
    if v is not None and v not in COLOR_PALETTE:
        raise ValueError("Color not in palette")
    return v


class MarketNodeBase(BaseModel):
    id: str
    name: str
    nodeType: NODE_TYPES
    color: str | None = None
    note: str | None = None
    positionX: float
    positionY: float
    descriptionPinned: bool = False
    hasDescription: bool = False
    isBase: bool = False
    origin: NODE_ORIGINS = "user"
    createdAt: str
    updatedAt: str


class MarketNodeListItem(MarketNodeBase):
    description: str | None = None


class MarketNodeFull(MarketNodeBase):
    description: str | None = None


class MarketEdgeOut(BaseModel):
    id: str
    sourceId: str
    targetId: str
    createdAt: str


class GraphOut(BaseModel):
    nodes: list[MarketNodeListItem]
    edges: list[MarketEdgeOut]


class GraphRootOut(BaseModel):
    id: str
    name: str
    isBase: bool
    childCount: int


class NodeCreate(BaseModel):
    id: str | None = None
    name: str = Field(min_length=1)
    nodeType: NODE_TYPES
    description: str | None = None
    color: str | None = None
    note: str | None = None
    positionX: float
    positionY: float
    descriptionPinned: bool | None = None

    @field_validator("color")
    @classmethod
    def check_color(cls, v: str | None) -> str | None:
        return validate_color(v)


class NodeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    description: str | None = None
    color: str | None = None
    note: str | None = None
    positionX: float | None = None
    positionY: float | None = None
    descriptionPinned: bool | None = None

    @field_validator("color")
    @classmethod
    def check_color(cls, v: str | None) -> str | None:
        return validate_color(v)


class BatchPatchItem(NodeUpdate):
    id: str


class EdgeCreate(BaseModel):
    sourceId: str
    targetId: str
