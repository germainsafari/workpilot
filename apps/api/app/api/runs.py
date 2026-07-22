import json
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.audit import record_audit
from app.auth import Principal, current_principal
from app.config import get_settings
from app.db import get_session
from app.models import AuditEvent, Workflow, WorkflowRun
from app.run_service import execute_persisted_run, queue_payload
from app.schemas import AuditRead, RunCreate, RunRead

router = APIRouter(tags=["Runs"])


@router.post("/workflows/{workflow_id}/runs", response_model=RunRead, status_code=status.HTTP_201_CREATED)
async def create_run(
    workflow_id: str,
    payload: RunCreate,
    principal: Principal = Depends(current_principal),
    session: AsyncSession = Depends(get_session),
) -> WorkflowRun:
    workflow = await session.scalar(
        select(Workflow).where(Workflow.id == workflow_id, Workflow.tenant_id == principal.tenant_id)
    )
    if workflow is None or workflow.active_version_id is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    key = payload.idempotency_key or str(uuid4())
    existing = await session.scalar(
        select(WorkflowRun)
        .where(WorkflowRun.tenant_id == principal.tenant_id, WorkflowRun.idempotency_key == key)
        .options(selectinload(WorkflowRun.steps))
    )
    if existing is not None:
        return existing
    run = WorkflowRun(
        id=f"run-{uuid4()}",
        tenant_id=principal.tenant_id,
        workflow_id=workflow.id,
        workflow_version_id=workflow.active_version_id,
        status="queued",
        trigger_type=payload.trigger_type,
        trigger_payload=payload.input,
        idempotency_key=key,
        trace_id=uuid4().hex,
    )
    session.add(run)
    await record_audit(
        session, principal, "run.started", "workflow_run", run.id, {"workflow_id": workflow.id}
    )
    await session.commit()

    settings = get_settings()
    if settings.execute_runs_inline:
        return await execute_persisted_run(session, principal, run.id)
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    try:
        await redis.rpush("workpilot:runs", json.dumps(await queue_payload(run.id, principal)))
    finally:
        await redis.aclose()
    created = await session.scalar(
        select(WorkflowRun)
        .where(WorkflowRun.id == run.id)
        .options(selectinload(WorkflowRun.steps))
        .execution_options(populate_existing=True)
    )
    return created or run


@router.get("/runs", response_model=list[RunRead])
async def list_runs(
    principal: Principal = Depends(current_principal), session: AsyncSession = Depends(get_session)
) -> list[WorkflowRun]:
    result = await session.scalars(
        select(WorkflowRun)
        .where(WorkflowRun.tenant_id == principal.tenant_id)
        .options(selectinload(WorkflowRun.steps))
        .order_by(WorkflowRun.started_at.desc())
        .limit(100)
    )
    return list(result.unique())


@router.get("/runs/{run_id}", response_model=RunRead)
async def get_run(
    run_id: str,
    principal: Principal = Depends(current_principal),
    session: AsyncSession = Depends(get_session),
) -> WorkflowRun:
    run = await session.scalar(
        select(WorkflowRun)
        .where(WorkflowRun.id == run_id, WorkflowRun.tenant_id == principal.tenant_id)
        .options(selectinload(WorkflowRun.steps))
    )
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


@router.get("/runs/{run_id}/audit", response_model=list[AuditRead])
async def get_run_audit(
    run_id: str,
    principal: Principal = Depends(current_principal),
    session: AsyncSession = Depends(get_session),
) -> list[AuditRead]:
    run = await session.scalar(
        select(WorkflowRun.id).where(WorkflowRun.id == run_id, WorkflowRun.tenant_id == principal.tenant_id)
    )
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    result = await session.scalars(
        select(AuditEvent)
        .where(AuditEvent.tenant_id == principal.tenant_id, AuditEvent.resource_id == run_id)
        .order_by(AuditEvent.timestamp)
    )
    return [
        AuditRead(
            id=event.id,
            actor_type=event.actor_type,
            actor_id=event.actor_id,
            action=event.action,
            resource_type=event.resource_type,
            resource_id=event.resource_id,
            timestamp=event.timestamp,
            metadata=event.metadata_,
            immutable_hash=event.immutable_hash,
        )
        for event in result
    ]
