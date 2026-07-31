"""Pydantic contracts for WorkPilot.

Two responsibilities live here:

1. The ``workpilot.io/v1`` *canonical workflow* schema (``CanonicalWorkflow`` and
   its discriminated ``WorkflowStep`` union). This is the versioned source of
   truth for a workflow's shape — it is validated on write, stored as JSON in
   ``workflow_versions.canonical_definition``, and re-validated before every run.
   ``validate_graph`` enforces the structural invariants (unique ids, edges
   reference known steps, an end step exists, no unreachable steps).
2. The request/response DTOs for the HTTP API (``WorkflowCreate``,
   ``WorkflowDetail``, ``RunCreate``, ``RunRead``, ``AuditRead`` …).

Note the ``from``/``apiVersion`` aliases: the wire format uses ``from`` and
``apiVersion`` (JS-friendly), while Python attributes use ``from_step`` and
``api_version``.
"""

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_serializer, model_validator


def utc_iso(dt: datetime | None) -> str | None:
    """Serialize naive UTC datetimes with an explicit Z suffix for clients."""
    if dt is None:
        return None
    return f"{dt.isoformat()}Z"


class Trigger(BaseModel):
    type: Literal["manual", "schedule", "webhook", "email", "upload", "form"] = "manual"
    label: str = "Manual start"
    config: dict[str, Any] = Field(default_factory=dict)


class BaseStep(BaseModel):
    id: str = Field(min_length=1, max_length=120, pattern=r"^[a-zA-Z][a-zA-Z0-9_-]*$")
    name: str = Field(min_length=2, max_length=180)


class AITaskStep(BaseStep):
    type: Literal["ai_task"]
    task: Literal["extract", "summarize", "classify", "prepare"] = "extract"
    output_schema: dict[str, Any] = Field(default_factory=dict)


class ToolStep(BaseStep):
    """A step that reaches a third-party system.

    ``connection_id`` + ``tool_name`` are what make the call real: when both are
    set the executor resolves the tenant's stored credential and invokes that
    tool over MCP. Without them the step can only report that it was prepared,
    which is how every step behaved before connections existed.

    ``mode`` drives the safety policy, not ``dry_run``: reads always execute,
    writes are refused unless ``WORKPILOT_ALLOW_TOOL_WRITES`` is enabled.

    ``arguments`` values may reference earlier step output with ``{{ref}}``
    templates, e.g. ``{"project_id": "{{fetchProjects.projects.0.id}}"}``.
    """

    type: Literal["tool"]
    # Free-form since 0.2: the Phase-1 enum (prepare_tasks / prepare_message /
    # update_record) had no read verb, so "fetch Scoro projects" had nowhere to
    # go. Old stored definitions still validate.
    operation: str = Field(default="fetch_records", max_length=80)
    dry_run: bool = True
    connection_id: str | None = None
    tool_name: str | None = None
    arguments: dict[str, Any] = Field(default_factory=dict)
    mode: Literal["read", "write"] = "read"

    @property
    def is_bound(self) -> bool:
        """True when this step names a real connection and tool to call."""
        return bool(self.connection_id and self.tool_name)


class ConditionStep(BaseStep):
    type: Literal["condition"]
    field: str
    operator: Literal[
        "equals", "not_equals", "is_empty", "is_not_empty", "contains"
    ] = "equals"
    value: Any = None


class WaitStep(BaseStep):
    type: Literal["wait"]
    duration_seconds: int = Field(default=0, ge=0, le=86400)


class EndStep(BaseStep):
    type: Literal["end"]
    outcome: Literal["completed", "needs_review", "stopped"] = "completed"


WorkflowStep = Annotated[
    AITaskStep | ToolStep | ConditionStep | WaitStep | EndStep,
    Field(discriminator="type"),
]


class WorkflowEdge(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    from_step: str = Field(alias="from")
    to: str
    label: str | None = None


class CanonicalWorkflow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    api_version: Literal["workpilot.io/v1"] = Field(alias="apiVersion", default="workpilot.io/v1")
    kind: Literal["Workflow"] = "Workflow"
    trigger: Trigger = Field(default_factory=Trigger)
    steps: list[WorkflowStep] = Field(min_length=1, max_length=100)
    edges: list[WorkflowEdge] = Field(default_factory=list)
    # Optional runtime override — "agentcore", "bedrock_langgraph", or "deterministic".
    # When set, this workflow ignores the global WORKPILOT_AGENT_RUNTIME setting.
    runtime_override: str | None = None

    @model_validator(mode="after")
    def validate_graph(self) -> "CanonicalWorkflow":
        ids = [step.id for step in self.steps]
        if len(ids) != len(set(ids)):
            raise ValueError("step ids must be unique")
        known = set(ids)
        for edge in self.edges:
            if edge.from_step not in known or edge.to not in known:
                raise ValueError(f"edge {edge.from_step}->{edge.to} references an unknown step")
        if not any(step.type == "end" for step in self.steps):
            raise ValueError("workflow must contain an end step")
        if len(self.steps) > 1:
            reachable = {self.steps[0].id}
            changed = True
            while changed:
                changed = False
                for edge in self.edges:
                    if edge.from_step in reachable and edge.to not in reachable:
                        reachable.add(edge.to)
                        changed = True
            unreachable = known - reachable
            if unreachable:
                raise ValueError(f"unreachable steps: {', '.join(sorted(unreachable))}")
        return self


class WorkflowCreate(BaseModel):
    name: str = Field(min_length=3, max_length=180)
    description: str = Field(default="", max_length=2000)
    department: str = Field(default="Operations", min_length=2, max_length=100)
    risk_level: Literal["low", "medium", "high"] = "low"
    definition: CanonicalWorkflow


class WorkflowUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=3, max_length=180)
    description: str | None = Field(default=None, max_length=2000)
    department: str | None = Field(default=None, min_length=2, max_length=100)
    risk_level: Literal["low", "medium", "high"] | None = None
    status: Literal["draft", "active", "paused"] | None = None


class WorkflowDefinitionUpdate(BaseModel):
    """Body for saving edits made in the workflow builder (steps/edges)."""

    definition: CanonicalWorkflow


class WorkflowRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    description: str
    status: str
    department: str
    risk_level: str
    active_version_id: str | None
    owner_id: str
    created_at: datetime
    updated_at: datetime

    @field_serializer("created_at", "updated_at")
    def serialize_dt(self, value: datetime) -> str:
        return utc_iso(value) or value.isoformat()


class WorkflowDetail(WorkflowRead):
    version_number: int
    definition: CanonicalWorkflow
    explanation: str
    validation_result: dict[str, Any]
    runtime_plan: dict[str, Any]


class RunCreate(BaseModel):
    input: dict[str, Any] = Field(default_factory=dict)
    trigger_type: str = Field(default="manual", max_length=50)
    idempotency_key: str | None = Field(default=None, min_length=8, max_length=180)


class StepRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    step_id: str
    status: str
    attempt: int
    started_at: datetime
    finished_at: datetime | None
    input_data: dict[str, Any]
    output_data: dict[str, Any]
    model_usage: dict[str, Any]
    tool_usage: dict[str, Any]
    error: str | None

    @field_serializer("started_at", "finished_at")
    def serialize_step_dt(self, value: datetime | None) -> str | None:
        return utc_iso(value)


class RunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    workflow_id: str
    workflow_name: str | None = None
    workflow_version_id: str
    status: str
    trigger_type: str
    started_at: datetime
    finished_at: datetime | None
    current_step_id: str | None
    total_cost: float
    token_usage: int
    error_summary: str | None
    trace_id: str
    steps: list[StepRunRead] = Field(default_factory=list)

    @field_serializer("started_at", "finished_at")
    def serialize_run_dt(self, value: datetime | None) -> str | None:
        return utc_iso(value)


class ConnectionToolRead(BaseModel):
    """One tool discovered on a connected server."""

    name: str
    description: str = ""
    read_only: bool = True
    input_schema: dict[str, Any] = Field(default_factory=dict)


class ConnectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    connector_id: str = Field(default="custom", max_length=80)
    kind: Literal["mcp", "api_key"] = "mcp"
    base_url: str = Field(min_length=4, max_length=500)
    # Write-only: accepted on input, never echoed back in any response.
    token: str | None = Field(default=None, max_length=4000)


class ConnectionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=180)
    base_url: str | None = Field(default=None, min_length=4, max_length=500)
    token: str | None = Field(default=None, max_length=4000)


class ConnectionRead(BaseModel):
    """A connection as returned to clients — never includes the credential."""

    id: str
    connector_id: str
    name: str
    kind: str
    base_url: str
    status: str
    has_token: bool
    token_hint: str = ""
    tools: list[ConnectionToolRead] = Field(default_factory=list)
    server_info: dict[str, Any] = Field(default_factory=dict)
    last_error: str | None = None
    last_checked_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    @field_serializer("last_checked_at", "created_at", "updated_at")
    def serialize_connection_dt(self, value: datetime | None) -> str | None:
        return utc_iso(value)


# The roles WorkPilot grants today. Kept as a Literal (not a free string) so an
# unknown role is rejected at the edge rather than silently stored.
TeamRole = Literal["workflow_admin", "workflow_builder", "approver", "operator", "viewer"]
TeamMemberStatus = Literal["active", "invited", "suspended"]


class TeamMemberRead(BaseModel):
    """A person in the workspace — a row of ``users``, not a separate entity."""

    model_config = ConfigDict(from_attributes=True)
    id: str
    email: str
    name: str
    # Free-form on read: seeded demo rows carry legacy roles ("finance_reviewer",
    # "creative_lead") that predate the role enum, and hiding them behind a 500
    # would be worse than showing them.
    role: str
    status: str
    locale: str
    timezone: str


class TeamMemberCreate(BaseModel):
    """An invitation. ``status`` is not accepted — invitees always start invited."""

    email: str = Field(min_length=3, max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    name: str = Field(min_length=2, max_length=180)
    role: TeamRole = "operator"


class TeamMemberUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=180)
    role: TeamRole | None = None
    status: TeamMemberStatus | None = None


class WorkspaceRead(BaseModel):
    """The current tenant. ``slug`` is immutable — it appears in stored references."""

    id: str
    name: str
    slug: str
    plan: str
    data_region: str
    member_count: int
    workflow_count: int


class WorkspaceUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=180)


class WorkspaceSettingsRead(BaseModel):
    """Tenant settings merged over defaults.

    ``allow_tool_writes`` is reported from the server's own configuration
    (``WORKPILOT_ALLOW_TOOL_WRITES``), never from the tenant document — a
    workspace admin must not be able to unlock live writes from the UI.
    """

    allow_tool_writes: bool
    require_approval_for_writes: bool
    max_run_cost_usd: float
    data_region: str
    notify_on_run_failure: bool
    notify_on_approval_needed: bool
    notify_email: str
    retain_run_days: int


class WorkspaceSettingsUpdate(BaseModel):
    """Writable settings only. Unset fields keep their stored value."""

    require_approval_for_writes: bool | None = None
    max_run_cost_usd: float | None = Field(default=None, ge=0, le=1000)
    data_region: str | None = Field(default=None, min_length=2, max_length=40)
    notify_on_run_failure: bool | None = None
    notify_on_approval_needed: bool | None = None
    notify_email: str | None = Field(default=None, max_length=320)
    retain_run_days: int | None = Field(default=None, ge=1, le=3650)


class AuditRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    actor_type: str
    actor_id: str
    action: str
    resource_type: str
    resource_id: str
    timestamp: datetime
    metadata: dict[str, Any]
    immutable_hash: str

    @field_serializer("timestamp")
    def serialize_audit_dt(self, value: datetime) -> str:
        return utc_iso(value) or value.isoformat()
