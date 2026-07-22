import asyncio

from sqlalchemy import select

from app.auth import DEMO_TENANT_ID, DEMO_USER_ID
from app.db import SessionFactory, create_schema
from app.models import AuditEvent, Tenant, User, Workflow, WorkflowVersion

DEFINITION = {
    "apiVersion": "workpilot.io/v1",
    "kind": "Workflow",
    "trigger": {"type": "form", "label": "New client brief received"},
    "steps": [
        {"id": "extract", "name": "Organize requirements", "type": "ai_task", "task": "extract"},
        {
            "id": "check",
            "name": "Check required details",
            "type": "condition",
            "field": "missing_details",
            "operator": "is_empty",
        },
        {"id": "wait", "name": "Wait for account manager", "type": "wait", "duration_seconds": 0},
        {
            "id": "tasks",
            "name": "Prepare project tasks",
            "type": "tool",
            "operation": "prepare_tasks",
            "dry_run": True,
        },
        {"id": "end", "name": "Brief ready", "type": "end", "outcome": "completed"},
    ],
    "edges": [
        {"from": "extract", "to": "check"},
        {"from": "check", "to": "wait"},
        {"from": "wait", "to": "tasks"},
        {"from": "tasks", "to": "end"},
    ],
}


async def seed() -> None:
    await create_schema()
    async with SessionFactory() as session:
        existing = await session.scalar(select(Tenant.id).where(Tenant.id == DEMO_TENANT_ID))
        if existing:
            return
        tenant = Tenant(id=DEMO_TENANT_ID, name="Northstar Projects", slug="northstar-projects")
        user = User(
            id=DEMO_USER_ID, tenant_id=DEMO_TENANT_ID, email="alex@northstar.example", name="Alex Morgan"
        )
        workflow = Workflow(
            id="wf-client-brief",
            tenant_id=DEMO_TENANT_ID,
            name="Client brief processor",
            description="Turns incoming requests into an approved, delivery-ready project brief.",
            status="active",
            active_version_id="version-client-brief-1",
            owner_id=DEMO_USER_ID,
            department="Client services",
            risk_level="medium",
        )
        version = WorkflowVersion(
            id="version-client-brief-1",
            workflow_id=workflow.id,
            version_number=1,
            canonical_definition=DEFINITION,
            generated_explanation=(
                "Organizes a client brief, checks missing details, and prepares tasks in safe mode."
            ),
            validation_result={"valid": True, "errors": []},
            runtime_plan={"primary_runtime": "native", "safe_test": True},
            created_by=DEMO_USER_ID,
        )
        audit = AuditEvent(
            id="audit-seed-1",
            tenant_id=DEMO_TENANT_ID,
            actor_type="system",
            actor_id="seed",
            action="workflow.created",
            resource_type="workflow",
            resource_id=workflow.id,
            metadata_={"source": "demo_seed"},
            immutable_hash="seed:wf-client-brief",
        )
        session.add_all([tenant, user, workflow, version, audit])
        await session.commit()


if __name__ == "__main__":
    asyncio.run(seed())
