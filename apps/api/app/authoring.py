"""Authoring: turning plain English into a real workflow, and back again.

Two jobs live here, both of which used to be faked in the browser:

* **Compiling.** ``compile_description`` asks Bedrock to author a canonical
  workflow against the tenant's *actual* tool catalog, then refuses to trust the
  answer: every ``connection_id``/``tool_name`` is checked against the catalog
  (an invented binding is stripped rather than shipped as a step that would
  explode at runtime), and the whole graph goes through
  ``CanonicalWorkflow.model_validate``. One retry with the validation error fed
  back, then a safe generic definition with ``ai_compiled=False`` — the caller is
  always told when the model did not deliver, because the previous behaviour of
  quietly substituting a template made a failed compile look like a success.

* **Explaining.** ``build_explanation`` derives the plain-language description
  from the definition itself, and the cost estimate from ``workflow_runs`` rather
  than from prose someone typed once. When a workflow has never run there is no
  number to show, so it says so.

The DTOs live here (not in ``app.schemas``) because they are authoring-surface
concerns, not part of the versioned ``workpilot.io/v1`` contract.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Connection, WorkflowRun
from app.schemas import CanonicalWorkflow, ToolStep, WorkflowDetail

logger = logging.getLogger(__name__)

# The compile prompt carries the whole catalog; a huge workspace would otherwise
# blow the context window (and the bill) on tools the description never needs.
_MAX_CATALOG_TOOLS = 60
_MAX_TOOL_DESCRIPTION_CHARS = 400


# ── request / response DTOs ───────────────────────────────────────────────


class CompileRequest(BaseModel):
    description: str = Field(min_length=3, max_length=2000)


class ToolBindingRead(BaseModel):
    """A tool step that ended up pointing at a real, callable tool."""

    step_id: str
    step_name: str
    connection_id: str
    connection_name: str
    tool_name: str


class DroppedBindingRead(BaseModel):
    """A binding the model invented, and what we did about it."""

    step_id: str
    connection_id: str | None = None
    tool_name: str | None = None
    reason: str


class CompileResponse(BaseModel):
    definition: CanonicalWorkflow
    rationale: str
    # False means the definition below is the safe fallback, not the model's work.
    ai_compiled: bool
    compile_error: str | None = None
    bound_tools: list[ToolBindingRead] = Field(default_factory=list)
    dropped_bindings: list[DroppedBindingRead] = Field(default_factory=list)
    # How many callable tools the compiler had to choose from. Zero explains a
    # tool-free result far better than an apology from the model would.
    catalog_size: int = 0


# ── explanation DTOs ──────────────────────────────────────────────────────


class ExplanationStep(BaseModel):
    order: int
    step_id: str
    name: str
    type: str
    detail: str
    # "Scoro (Admind) · list_projects" for a bound tool step, else None.
    binding: str | None = None


class CostEstimate(BaseModel):
    """What this workflow has actually cost, never what we imagine it costs."""

    sample_size: int
    average_cost_usd: float | None = None
    average_tokens: int | None = None
    # Ready-to-render copy: "No runs yet" when sample_size is 0.
    headline: str
    caption: str


class WorkflowExplanation(BaseModel):
    summary: str
    trigger: str
    steps: list[ExplanationStep] = Field(default_factory=list)
    approval: str
    on_failure: str
    safeguards: list[str] = Field(default_factory=list)
    cost: CostEstimate


class WorkflowDetailWithExplanation(WorkflowDetail):
    """``WorkflowDetail`` plus the structured explanation.

    Subclassed rather than added to ``WorkflowDetail`` so the existing
    ``explanation`` string keeps its shape and older clients are unaffected.
    """

    explanation_detail: WorkflowExplanation


# ── tool catalog ──────────────────────────────────────────────────────────


async def load_tool_catalog(session: AsyncSession, tenant_id: str) -> list[dict[str, Any]]:
    """Every tool this tenant can currently call, flattened.

    Deliberately the same shape and filtering as ``GET /v1/connections/tools``:
    connected connections only, and write-capable tools excluded unless
    ``WORKPILOT_ALLOW_TOOL_WRITES`` is on — the compiler must not be able to
    author a step the executor would refuse.
    """
    allow_writes = get_settings().allow_tool_writes
    rows = await session.scalars(
        select(Connection).where(
            Connection.tenant_id == tenant_id,
            Connection.status == "connected",
        )
    )
    catalog: list[dict[str, Any]] = []
    for connection in rows:
        for tool in connection.tool_catalog or []:
            if not isinstance(tool, dict) or not tool.get("name"):
                continue
            read_only = bool(tool.get("read_only", True))
            if not read_only and not allow_writes:
                continue
            catalog.append(
                {
                    "connection_id": connection.id,
                    "connection_name": connection.name,
                    "connector_id": connection.connector_id,
                    "tool_name": tool["name"],
                    "description": tool.get("description", ""),
                    "read_only": read_only,
                    "input_schema": tool.get("input_schema", {}),
                }
            )
    return catalog


def _catalog_for_prompt(catalog: list[dict[str, Any]]) -> str:
    lines = []
    for tool in catalog[:_MAX_CATALOG_TOOLS]:
        lines.append(
            json.dumps(
                {
                    "connection_id": tool["connection_id"],
                    "connection_name": tool["connection_name"],
                    "tool_name": tool["tool_name"],
                    "description": (tool.get("description") or "")[:_MAX_TOOL_DESCRIPTION_CHARS],
                    "input_schema": tool.get("input_schema") or {},
                },
                default=str,
            )
        )
    return "\n".join(lines) if lines else "(no tools are connected)"


# ── prompting ─────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """You are WorkPilot's workflow compiler. You turn a business \
person's plain-English description into a canonical workflow graph.

Return ONLY a JSON object with two keys and nothing else:
  "workflow":  the canonical workflow object
  "rationale": two or three sentences of plain English explaining the shape you \
chose and which connected tools you used.

The workflow object must match this schema exactly:
{
  "apiVersion": "workpilot.io/v1",
  "kind": "Workflow",
  "trigger": {"type": "manual|schedule|webhook|email|upload|form", "label": "<short phrase>"},
  "steps": [ ... ],
  "edges": [ {"from": "<stepId>", "to": "<stepId>"} ]
}

Step ids must start with a letter and contain only letters, digits, "_" or "-". \
Step names are 2-180 characters. Allowed step objects:

  {"id": .., "name": .., "type": "tool", "operation": "<verb_phrase>", \
"connection_id": "<from the catalog>", "tool_name": "<from the catalog>", \
"arguments": {..}, "mode": "read", "dry_run": true}
  {"id": .., "name": .., "type": "ai_task", "task": "extract|summarize|classify|prepare"}
  {"id": .., "name": .., "type": "condition", "field": "<path>", \
"operator": "equals|not_equals|is_empty|is_not_empty|contains", "value": <any>}
  {"id": .., "name": .., "type": "wait", "duration_seconds": <0-86400>}
  {"id": .., "name": .., "type": "end", "outcome": "completed|needs_review|stopped"}

Hard rules:
* Every workflow ends with exactly one "end" step, and every step must be \
reachable by following edges from the first step in the list.
* For a "tool" step, "connection_id" and "tool_name" MUST be copied verbatim \
from the CONNECTED TOOLS catalog. Never invent either one. If nothing in the \
catalog fits, use an "ai_task" step instead of a made-up tool.
* "arguments" keys must come from that tool's input_schema. To pass a value \
produced by an earlier step, use a "{{stepId.field}}" template, e.g. \
{"project_id": "{{fetchProjects.projects.0.id}}"}. Omit arguments you cannot \
determine rather than guessing.
* Only read-only tools are available, so "mode" is always "read".
* Prefer the smallest graph that does the job: fetch what is needed, reason \
about it, finish.
No prose outside the JSON. No code fences."""


def _extract_json_object(text: str) -> dict[str, Any]:
    """Pull the JSON object out of a model reply.

    Nova wraps its answer in ``<response>`` tags and narrates in ``<thinking>``
    first; left in place the chain-of-thought is what we would try to parse.
    A code fence is tolerated even though the prompt forbids one.
    """
    body = text.strip()

    response_match = re.search(r"<response>(.*?)</response>", body, re.S | re.I)
    if response_match:
        body = response_match.group(1).strip()
    else:
        body = re.sub(r"<thinking>.*?</thinking>", "", body, flags=re.S | re.I).strip()

    if body.startswith("```"):
        parts = body.split("```", 2)
        if len(parts) >= 2:
            body = parts[1]
            if body.lstrip().lower().startswith("json"):
                body = body.lstrip()[4:]
            body = body.strip()

    # A model that adds a trailing sentence still leaves a parseable object
    # between the outermost braces.
    start = body.find("{")
    end = body.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("the model returned no JSON object")
    parsed = json.loads(body[start : end + 1])
    if not isinstance(parsed, dict):
        raise ValueError("the model returned JSON that is not an object")
    return parsed


def _message_text(content: Any) -> str:
    """Flatten a Bedrock Converse reply (a list of content blocks) to text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and block.get("type") in (None, "text")
        ]
        return "".join(parts) or json.dumps(content, default=str)
    return json.dumps(content, default=str)


async def _ask_model(messages: list[dict[str, str]]) -> str:
    settings = get_settings()
    # Lazy import so the module loads without langchain installed.
    from langchain_aws import ChatBedrockConverse

    kwargs: dict[str, Any] = {
        "model_id": settings.bedrock_model_id,
        "region_name": settings.bedrock_region,
    }
    if settings.aws_profile:
        kwargs["credentials_profile_name"] = settings.aws_profile
    llm = ChatBedrockConverse(**kwargs)
    reply = await llm.ainvoke(messages)
    return _message_text(getattr(reply, "content", ""))


# ── binding validation ────────────────────────────────────────────────────


def sanitize_bindings(
    raw_workflow: dict[str, Any], catalog: list[dict[str, Any]]
) -> list[DroppedBindingRead]:
    """Strip any tool binding that does not exist, editing ``raw_workflow`` in place.

    A step naming a connection or tool the tenant does not have would fail the
    moment it ran, and the failure would look like a broken integration rather
    than a hallucination. Better to hand back an unbound step: the graph is still
    valid, and the UI can show that nothing was bound.
    """
    known = {(tool["connection_id"], tool["tool_name"]) for tool in catalog}
    known_connections = {tool["connection_id"] for tool in catalog}
    dropped: list[DroppedBindingRead] = []

    for step in raw_workflow.get("steps") or []:
        if not isinstance(step, dict) or step.get("type") != "tool":
            continue
        connection_id = step.get("connection_id")
        tool_name = step.get("tool_name")
        if not connection_id and not tool_name:
            continue

        if not connection_id or not tool_name:
            reason = "Only half of the binding was supplied (needs both a connection and a tool)."
        elif connection_id not in known_connections:
            reason = f"No connected system with id {connection_id!r} exists in this workspace."
        elif (connection_id, tool_name) not in known:
            reason = f"That connection does not offer a callable tool named {tool_name!r}."
        else:
            continue

        dropped.append(
            DroppedBindingRead(
                step_id=str(step.get("id") or "?"),
                connection_id=connection_id if isinstance(connection_id, str) else None,
                tool_name=tool_name if isinstance(tool_name, str) else None,
                reason=reason,
            )
        )
        step["connection_id"] = None
        step["tool_name"] = None
        step["arguments"] = {}

    return dropped


def normalize_step_order(raw_workflow: dict[str, Any]) -> None:
    """Put the graph's entry step first.

    The canonical contract intentionally uses the first step as the entrypoint,
    while models often emit steps in narrative order or place the finish first.
    If the edges describe one unambiguous root, ordering the list from that root
    preserves the graph and prevents an otherwise valid workflow from being
    rejected as entirely unreachable.
    """
    steps = raw_workflow.get("steps")
    edges = raw_workflow.get("edges")
    if not isinstance(steps, list) or not isinstance(edges, list) or len(steps) < 2:
        return
    by_id: dict[str, dict[str, Any]] = {}
    for step in steps:
        if not isinstance(step, dict):
            continue
        step_id = step.get("id")
        if isinstance(step_id, str):
            by_id[step_id] = step
    incoming = {step_id: 0 for step_id in by_id}
    outgoing: dict[str, list[str]] = {step_id: [] for step_id in by_id}
    for edge in edges:
        if not isinstance(edge, dict):
            continue
        source, target = edge.get("from"), edge.get("to")
        if isinstance(source, str) and isinstance(target, str) and source in by_id and target in by_id:
            incoming[target] += 1
            outgoing[source].append(target)
    roots = [step_id for step_id, count in incoming.items() if count == 0]
    if len(roots) != 1:
        return
    ordered: list[str] = []
    queue = [roots[0]]
    seen: set[str] = set()
    while queue:
        current = queue.pop(0)
        if current in seen:
            continue
        seen.add(current)
        ordered.append(current)
        queue.extend(outgoing[current])
    if len(seen) == len(by_id):
        raw_workflow["steps"] = [by_id[step_id] for step_id in ordered]


def remove_noop_conditions(raw_workflow: dict[str, Any]) -> None:
    """Collapse conditions that have no branch.

    A condition with zero or one outgoing edge cannot make a decision. Models
    sometimes add one merely because the request says "flag"; keeping it makes
    the run look intelligent while it compares one arbitrary scalar and always
    follows the same path. The summarisation step should produce the flag as
    evidence instead.
    """
    steps = raw_workflow.get("steps")
    edges = raw_workflow.get("edges")
    if not isinstance(steps, list) or not isinstance(edges, list):
        return
    for step in list(steps):
        if not isinstance(step, dict) or step.get("type") != "condition":
            continue
        step_id = step.get("id")
        incoming = [edge for edge in edges if isinstance(edge, dict) and edge.get("to") == step_id]
        outgoing = [edge for edge in edges if isinstance(edge, dict) and edge.get("from") == step_id]
        if len(incoming) != 1 or len(outgoing) != 1:
            continue
        before, after = incoming[0], outgoing[0]
        edges.remove(before)
        edges.remove(after)
        edges.append({"from": before.get("from"), "to": after.get("to")})
        steps.remove(step)


def collect_bindings(
    definition: CanonicalWorkflow, catalog: list[dict[str, Any]]
) -> list[ToolBindingRead]:
    """List the tool steps that ended up bound to a real tool."""
    names = {
        (tool["connection_id"], tool["tool_name"]): tool["connection_name"] for tool in catalog
    }
    bindings: list[ToolBindingRead] = []
    for step in definition.steps:
        if not isinstance(step, ToolStep) or not step.is_bound:
            continue
        assert step.connection_id and step.tool_name  # narrowed by is_bound
        bindings.append(
            ToolBindingRead(
                step_id=step.id,
                step_name=step.name,
                connection_id=step.connection_id,
                connection_name=names.get(
                    (step.connection_id, step.tool_name), step.connection_id
                ),
                tool_name=step.tool_name,
            )
        )
    return bindings


# ── the compiler ──────────────────────────────────────────────────────────


def fallback_definition(description: str) -> CanonicalWorkflow:
    """A minimal graph that is always valid and never pretends to call anything."""
    return CanonicalWorkflow.model_validate(
        {
            "apiVersion": "workpilot.io/v1",
            "kind": "Workflow",
            "trigger": {"type": "manual", "label": "Manual start"},
            "steps": [
                {
                    "id": "prepare",
                    "name": "Prepare the request",
                    "type": "ai_task",
                    "task": "prepare",
                },
                {"id": "finish", "name": "Needs review", "type": "end", "outcome": "needs_review"},
            ],
            "edges": [{"from": "prepare", "to": "finish"}],
        }
    )


async def compile_description(
    description: str, catalog: list[dict[str, Any]]
) -> CompileResponse:
    """Compile plain English into a validated, tool-bound canonical workflow."""
    messages: list[dict[str, str]] = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"CONNECTED TOOLS (one JSON object per line):\n{_catalog_for_prompt(catalog)}\n\n"
                f"PROCESS DESCRIPTION:\n{description.strip()}"
            ),
        },
    ]

    last_error = ""
    # Two attempts: the second one is told exactly what was wrong with the first.
    for attempt in (1, 2):
        try:
            reply = await _ask_model(messages)
            payload = _extract_json_object(reply)
            raw_workflow = payload.get("workflow")
            if not isinstance(raw_workflow, dict):
                raise ValueError('the reply had no "workflow" object')
            rationale = str(payload.get("rationale") or "").strip()

            dropped = sanitize_bindings(raw_workflow, catalog)
            remove_noop_conditions(raw_workflow)
            normalize_step_order(raw_workflow)
            definition = CanonicalWorkflow.model_validate(raw_workflow)
        except Exception as exc:
            last_error = f"{type(exc).__name__}: {exc}"
            if _is_missing_credentials(exc):
                # No point retrying: there is no model to talk to.
                logger.warning("Workflow compile unavailable — no Bedrock credentials (%s)", exc)
                break
            logger.warning("Workflow compile attempt %s failed: %s", attempt, last_error)
            if attempt == 1:
                messages.append({"role": "assistant", "content": "(rejected)"})
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "That output was rejected. Fix it and return the corrected JSON "
                            f"object only.\n\nError:\n{last_error}"
                        ),
                    }
                )
            continue

        return CompileResponse(
            definition=definition,
            rationale=rationale or _describe_graph(definition, catalog),
            ai_compiled=True,
            bound_tools=collect_bindings(definition, catalog),
            dropped_bindings=dropped,
            catalog_size=len(catalog),
        )

    definition = fallback_definition(description)
    return CompileResponse(
        definition=definition,
        rationale=(
            "The AI compiler could not produce a valid workflow, so this is a safe "
            "single-step draft that calls nothing. Edit it by hand, or try rewording "
            "the description."
        ),
        ai_compiled=False,
        compile_error=last_error or "The model returned nothing usable.",
        bound_tools=[],
        dropped_bindings=[],
        catalog_size=len(catalog),
    )


def _is_missing_credentials(exc: Exception) -> bool:
    name = type(exc).__name__
    if name in ("NoCredentialsError", "PartialCredentialsError", "NoRegionError"):
        return True
    text = str(exc).lower()
    return "unable to locate credentials" in text or "no credentials" in text


def _describe_graph(definition: CanonicalWorkflow, catalog: list[dict[str, Any]]) -> str:
    """A rationale derived from the graph, for when the model omitted one."""
    bound = collect_bindings(definition, catalog)
    tools = ", ".join(f"{b.connection_name} · {b.tool_name}" for b in bound)
    return (
        f"Starts with {definition.trigger.label.lower()} and runs {len(definition.steps)} steps"
        + (f", calling {tools}." if tools else ", calling no external tools.")
    )


# ── explanations ──────────────────────────────────────────────────────────


def _step_detail(step: Any, tool_names: dict[tuple[str, str], str]) -> tuple[str, str | None]:
    """Plain-language description of one step, plus its binding label if any."""
    if isinstance(step, ToolStep):
        if step.is_bound:
            assert step.connection_id and step.tool_name
            connection = tool_names.get(
                (step.connection_id, step.tool_name), step.connection_id
            )
            args = ", ".join(sorted(step.arguments)) if step.arguments else ""
            detail = (
                f"Calls the {step.tool_name} tool on {connection}"
                + (f", passing {args}" if args else "")
                + (
                    ". This is a read — it looks at data without changing it."
                    if step.mode == "read"
                    else ". This step writes to that system."
                )
            )
            return detail, f"{connection} · {step.tool_name}"
        return (
            f"Marked as a business action ({step.operation}) but not yet connected to a "
            "tool, so it only records that it was reached. Pick a connected tool to make "
            "it real.",
            None,
        )

    if step.type == "ai_task":
        verbs = {
            "extract": "pulls the specific fields out of what the previous steps produced",
            "summarize": "reads what the previous steps produced and writes a short summary, "
            "including anything a person should look at",
            "classify": "sorts what the previous steps produced into a category and says how "
            "confident it is",
            "prepare": "drafts the output, leaving anything it could not determine blank "
            "rather than guessing",
        }
        return f"An AI step that {verbs.get(step.task, 'processes the data')}.", None

    if step.type == "condition":
        return (
            f"Checks whether {step.field} {step.operator.replace('_', ' ')} "
            f"{'' if step.value is None else repr(step.value)}".strip()
            + " and follows the matching path.",
            None,
        )

    if step.type == "wait":
        return f"Pauses for {step.duration_seconds} seconds before continuing.", None

    if step.type == "end":
        outcomes = {
            "completed": "Finishes the run and marks it completed.",
            "needs_review": "Finishes the run and flags it for a person to review.",
            "stopped": "Stops the run here.",
        }
        return outcomes.get(step.outcome, "Finishes the run."), None

    return "Runs this step.", None


def explanation_summary(definition: CanonicalWorkflow) -> str:
    """The one-line explanation stored on the version row.

    Kept as a plain string because ``workflow_versions.generated_explanation`` is
    a text column and older clients read ``explanation`` as a sentence.
    """
    tool_steps = [s for s in definition.steps if isinstance(s, ToolStep) and s.is_bound]
    business = [s for s in definition.steps if s.type != "end"]
    tail = (
        f" calling {len(tool_steps)} connected tool{'' if len(tool_steps) == 1 else 's'},"
        if tool_steps
        else ""
    )
    return (
        f"Starts with {definition.trigger.label.lower()}, runs "
        f"{len(business)} business step{'' if len(business) == 1 else 's'},{tail}"
        " and records every result."
    )


async def cost_estimate(
    session: AsyncSession, tenant_id: str, workflow_id: str
) -> CostEstimate:
    """Average cost per run from this workflow's own history — or nothing at all.

    The UI used to print a hard-coded dollar range. There is no honest number to
    show before the first run, so ``sample_size == 0`` is reported as such.
    """
    rows = list(
        await session.scalars(
            select(WorkflowRun).where(
                WorkflowRun.tenant_id == tenant_id,
                WorkflowRun.workflow_id == workflow_id,
                WorkflowRun.finished_at.is_not(None),
            )
        )
    )
    if not rows:
        return CostEstimate(
            sample_size=0,
            headline="No runs yet",
            caption="Cost is measured from real runs, so there is nothing to show yet.",
        )

    average_cost = sum(run.total_cost or 0.0 for run in rows) / len(rows)
    average_tokens = round(sum(run.token_usage or 0 for run in rows) / len(rows))
    plural = "" if len(rows) == 1 else "s"
    return CostEstimate(
        sample_size=len(rows),
        average_cost_usd=average_cost,
        average_tokens=average_tokens,
        # Model costs land in the fractions of a cent; 4dp would round to $0.0000.
        headline=f"${average_cost:.6f}".rstrip("0").rstrip(".") if average_cost else "$0.00",
        caption=(
            f"average per run across {len(rows)} finished run{plural} "
            f"(~{average_tokens:,} tokens each)"
        ),
    )


def build_explanation(
    definition: CanonicalWorkflow,
    catalog: list[dict[str, Any]],
    cost: CostEstimate,
) -> WorkflowExplanation:
    """Derive the whole plain-language explanation from the definition itself."""
    tool_names = {
        (tool["connection_id"], tool["tool_name"]): tool["connection_name"] for tool in catalog
    }

    steps: list[ExplanationStep] = []
    for index, step in enumerate(definition.steps, start=1):
        detail, binding = _step_detail(step, tool_names)
        steps.append(
            ExplanationStep(
                order=index,
                step_id=step.id,
                name=step.name,
                type=step.type,
                detail=detail,
                binding=binding,
            )
        )

    bound = [s for s in definition.steps if isinstance(s, ToolStep) and s.is_bound]
    unbound = [s for s in definition.steps if isinstance(s, ToolStep) and not s.is_bound]
    writes = [s for s in bound if s.mode == "write"]
    needs_review = [s for s in definition.steps if s.type == "end" and s.outcome == "needs_review"]

    trigger_copy = {
        "manual": "Someone starts this run by hand — nothing happens on its own.",
        "schedule": "It runs on a schedule, without anyone starting it.",
        "webhook": "An incoming webhook from a connected system starts it.",
        "email": "An incoming email starts it.",
        "upload": "Uploading a file starts it.",
        "form": "A submitted form starts it.",
    }

    if needs_review:
        approval = (
            f"This workflow finishes at “{needs_review[0].name}”, which flags the run for a "
            "person to review before anything is acted on."
        )
    elif writes:
        approval = (
            "There is no approval step, and "
            f"{len(writes)} step{'' if len(writes) == 1 else 's'} write to a connected system. "
            "Add a review step before publishing."
        )
    else:
        approval = (
            "No approval step is defined. Nothing here changes data in a connected system, "
            "so the run completes on its own."
        )

    safeguards = [
        f"{len(bound)} step{'' if len(bound) == 1 else 's'} call a connected system; "
        f"{'all reads only' if not writes else f'{len(writes)} can write'}."
        if bound
        else "No step reaches a connected system, so nothing outside WorkPilot is touched.",
        "Writes are refused unless an administrator enables them."
        if not get_settings().allow_tool_writes
        else "Writes to connected systems are enabled for this deployment.",
        "Every step records its input, output and cost in the run history.",
    ]
    if unbound:
        safeguards.append(
            f"{len(unbound)} business step{'' if len(unbound) == 1 else 's'} "
            "have no tool selected yet and will only report that they were reached."
        )

    return WorkflowExplanation(
        summary=explanation_summary(definition),
        trigger=f"{definition.trigger.label}. "
        + trigger_copy.get(definition.trigger.type, "It starts when its trigger fires."),
        steps=steps,
        approval=approval,
        on_failure=(
            "A failing step is retried once. If it fails again the run stops at that step, "
            "keeps everything already recorded, and the error is stored on the run so the "
            "owner can see exactly where it stopped. Later steps do not run."
        ),
        safeguards=safeguards,
        cost=cost,
    )
