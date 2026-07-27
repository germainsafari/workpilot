"""Idempotent bootstrap workflows required in every environment."""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import DEMO_TENANT_ID, DEMO_USER_ID
from app.db import SessionFactory
from app.models import Tenant, Workflow, WorkflowVersion

AGENTCORE_DEMO_DEFINITION: dict[str, Any] = {
    "apiVersion": "workpilot.io/v1",
    "kind": "Workflow",
    "trigger": {"type": "manual", "label": "Run on AgentCore"},
    "runtime_override": "agentcore",
    "steps": [
        {"id": "analyze", "name": "Analyze with AgentCore", "type": "ai_task", "task": "extract"},
        {"id": "summarize", "name": "Summarize findings", "type": "ai_task", "task": "summarize"},
        {"id": "end", "name": "Analysis complete", "type": "end", "outcome": "completed"},
    ],
    "edges": [
        {"from": "analyze", "to": "summarize"},
        {"from": "summarize", "to": "end"},
    ],
}

BOOTSTRAP_WORKFLOWS: list[dict[str, Any]] = [
    {
        "id": "wf-agentcore-demo",
        "name": "AgentCore AI analysis",
        "description": "Runs a two-step AI analysis using AWS AgentCore — a fully managed agent microVM.",
        "department": "Operations",
        "owner_id": DEMO_USER_ID,
        "status": "active",
        "risk_level": "low",
        "definition": AGENTCORE_DEMO_DEFINITION,
        "explanation": (
            "Sends input to an AWS AgentCore managed runtime and returns a structured analysis."
        ),
    },
]


async def _ensure_workflow(session: AsyncSession, spec: dict[str, Any]) -> None:
    if await session.get(Workflow, spec["id"]) is not None:
        return

    tenant = await session.get(Tenant, DEMO_TENANT_ID)
    if tenant is None:
        return

    version_id = f"version-{spec['id']}-1"
    session.add(
        Workflow(
            id=spec["id"],
            tenant_id=DEMO_TENANT_ID,
            name=spec["name"],
            description=spec["description"],
            status=spec["status"],
            active_version_id=version_id,
            owner_id=spec["owner_id"],
            department=spec["department"],
            risk_level=spec["risk_level"],
        )
    )
    session.add(
        WorkflowVersion(
            id=version_id,
            workflow_id=spec["id"],
            version_number=1,
            canonical_definition=spec["definition"],
            generated_explanation=spec["explanation"],
            validation_result={"valid": True, "errors": []},
            runtime_plan={"primary_runtime": "agentcore", "safe_test": True},
            created_by=spec["owner_id"],
        )
    )
    await session.flush()


async def bootstrap_workflows() -> None:
    async with SessionFactory() as session:
        for spec in BOOTSTRAP_WORKFLOWS:
            await _ensure_workflow(session, spec)
        await session.commit()
