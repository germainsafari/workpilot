"""Run orchestration: turn a queued ``WorkflowRun`` row into a finished one.

``execute_persisted_run`` loads a run (tenant-scoped), re-validates its stored
canonical definition, executes it via :class:`NativeExecutor`, persists a
``StepRun`` per step, updates the run status/cost, and writes ``run.completed``
or ``run.failed`` audit events — all inside one OpenTelemetry span.

It is called two ways (see ``api/runs.py``):
* inline, in the request handler, when ``execute_runs_inline`` is true (local/test);
* by the Redis worker (``app.worker``) when runs are queued (docker/production).
"""

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
from app.runtimes.base import AgentRuntime
from app.runtimes.factory import get_runtime
from app.schemas import CanonicalWorkflow
from app.telemetry import get_tracer

tracer = get_tracer("workpilot.run_service")


def _resolve_runtime(definition: CanonicalWorkflow) -> AgentRuntime:
    """Return the right runtime for this workflow.

    If the workflow definition specifies a ``runtime_override``, build that
    runtime directly.  Otherwise fall back to the global factory (env-based).
    """
    override = definition.runtime_override
    if not override:
        return get_runtime()

    from app.config import get_settings
    settings = get_settings()

    if override == "agentcore":
        from app.runtimes.bedrock_agentcore import BedrockAgentCoreRuntime
        return BedrockAgentCoreRuntime(
            runtime_arn=settings.agentcore_runtime_arn,
            region=settings.bedrock_region,
        )
    if override == "bedrock_langgraph":
        from app.runtimes.bedrock_langgraph import BedrockLangGraphRuntime
        return BedrockLangGraphRuntime(
            model_id=settings.bedrock_model_id,
            region=settings.bedrock_region,
        )
    # Unknown override — fall back to global
    return get_runtime()


async def execute_persisted_run(session: AsyncSession, principal: Principal, run_id: str) -> WorkflowRun:
    with tracer.start_as_current_span(
        "run.execute",
        attributes={
            "workpilot.run_id": run_id,
            "workpilot.tenant_id": principal.tenant_id,
        },
    ) as span:
        run = await session.scalar(
            select(WorkflowRun)
            .where(WorkflowRun.id == run_id, WorkflowRun.tenant_id == principal.tenant_id)
            .options(selectinload(WorkflowRun.steps))
        )
        if run is None:
            raise LookupError("run not found")

        # Enrich the span with run metadata now that the record is loaded.
        span.set_attribute("workpilot.workflow_id", run.workflow_id)
        span.set_attribute("workpilot.trace_id", run.trace_id)
        span.set_attribute("workpilot.workflow_version_id", run.workflow_version_id)

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
            runtime: AgentRuntime = _resolve_runtime(definition)
            results = await NativeExecutor(runtime=runtime).execute(definition, run.trigger_payload)
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
                span.add_event(
                    "step.completed",
                    {
                        "step_id": result.step_id,
                        "status": result.status,
                    },
                )
            run.status = "completed"
            run.finished_at = datetime.utcnow()
            run.current_step_id = None
            span.set_attribute("workpilot.run.status", "completed")
            span.set_attribute("workpilot.run.steps", len(results))
            await record_audit(
                session, principal, "run.completed", "workflow_run", run.id, {"steps": len(results)}
            )
        except Exception as error:
            try:
                import opentelemetry.trace as _ot_trace

                span.set_status(
                    _ot_trace.Status(_ot_trace.StatusCode.ERROR, str(error))
                )
            except ImportError:
                pass
            span.record_exception(error)
            span.set_attribute("workpilot.run.status", "failed")
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
