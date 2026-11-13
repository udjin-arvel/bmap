from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Literal

from app.ai.schemas import AiJobOut
from app.graph.schemas import MarketEdgeOut, MarketNodeFull

JobStatus = Literal["queued", "running", "completed", "error"]


@dataclass
class JobRecord:
    id: str
    node_id: str
    status: JobStatus = "queued"
    error: str | None = None
    nodes: list[MarketNodeFull] | None = None
    edges: list[MarketEdgeOut] | None = None


@dataclass
class JobStore:
    _jobs: dict[str, JobRecord] = field(default_factory=dict)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def create(self, node_id: str) -> JobRecord:
        import uuid

        job = JobRecord(id=str(uuid.uuid4()), node_id=node_id)
        async with self._lock:
            self._jobs[job.id] = job
        return job

    async def get(self, job_id: str) -> JobRecord | None:
        async with self._lock:
            return self._jobs.get(job_id)

    async def update(self, job_id: str, **kwargs: Any) -> None:
        async with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            for k, v in kwargs.items():
                setattr(job, k, v)

    def to_out(self, job: JobRecord) -> AiJobOut:
        return AiJobOut(
            jobId=job.id,
            nodeId=job.node_id,
            status=job.status,
            error=job.error,
            nodes=job.nodes,
            edges=job.edges,
        )


job_store = JobStore()
