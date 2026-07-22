import asyncio
from dataclasses import dataclass, field
from typing import Any

from app.schemas import AITaskStep, CanonicalWorkflow, ConditionStep, EndStep, ToolStep, WaitStep


class ExecutionPolicyError(RuntimeError):
    """Raised when a workflow asks for an action outside its granted safety policy."""


@dataclass(frozen=True)
class StepResult:
    step_id: str
    status: str
    input_data: dict[str, Any]
    output_data: dict[str, Any]
    model_usage: dict[str, Any] = field(default_factory=dict)
    tool_usage: dict[str, Any] = field(default_factory=dict)


class DeterministicMockModel:
    async def execute(
        self, step: AITaskStep, input_data: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        if step.task == "extract":
            deadline = input_data.get("deadline")
            output = {
                "client": input_data.get("client", "Sample client"),
                "project_type": input_data.get("project_type", "Campaign delivery"),
                "deliverables": input_data.get("deliverables", ["Campaign concept", "Launch assets"]),
                "deadline": deadline,
                "markets": input_data.get("markets", ["Poland", "Germany"]),
                "missing_details": [] if deadline else ["deadline"],
                "reasoning_summary": (
                    "All required delivery fields are present."
                    if deadline
                    else "A delivery date is required before project tasks can be prepared."
                ),
            }
        elif step.task == "summarize":
            output = {
                "summary": "Sample workflow summary generated deterministically.",
                "source_fields": sorted(input_data),
            }
        elif step.task == "classify":
            output = {"category": "standard", "confidence": 1.0}
        else:
            output = {"draft": {"title": "Prepared output", "fields": sorted(input_data)}}
        return output, {"provider": "deterministic_mock", "input_units": 0, "output_units": 0, "cost_usd": 0}


class NativeExecutor:
    def __init__(self, model: DeterministicMockModel | None = None) -> None:
        self.model = model or DeterministicMockModel()

    async def execute(self, workflow: CanonicalWorkflow, initial_input: dict[str, Any]) -> list[StepResult]:
        step_map = {step.id: step for step in workflow.steps}
        outgoing: dict[str, list[Any]] = {step.id: [] for step in workflow.steps}
        for edge in workflow.edges:
            outgoing[edge.from_step].append(edge)

        current_id: str | None = workflow.steps[0].id
        context = dict(initial_input)
        results: list[StepResult] = []
        visited: set[str] = set()

        while current_id is not None:
            if current_id in visited:
                raise ExecutionPolicyError(f"cycle detected at step {current_id}")
            visited.add(current_id)
            step = step_map[current_id]
            step_input = dict(context)
            output: dict[str, Any] = {}
            model_usage: dict[str, Any] = {}
            tool_usage: dict[str, Any] = {}

            if isinstance(step, AITaskStep):
                output, model_usage = await self.model.execute(step, step_input)
            elif isinstance(step, ToolStep):
                if not step.dry_run:
                    raise ExecutionPolicyError(
                        "live external writes require an approval engine and are disabled in Phase 1"
                    )
                output = {
                    "prepared": True,
                    "operation": step.operation,
                    "mode": "dry_run",
                    "records_changed": 0,
                }
                tool_usage = {"operation": step.operation, "dry_run": True, "idempotent": True}
            elif isinstance(step, ConditionStep):
                actual = context.get(step.field)
                if step.operator == "equals":
                    matched = actual == step.value
                elif step.operator == "not_equals":
                    matched = actual != step.value
                elif step.operator == "is_empty":
                    matched = actual in (None, "", [], {})
                else:
                    matched = actual not in (None, "", [], {})
                output = {"condition_matched": matched, "actual": actual, "operator": step.operator}
            elif isinstance(step, WaitStep):
                await asyncio.sleep(min(step.duration_seconds, 1) * 0.01)
                output = {"waited_seconds": step.duration_seconds, "simulated": True}
            elif isinstance(step, EndStep):
                output = {"outcome": step.outcome}

            results.append(
                StepResult(
                    step_id=step.id,
                    status="completed",
                    input_data=step_input,
                    output_data=output,
                    model_usage=model_usage,
                    tool_usage=tool_usage,
                )
            )
            context.update(output)
            candidates = outgoing.get(step.id, [])
            if isinstance(step, ConditionStep) and len(candidates) > 1:
                matched = bool(output["condition_matched"])
                labels = (
                    {"true", "yes", "matched", "ready"}
                    if matched
                    else {"false", "no", "otherwise", "missing"}
                )
                selected = next(
                    (edge for edge in candidates if (edge.label or "").lower() in labels), candidates[0]
                )
                current_id = selected.to
            else:
                current_id = candidates[0].to if candidates else None
        return results
