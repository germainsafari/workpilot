from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.audit import record_audit
from app.auth import Principal
from app.executor import NativeExecutor
from app.models import StepRun, Workflow, WorkflowRun, WorkflowVersion
from app.schemas import CanonicalWorkflow


async def execute_persisted_run(session: AsyncSession, principal: Principal, run_id: str) -> WorkflowRun:
    run = await session.scalar(
        select(WorkflowRun)
        .where(WorkflowRun.id == run_id, WorkflowRun.tenant_id == principal.tenant_id)
        .options(selectinload(WorkflowRun.steps))
    )
    if run is None:
        raise LookupError("run not found")
    workflow = await session.scalar(
        select(Workflow).where(Workflow.id == run.workflow_id, Workflow.tenant_id == principal.tenant_id)
    )
    version = await session.scalar(
        select(WorkflowVersion).where(
            WorkflowVersion.id == run.workflow_version_id,
            WorkflowVersion.workflow_id == run.workflow_id,
        )
    )
    if workflow is None or version is None:
        raise LookupError("workflow version not found")

    run.status = "running"
    definition = CanonicalWorkflow.model_validate(version.canonical_definition)
    try:
        results = await NativeExecutor().execute(definition, run.trigger_payload)
        for result in results:
            now = datetime.utcnow()
            session.add(
                StepRun(
                    id=f"step-run-{uuid4()}",
                    run_id=run.id,
                    step_id=result.step_id,
                    status=result.status,
                    attempt=1,
                    started_at=now,
                    finished_at=now,
                    input_data=result.input_data,
                    output_data=result.output_data,
                    model_usage=result.model_usage,
                    tool_usage=result.tool_usage,
                )
            )
        run.status = "completed"
        run.finished_at = datetime.utcnow()
        run.current_step_id = None
        await record_audit(
            session, principal, "run.completed", "workflow_run", run.id, {"steps": len(results)}
        )
    except Exception as error:
        run.status = "failed"
        run.finished_at = datetime.utcnow()
        run.error_summary = str(error)
        await record_audit(
            session, principal, "run.failed", "workflow_run", run.id, {"error_type": type(error).__name__}
        )
        raise
    await session.commit()
    refreshed = await session.scalar(
        select(WorkflowRun)
        .where(WorkflowRun.id == run.id)
        .options(selectinload(WorkflowRun.steps))
        .execution_options(populate_existing=True)
    )
    return refreshed or run


async def queue_payload(run_id: str, principal: Principal) -> dict[str, Any]:
    return {
        "run_id": run_id,
        "tenant_id": principal.tenant_id,
        "user_id": principal.user_id,
        "role": principal.role,
    }
