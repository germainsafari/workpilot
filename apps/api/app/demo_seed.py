"""Load a rich, realistic demo workspace into the configured database.

This seeds the "Northstar Projects" tenant that the product UI tells its story
around: a small operations team, five workflows across departments, published
versions, a spread of historical runs with step-level detail, and a
hash-chained audit trail. It is idempotent — every run wipes and rebuilds the
tenant's data so the demo is reproducible.

Run it directly against any configured database:

    WORKPILOT_DATABASE_URL=postgresql+asyncpg://... python -m app.demo_seed
"""

import asyncio
import hashlib
import json
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import delete, select

from app.db import SessionFactory, create_schema, engine
from app.executor import NativeExecutor
from app.models import (
    AuditEvent,
    StepRun,
    Tenant,
    User,
    Workflow,
    WorkflowRun,
    WorkflowVersion,
)
from app.schemas import CanonicalWorkflow

TENANT_ID = "tenant-northstar"
NOW = datetime(2026, 7, 23, 11, 0, 0)


def days_ago(days: float, base: datetime = NOW) -> datetime:
    return base - timedelta(days=days)


# --------------------------------------------------------------------------- #
# Team
# --------------------------------------------------------------------------- #
USERS: list[dict[str, str]] = [
    {"id": "user-alex", "email": "alex@northstar.example", "name": "Alex Morgan", "role": "workflow_admin"},
    {"id": "user-maya", "email": "maya@northstar.example", "name": "Maya Chen", "role": "workflow_admin"},
    {"id": "user-priya", "email": "priya@northstar.example", "name": "Priya Shah", "role": "operator"},
    {"id": "user-noah", "email": "noah@northstar.example", "name": "Noah Williams", "role": "finance_reviewer"},
    {"id": "user-elena", "email": "elena@northstar.example", "name": "Elena Rossi", "role": "creative_lead"},
]


# --------------------------------------------------------------------------- #
# Canonical workflow definitions (backend-valid: ai_task/tool/condition/wait/end)
# --------------------------------------------------------------------------- #
def _definition(
    trigger: dict[str, Any],
    steps: list[dict[str, Any]],
    edges: list[dict[str, str]],
    runtime_override: str | None = None,
) -> dict[str, Any]:
    d: dict[str, Any] = {"apiVersion": "workpilot.io/v1", "kind": "Workflow", "trigger": trigger, "steps": steps, "edges": edges}
    if runtime_override:
        d["runtime_override"] = runtime_override
    return d


CLIENT_BRIEF = _definition(
    {"type": "form", "label": "New client brief received"},
    [
        {"id": "extract", "name": "Organize requirements", "type": "ai_task", "task": "extract"},
        {"id": "check", "name": "Check required details", "type": "condition", "field": "missing_details", "operator": "is_empty"},
        {"id": "wait", "name": "Wait for account manager", "type": "wait", "duration_seconds": 0},
        {"id": "tasks", "name": "Prepare project tasks", "type": "tool", "operation": "prepare_tasks", "dry_run": True},
        {"id": "end", "name": "Brief ready", "type": "end", "outcome": "completed"},
    ],
    [{"from": "extract", "to": "check"}, {"from": "check", "to": "wait"}, {"from": "wait", "to": "tasks"}, {"from": "tasks", "to": "end"}],
)

MEETING_ACTIONS = _definition(
    {"type": "upload", "label": "Meeting transcript uploaded"},
    [
        {"id": "capture", "name": "Capture decisions and actions", "type": "ai_task", "task": "extract"},
        {"id": "summarize", "name": "Summarize outcomes", "type": "ai_task", "task": "summarize"},
        {"id": "draft", "name": "Prepare follow-up message", "type": "tool", "operation": "prepare_message", "dry_run": True},
        {"id": "end", "name": "Actions ready", "type": "end", "outcome": "completed"},
    ],
    [{"from": "capture", "to": "summarize"}, {"from": "summarize", "to": "draft"}, {"from": "draft", "to": "end"}],
)

PROJECT_HEALTH = _definition(
    {"type": "schedule", "label": "Mondays at 09:00"},
    [
        {"id": "classify", "name": "Classify project status", "type": "ai_task", "task": "classify"},
        {"id": "gate", "name": "Standard status?", "type": "condition", "field": "category", "operator": "equals", "value": "standard"},
        {"id": "report", "name": "Prepare management summary", "type": "tool", "operation": "prepare_message", "dry_run": True},
        {"id": "end", "name": "Report ready", "type": "end", "outcome": "completed"},
    ],
    [{"from": "classify", "to": "gate"}, {"from": "gate", "to": "report"}, {"from": "report", "to": "end"}],
)

INVOICE_PREP = _definition(
    {"type": "schedule", "label": "Billing cycle ends"},
    [
        {"id": "extract", "name": "Gather billable work", "type": "ai_task", "task": "extract"},
        {"id": "verify", "name": "Check for missing time", "type": "condition", "field": "missing_details", "operator": "is_empty"},
        {"id": "draft", "name": "Prepare invoice draft", "type": "tool", "operation": "update_record", "dry_run": True},
        {"id": "end", "name": "Draft ready for finance", "type": "end", "outcome": "needs_review"},
    ],
    [{"from": "extract", "to": "verify"}, {"from": "verify", "to": "draft"}, {"from": "draft", "to": "end"}],
)

ASSET_REVIEW = _definition(
    {"type": "upload", "label": "Asset uploaded"},
    [
        {"id": "classify", "name": "Classify asset", "type": "ai_task", "task": "classify"},
        {"id": "gate", "name": "Meets delivery rules?", "type": "condition", "field": "category", "operator": "equals", "value": "standard"},
        {"id": "notify", "name": "Prepare reviewer note", "type": "tool", "operation": "prepare_message", "dry_run": True},
        {"id": "end", "name": "Review routed", "type": "end", "outcome": "completed"},
    ],
    [{"from": "classify", "to": "gate"}, {"from": "gate", "to": "notify"}, {"from": "notify", "to": "end"}],
)

# AgentCore-powered workflow — uses AWS AgentCore managed runtime instead of LangGraph
AGENTCORE_DEMO = _definition(
    {"type": "manual", "label": "Run on AgentCore"},
    [
        {"id": "analyze", "name": "Analyze with AgentCore", "type": "ai_task", "task": "extract"},
        {"id": "summarize", "name": "Summarize findings", "type": "ai_task", "task": "summarize"},
        {"id": "end", "name": "Analysis complete", "type": "end", "outcome": "completed"},
    ],
    [{"from": "analyze", "to": "summarize"}, {"from": "summarize", "to": "end"}],
    runtime_override="agentcore",
)


WORKFLOWS: list[dict[str, Any]] = [
    {
        "id": "wf-client-brief", "name": "Client brief processor",
        "description": "Turns incoming requests into an approved, delivery-ready project brief.",
        "department": "Client services", "owner_id": "user-maya", "status": "active", "risk_level": "medium",
        "definition": CLIENT_BRIEF,
        "explanation": "Organizes a client brief, checks required details, pauses for review, and prepares tasks in safe mode.",
        "created": 92, "runs": 42,
    },
    {
        "id": "wf-meeting-actions", "name": "Meeting to action",
        "description": "Captures decisions and prepares owned follow-up tasks after client meetings.",
        "department": "Operations", "owner_id": "user-alex", "status": "active", "risk_level": "low",
        "definition": MEETING_ACTIONS,
        "explanation": "Reads a transcript, captures decisions and owners, summarizes outcomes, and drafts a follow-up in safe mode.",
        "created": 74, "runs": 67,
    },
    {
        "id": "wf-project-health", "name": "Weekly project health report",
        "description": "Reviews active projects every Monday and prepares an operations summary.",
        "department": "Operations", "owner_id": "user-priya", "status": "active", "risk_level": "medium",
        "definition": PROJECT_HEALTH,
        "explanation": "Classifies delivery status each Monday and prepares a management summary in safe mode.",
        "created": 61, "runs": 4,
    },
    {
        "id": "wf-invoice-prep", "name": "Invoice preparation",
        "description": "Checks approved time and expenses before preparing a finance review draft.",
        "department": "Finance", "owner_id": "user-noah", "status": "draft", "risk_level": "high",
        "definition": INVOICE_PREP,
        "explanation": "Gathers billable work, checks for missing time, and prepares an approval-ready invoice draft in safe mode.",
        "created": 12, "runs": 0,
    },
    {
        "id": "wf-asset-review", "name": "Creative asset review",
        "description": "Checks new assets against delivery rules and routes issues to a reviewer.",
        "department": "Creative", "owner_id": "user-elena", "status": "paused", "risk_level": "low",
        "definition": ASSET_REVIEW,
        "explanation": "Classifies each new asset against delivery rules and routes exceptions to a reviewer in safe mode.",
        "created": 48, "runs": 31,
    },
    {
        "id": "wf-agentcore-demo", "name": "AgentCore AI analysis",
        "description": "Runs a two-step AI analysis using AWS AgentCore — a fully managed agent microVM.",
        "department": "Operations", "owner_id": "user-alex", "status": "active", "risk_level": "low",
        "definition": AGENTCORE_DEMO,
        "explanation": "Sends input to an AWS AgentCore managed runtime, which calls Amazon Nova Micro and returns a structured analysis.",
        "created": 1, "runs": 0,
    },
]


# --------------------------------------------------------------------------- #
# Run plan: (workflow_id, offset_days, status, trigger, sample_input)
# --------------------------------------------------------------------------- #
SAMPLE_BRIEF = {
    "client": "Helios Retail", "project_type": "Product launch campaign",
    "deliverables": ["Landing page", "Launch email", "Paid social set"],
    "deadline": "2026-08-15", "markets": ["Poland", "Germany", "Italy"],
}
SAMPLE_BRIEF_INCOMPLETE = {**SAMPLE_BRIEF, "deadline": None}
SAMPLE_TRANSCRIPT = {"meeting": "Helios weekly sync", "attendees": ["Maya", "Client PM"], "category": "standard"}
SAMPLE_HEALTH = {"portfolio": "All active", "category": "standard"}
SAMPLE_ASSET = {"asset": "helios-hero-v3.png", "category": "standard"}

RUN_PLAN: list[dict[str, Any]] = [
    {"wf": "wf-client-brief", "offset": 0.02, "status": "completed", "trigger": "form", "input": SAMPLE_BRIEF, "actor": "user-maya"},
    {"wf": "wf-client-brief", "offset": 0.06, "status": "waiting", "trigger": "email", "input": SAMPLE_BRIEF_INCOMPLETE, "actor": "user-maya"},
    {"wf": "wf-client-brief", "offset": 1.1, "status": "completed", "trigger": "form", "input": SAMPLE_BRIEF, "actor": "user-maya"},
    {"wf": "wf-client-brief", "offset": 2.3, "status": "failed", "trigger": "form", "input": SAMPLE_BRIEF, "actor": "user-maya"},
    {"wf": "wf-meeting-actions", "offset": 0.03, "status": "completed", "trigger": "upload", "input": SAMPLE_TRANSCRIPT, "actor": "user-alex"},
    {"wf": "wf-meeting-actions", "offset": 0.9, "status": "completed", "trigger": "upload", "input": SAMPLE_TRANSCRIPT, "actor": "user-alex"},
    {"wf": "wf-meeting-actions", "offset": 3.4, "status": "completed", "trigger": "upload", "input": SAMPLE_TRANSCRIPT, "actor": "user-priya"},
    {"wf": "wf-project-health", "offset": 1.9, "status": "completed", "trigger": "schedule", "input": SAMPLE_HEALTH, "actor": "user-priya"},
    {"wf": "wf-project-health", "offset": 8.9, "status": "completed", "trigger": "schedule", "input": SAMPLE_HEALTH, "actor": "user-priya"},
    {"wf": "wf-asset-review", "offset": 1.2, "status": "completed", "trigger": "upload", "input": SAMPLE_ASSET, "actor": "user-elena"},
    {"wf": "wf-asset-review", "offset": 4.6, "status": "waiting", "trigger": "upload", "input": {"asset": "promo-banner.psd", "category": "review"}, "actor": "user-elena"},
]


class AuditChain:
    """Collects audit events, then emits them hash-chained in timestamp order.

    Production ``app.audit.record_audit`` selects the previous event by
    ``timestamp desc``, so a verifiable chain must be linked in timestamp order.
    We buffer every event during seeding and chain them at the end so the demo
    trail validates with the exact same recomputation the app would use.
    """

    def __init__(self) -> None:
        self._specs: list[dict[str, Any]] = []

    def add(self, actor_type: str, actor_id: str, action: str, resource_type: str, resource_id: str, metadata: dict[str, Any], timestamp: datetime) -> None:
        self._specs.append(
            {
                "actor_type": actor_type, "actor_id": actor_id, "action": action,
                "resource_type": resource_type, "resource_id": resource_id,
                "metadata": metadata, "timestamp": timestamp,
            }
        )

    def build(self) -> list[AuditEvent]:
        ordered = sorted(self._specs, key=lambda s: (s["timestamp"], s["action"], s["resource_id"]))
        events: list[AuditEvent] = []
        previous: str | None = None
        for index, spec in enumerate(ordered, start=1):
            canonical = json.dumps(spec["metadata"], sort_keys=True, separators=(",", ":"))
            immutable_hash = hashlib.sha256(
                f"{previous or 'genesis'}:{spec['action']}:{spec['resource_type']}:{spec['resource_id']}:{canonical}".encode()
            ).hexdigest()
            previous = immutable_hash
            events.append(
                AuditEvent(
                    id=f"audit-{index:04d}", tenant_id=TENANT_ID,
                    actor_type=spec["actor_type"], actor_id=spec["actor_id"], action=spec["action"],
                    resource_type=spec["resource_type"], resource_id=spec["resource_id"],
                    timestamp=spec["timestamp"], metadata_=spec["metadata"], immutable_hash=immutable_hash,
                )
            )
        return events


async def _wipe_tenant(session: Any) -> None:
    run_ids = (await session.scalars(select(WorkflowRun.id).where(WorkflowRun.tenant_id == TENANT_ID))).all()
    if run_ids:
        await session.execute(delete(StepRun).where(StepRun.run_id.in_(run_ids)))
    await session.execute(delete(WorkflowRun).where(WorkflowRun.tenant_id == TENANT_ID))
    workflow_ids = (await session.scalars(select(Workflow.id).where(Workflow.tenant_id == TENANT_ID))).all()
    if workflow_ids:
        await session.execute(delete(WorkflowVersion).where(WorkflowVersion.workflow_id.in_(workflow_ids)))
    await session.execute(delete(Workflow).where(Workflow.tenant_id == TENANT_ID))
    await session.execute(delete(AuditEvent).where(AuditEvent.tenant_id == TENANT_ID))
    await session.execute(delete(User).where(User.tenant_id == TENANT_ID))
    await session.execute(delete(Tenant).where(Tenant.id == TENANT_ID))
    await session.commit()


async def seed_demo() -> dict[str, int]:
    await create_schema()
    executor = NativeExecutor()
    chain = AuditChain()
    counts = {"users": 0, "workflows": 0, "versions": 0, "runs": 0, "step_runs": 0, "audits": 0}

    async with SessionFactory() as session:
        await _wipe_tenant(session)

        session.add(
            Tenant(
                id=TENANT_ID, name="Northstar Projects", slug="northstar-projects", plan="business",
                settings={"default_timezone": "Europe/Warsaw", "human_approval_required": True, "safe_test_default": True},
                data_region="eu-central-1", created_at=days_ago(120),
            )
        )
        await session.flush()

        for spec in USERS:
            session.add(User(tenant_id=TENANT_ID, status="active", locale="en", timezone="Europe/Warsaw", **spec))
            counts["users"] += 1
        await session.flush()

        for wf in WORKFLOWS:
            created_at = days_ago(wf["created"])
            version_id = f"version-{wf['id']}-1"
            workflow = Workflow(
                id=wf["id"], tenant_id=TENANT_ID, name=wf["name"], description=wf["description"],
                # active_version_id is the working version even for drafts, matching create_workflow.
                status=wf["status"], active_version_id=version_id,
                owner_id=wf["owner_id"], department=wf["department"], risk_level=wf["risk_level"],
                created_at=created_at, updated_at=created_at,
            )
            session.add(workflow)
            counts["workflows"] += 1
            session.add(
                WorkflowVersion(
                    id=version_id, workflow_id=wf["id"], version_number=1,
                    canonical_definition=wf["definition"], generated_explanation=wf["explanation"],
                    validation_result={"valid": True, "errors": []},
                    runtime_plan={"primary_runtime": "native", "safe_test": True, "estimated_cost_usd": [0.02, 0.09]},
                    created_by=wf["owner_id"], created_at=created_at,
                    published_at=created_at if wf["status"] != "draft" else None,
                )
            )
            counts["versions"] += 1
            chain.add("user", wf["owner_id"], "workflow.created", "workflow", wf["id"], {"version_id": version_id}, created_at)
            if wf["status"] != "draft":
                published_at = created_at + timedelta(hours=2)
                chain.add("user", wf["owner_id"], "workflow.published", "workflow", wf["id"], {"version_number": 1}, published_at)
        await session.flush()

        wf_by_id = {wf["id"]: wf for wf in WORKFLOWS}
        run_seq = 1048
        for plan in sorted(RUN_PLAN, key=lambda p: -p["offset"]):
            wf = wf_by_id[plan["wf"]]
            started = days_ago(plan["offset"])
            run_id = f"run-{run_seq}"
            run_seq += 1
            definition = CanonicalWorkflow.model_validate(wf["definition"])
            results = await executor.execute(definition, dict(plan["input"]))

            status = plan["status"]
            if status == "completed":
                kept = results
                finished: datetime | None = started + timedelta(seconds=len(results) * 22)
                current_step = None
                error = None
            elif status == "waiting":
                # Pause at the human/approval or wait step: keep steps up to and including the wait/condition.
                pause_index = next((i for i, r in enumerate(results) if r.step_id in {"wait", "check", "gate"}), 1)
                kept = results[: pause_index + 1]
                finished = None
                current_step = kept[-1].step_id
                error = None
            else:  # failed
                kept = results[: max(1, len(results) - 1)]
                finished = started + timedelta(seconds=len(kept) * 20)
                current_step = kept[-1].step_id
                error = "Downstream tool connection timed out during safe test (demo failure)."

            token_usage = sum(int(r.model_usage.get("input_units", 0)) + int(r.model_usage.get("output_units", 0)) for r in kept)
            cost = round(0.012 * len([r for r in kept if r.model_usage]) + 0.004 * len(kept), 3)

            session.add(
                WorkflowRun(
                    id=run_id, tenant_id=TENANT_ID, workflow_id=wf["id"], workflow_version_id=f"version-{wf['id']}-1",
                    status=status, trigger_type=plan["trigger"], trigger_payload=plan["input"],
                    started_at=started, finished_at=finished, current_step_id=current_step,
                    total_cost=cost, token_usage=token_usage, error_summary=error,
                    idempotency_key=f"demo-{run_id}", trace_id=run_id.replace("run-", "trace"),
                )
            )
            counts["runs"] += 1
            for offset, result in enumerate(kept):
                step_started = started + timedelta(seconds=offset * 20)
                session.add(
                    StepRun(
                        id=f"step-{run_id}-{result.step_id}", run_id=run_id, step_id=result.step_id,
                        status="completed" if (status != "failed" or offset < len(kept) - 1) else "failed",
                        attempt=1, started_at=step_started, finished_at=step_started + timedelta(seconds=12),
                        input_data=result.input_data, output_data=result.output_data,
                        model_usage=result.model_usage, tool_usage=result.tool_usage,
                        error=error if (status == "failed" and offset == len(kept) - 1) else None,
                    )
                )
                counts["step_runs"] += 1

            chain.add(plan["actor"], plan["actor"], "run.started", "workflow_run", run_id, {"workflow_id": wf["id"], "trigger": plan["trigger"]}, started)
            if status == "completed":
                chain.add("system", "executor", "run.completed", "workflow_run", run_id, {"steps": len(kept), "cost_usd": cost}, finished or started)
            elif status == "failed":
                chain.add("system", "executor", "run.failed", "workflow_run", run_id, {"error_type": "ToolTimeout"}, finished or started)

        for event in chain.build():
            session.add(event)
            counts["audits"] += 1
        await session.commit()

    await engine.dispose()
    return counts


if __name__ == "__main__":
    summary = asyncio.run(seed_demo())
    print("Demo workspace loaded:", json.dumps(summary, indent=2))
