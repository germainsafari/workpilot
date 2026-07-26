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

from pydantic import BaseModel, ConfigDict, Field, model_validator


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
    type: Literal["tool"]
    operation: Literal["prepare_tasks", "prepare_message", "update_record"]
    dry_run: bool = True


class ConditionStep(BaseStep):
    type: Literal["condition"]
    field: str
    operator: Literal["equals", "not_equals", "is_empty", "is_not_empty"] = "equals"
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


class RunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    workflow_id: str
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
