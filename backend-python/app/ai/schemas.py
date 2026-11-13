from pydantic import BaseModel, Field

from app.graph.schemas import MarketEdgeOut, MarketNodeFull


class ExpandRequest(BaseModel):
    force: bool = False


class ExpandResponse(BaseModel):
    jobId: str


class AiOutgoingOut(BaseModel):
    hasAiOutgoing: bool


class AiJobOut(BaseModel):
    jobId: str
    nodeId: str
    status: str
    error: str | None = None
    nodes: list[MarketNodeFull] | None = None
    edges: list[MarketEdgeOut] | None = None


class ExpandStep(BaseModel):
    name: str = Field(min_length=1)
    nodeType: str
    description: str | None = None
    color: str | None = None
    anchor: bool = False


class ExpandStepsPayload(BaseModel):
    steps: list[ExpandStep]
