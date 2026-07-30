"""Seed one Bedrock-powered workflow and a completed demo run for the UI.

Run inside the API container (uses the same runtime config as production):

    docker compose exec api python -m app.seed_bedrock_demo

Idempotent: skips if ``wf-bedrock-demo`` already has a completed run.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import DEMO_TENANT_ID, DEMO_USER_ID
from app.db import SessionFactory, create_schema, engine
from app.executor import NativeExecutor
from app.models import StepRun, Tenant, User, Workflow, WorkflowRun, WorkflowVersion
from app.runtimes.factory import get_runtime
from app.schemas import CanonicalWorkflow

WORKFLOW_ID = "wf-bedrock-demo"
VERSION_ID = "version-bedrock-demo-1"

DEFINITION = {
    "apiVersion": "workpilot.io/v1",
    "kind": "Workflow",
    "trigger": {"type": "manual", "label": "Campaign feedback submitted"},
    "steps": [
        {"id": "classify", "name": "Classify feedback tone", "type": "ai_task", "task": "classify"},
        {"id": "summarize", "name": "Summarize key themes", "type": "ai_task", "task": "summarize"},
        {
            "id": "draft",
            "name": "Draft response outline",
            "type": "tool",
            "operation": "prepare_message",
            "dry_run": True,
        },
        {"id": "end", "name": "Insights ready", "type": "end", "outcome": "completed"},
    ],
    "edges": [
        {"from": "classify", "to": "summarize"},
        {"from": "summarize", "to": "draft"},
        {"from": "draft", "to": "end"},
    ],
}

SAMPLE_INPUT = {
    "campaign": "Helios Summer Launch",
    "feedback": (
        "Love the new visuals but shipping was slow in Italy. "
        "Germany launch email felt generic. Poland team wants more localized copy."
    ),
    "markets": ["Germany", "Italy", "Poland"],
    "category": "standard",
}


async def _ensure_tenant(session: AsyncSession) -> None:
    tenant = await session.scalar(select(Tenant.id).where(Tenant.id == DEMO_TENANT_ID))
    if tenant is None:
        session.add(
            Tenant(
                id=DEMO_TENANT_ID,
                name="Northstar Projects",
                slug="northstar-projects",
                plan="business",
            )
        )
        await session.flush()
    user = await session.scalar(select(User.id).where(User.id == DEMO_USER_ID))
    if user is None:
        session.add(
            User(
                id=DEMO_USER_ID,
                tenant_id=DEMO_TENANT_ID,
                email="alex@northstar.example",
                name="Alex Morgan",
                role="workflow_admin",
            )
        )
        await session.flush()


async def seed_bedrock_demo() -> dict[str, str]:
    await create_schema()
    runtime = get_runtime()
    executor = NativeExecutor(runtime=runtime)
    now = datetime.now(UTC).replace(tzinfo=None)

    async with SessionFactory() as session:
        await _ensure_tenant(session)

        workflow = await session.scalar(
            select(Workflow).where(Workflow.id == WORKFLOW_ID, Workflow.tenant_id == DEMO_TENANT_ID)
        )
        if workflow is not None:
            run_ids = (
                await session.scalars(
                    select(WorkflowRun.id).where(
                        WorkflowRun.workflow_id == WORKFLOW_ID,
                        WorkflowRun.tenant_id == DEMO_TENANT_ID,
                    )
                )
            ).all()
            if run_ids:
                await session.execute(delete(StepRun).where(StepRun.run_id.in_(run_ids)))
                await session.execute(
                    delete(WorkflowRun).where(WorkflowRun.id.in_(run_ids))
                )
                await session.flush()

        if workflow is None:
            workflow = Workflow(
                id=WORKFLOW_ID,
                tenant_id=DEMO_TENANT_ID,
                name="Campaign feedback pulse (Bedrock)",
                description=(
                    "Classifies launch feedback, summarizes themes with Amazon Bedrock, "
                    "and drafts a safe response outline."
                ),
                status="active",
                active_version_id=VERSION_ID,
                owner_id=DEMO_USER_ID,
                department="Marketing",
                risk_level="low",
                created_at=now,
                updated_at=now,
            )
            session.add(workflow)
            session.add(
                WorkflowVersion(
                    id=VERSION_ID,
                    workflow_id=WORKFLOW_ID,
                    version_number=1,
                    canonical_definition=DEFINITION,
                    generated_explanation=(
                        "Uses Bedrock AI to classify campaign feedback, summarize themes, "
                        "and prepare a response draft in safe test mode."
                    ),
                    validation_result={"valid": True, "errors": []},
                    runtime_plan={
                        "primary_runtime": runtime.name,
                        "safe_test": True,
                        "model_id": "bedrock",
                    },
                    created_by=DEMO_USER_ID,
                    created_at=now,
                    published_at=now,
                )
            )
            await session.flush()

        definition = CanonicalWorkflow.model_validate(DEFINITION)
        results = await executor.execute(definition, SAMPLE_INPUT)

        run_id = f"run-{uuid4()}"
        token_usage = sum(
            int(r.model_usage.get("input_units", 0) or r.model_usage.get("input_tokens", 0))
            + int(r.model_usage.get("output_units", 0) or r.model_usage.get("output_tokens", 0))
            for r in results
        )
        cost = round(
            sum(float(r.model_usage.get("cost_usd", 0) or 0) for r in results)
            + 0.001 * len([r for r in results if r.tool_usage]),
            6,
        )

        session.add(
            WorkflowRun(
                id=run_id,
                tenant_id=DEMO_TENANT_ID,
                workflow_id=WORKFLOW_ID,
                workflow_version_id=VERSION_ID,
                status="completed",
                trigger_type="manual",
                trigger_payload=SAMPLE_INPUT,
                started_at=now,
                finished_at=now,
                total_cost=cost,
                token_usage=token_usage,
                idempotency_key=f"bedrock-demo-{run_id}",
                trace_id=uuid4().hex,
            )
        )
        for result in results:
            session.add(
                StepRun(
                    id=f"step-run-{uuid4()}",
                    run_id=run_id,
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

        await session.commit()

    await engine.dispose()
    return {"status": "created", "workflow_id": WORKFLOW_ID, "run_id": run_id, "runtime": runtime.name}


if __name__ == "__main__":
    outcome = asyncio.run(seed_bedrock_demo())
    print(outcome)
