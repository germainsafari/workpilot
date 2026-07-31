"""BedrockLangGraphRuntime: LangGraph ReAct agent backed by Amazon Bedrock.

Design notes worth reading before changing this file:

* **The model does the work.** There used to be four "tools" here
  (``summarize_text``, ``extract_fields``, …) that just echoed their input —
  ``summarize_text`` was literally ``return text[:500]``. Combined with output
  extraction that preferred the last tool message, the agent's real answer was
  discarded in favour of the echo. Summarising, extracting and classifying are
  things the LLM does natively; they need no tool.

* **Tools are for reaching outside.** The only tools injected now are the
  tenant's real MCP tools, supplied by a ``tool_provider``. That is what lets an
  ``ai_task`` decide on its own to go and fetch more data.

* **Failures are visible.** A blanket ``except Exception`` used to swap in the
  deterministic mock and log at warning level, so a broken Bedrock call looked
  like a successful run with plausible content. Only missing credentials fall
  back now, and the output says so.
"""

from __future__ import annotations

import json
import logging
import re
from collections import Counter
from datetime import date
from typing import Any, Protocol

from app.executor import DeterministicMockModel
from app.metrics import emit_model_metrics
from app.runtimes.base import AgentRuntime
from app.schemas import AITaskStep

logger = logging.getLogger(__name__)

_TASK_SYSTEM_PROMPTS: dict[str, str] = {
    "extract": (
        "You extract structured data. Read the input and return ONLY a JSON object "
        "containing the fields the task calls for. Use null for anything genuinely "
        "absent — never invent a value. No prose, no code fences."
    ),
    "summarize": (
        "You are a senior operations analyst. Turn the supplied business records "
        "into decision-ready insight, not a description of the payload. Calculate "
        "status counts where possible. Call out overdue or near-due work, missing "
        "owners or deadlines, stalled/pending records, contradictory fields, and "
        "anything else that warrants review. Name the affected records and cite "
        "their concrete dates/statuses; never invent a fact. "
        "return ONLY a JSON object with:\n"
        '  "summary": a concise executive assessment,\n'
        '  "status_breakdown": an object of status counts when records have statuses,\n'
        '  "key_points": an array of the most important evidence-backed specifics,\n'
        '  "needs_attention": an array of items a human should look at, each with '
        '"item", "reason", and "recommended_action".\n'
        "Ground every statement in the input. If nothing needs attention, use an "
        "empty array. No prose outside the JSON, no code fences."
    ),
    "classify": (
        "You classify records. Return ONLY a JSON object with \"category\", "
        '"confidence" (0-1), and "reasoning" (one sentence). No code fences.'
    ),
    "prepare": (
        "You prepare draft business output. Return ONLY a JSON object describing "
        "the draft. Mark anything you could not determine as null rather than "
        "guessing. No code fences."
    ),
}

_DEFAULT_PROMPT = (
    "Process the input data and return ONLY a JSON object with the result. "
    "No prose, no code fences."
)

# Approximate cost per token (varies by model). Defaults match Amazon Nova Micro.
_INPUT_COST_PER_TOKEN: float = 3.5e-8   # $0.035 / 1M input tokens
_OUTPUT_COST_PER_TOKEN: float = 1.4e-7  # $0.14  / 1M output tokens

# Guard against a huge upstream payload blowing up the prompt (and the bill).
_MAX_INPUT_CHARS = 12_000


def _find_record_list(value: Any) -> list[dict[str, Any]]:
    """Find the largest business-record list in a workflow context."""
    candidates: list[list[dict[str, Any]]] = []

    def visit(item: Any) -> None:
        if isinstance(item, list):
            records = [row for row in item if isinstance(row, dict)]
            if records:
                candidates.append(records)
            for row in item:
                visit(row)
        elif isinstance(item, dict):
            for child in item.values():
                visit(child)

    visit(value)
    return max(candidates, key=len, default=[])


def evidence_insights(input_data: dict[str, Any]) -> dict[str, Any]:
    """Calculate review evidence models commonly overlook.

    Nova still writes the narrative. These deterministic fields make status
    counts and overdue flags dependable across Scoro and other record-oriented
    connectors, even when a small model answers in prose.
    """
    records = _find_record_list(input_data)
    if not records:
        return {}

    status_keys = ("status", "state", "stage")
    name_keys = ("project_name", "name", "subject", "title", "no", "id")
    due_keys = ("deadline", "due_date", "datetime_due", "end_date")
    complete = {"completed", "complete", "done", "cancelled", "canceled", "closed", "paid"}
    counts: Counter[str] = Counter()
    attention: list[dict[str, str]] = []
    today = date.today()

    for record in records:
        status = next(
            (record.get(key) for key in status_keys if record.get(key) not in (None, "")),
            "unknown",
        )
        status_text = str(status).strip().lower() or "unknown"
        counts[status_text] += 1
        name = next(
            (record.get(key) for key in name_keys if record.get(key) not in (None, "")),
            "Unnamed record",
        )
        due_raw = next((record.get(key) for key in due_keys if record.get(key) not in (None, "")), None)
        due: date | None = None
        if due_raw:
            try:
                due = date.fromisoformat(str(due_raw)[:10])
            except ValueError:
                pass

        if status_text not in complete and due and due < today:
            attention.append(
                {
                    "item": str(name),
                    "reason": f"Status is {status_text} but the deadline {due.isoformat()} has passed.",
                    "recommended_action": "Confirm the current status, owner, and revised delivery date.",
                }
            )
        elif status_text not in complete and not due:
            attention.append(
                {
                    "item": str(name),
                    "reason": f"Status is {status_text} and no usable deadline is recorded.",
                    "recommended_action": "Add a deadline or confirm that the work should remain open-ended.",
                }
            )

    ordered_counts = dict(sorted(counts.items(), key=lambda item: (-item[1], item[0])))
    overdue_total = sum("has passed" in item["reason"] for item in attention)
    missing_due_total = len(attention) - overdue_total
    key_points = [
        f"Analyzed {len(records)} records.",
        "Status mix: " + ", ".join(f"{status}: {count}" for status, count in ordered_counts.items()),
    ]
    if overdue_total:
        key_points.append(f"{overdue_total} open records have deadlines before {today.isoformat()}.")
    if missing_due_total:
        key_points.append(f"{missing_due_total} open records have no usable deadline.")
    status_sentence = ", ".join(
        f"{count} {status}" for status, count in ordered_counts.items()
    )
    review_sentence = (
        (
            "1 item needs review."
            if len(attention) == 1
            else f"{len(attention)} items need review."
        )
        if attention
        else "No records need immediate review based on status and deadline evidence."
    )
    return {
        "summary": f"Analyzed {len(records)} records: {status_sentence}. {review_sentence}",
        "analyzed_records": len(records),
        "as_of": today.isoformat(),
        "status_breakdown": ordered_counts,
        "key_points": key_points,
        "needs_attention": attention[:25],
        "attention_total": len(attention),
    }


class LiveToolProvider(Protocol):
    """Supplies the tenant's real, callable tools to the agent."""

    def describe_tools(self) -> list[dict[str, Any]]:
        """Return ``[{connection_id, tool_name, description, input_schema}, ...]``."""
        ...

    async def call_named_tool(
        self, connection_id: str, tool_name: str, arguments: dict[str, Any]
    ) -> Any:
        """Invoke one tool and return its result."""
        ...


def _prompt_payload(input_data: dict[str, Any]) -> str:
    """Render the run context for the prompt without duplicating it.

    The executor keeps both a flat merge and a per-step namespace in the context.
    Sending both doubles the token count for no benefit, so prefer ``_steps`` and
    include only the trigger inputs alongside it.
    """
    steps = input_data.get("_steps")
    if isinstance(steps, dict) and steps:
        trigger = {
            key: value
            for key, value in input_data.items()
            if key != "_steps" and not any(key in (out or {}) for out in steps.values())
        }
        payload: dict[str, Any] = {"steps": steps}
        if trigger:
            payload["trigger_input"] = trigger
    else:
        payload = {key: value for key, value in input_data.items() if key != "_steps"}

    text = json.dumps(payload, default=str, indent=2)
    if len(text) > _MAX_INPUT_CHARS:
        text = text[:_MAX_INPUT_CHARS] + "\n… [truncated]"
    return text


def _parse_model_output(content: Any) -> dict[str, Any]:
    """Turn the model's final message into a dict.

    Tolerates a `````json`` fence even though the prompt forbids one, and falls
    back to wrapping plain prose rather than losing it.
    """
    if isinstance(content, list):
        # Bedrock Converse returns content blocks; concatenate the text ones.
        parts = [
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and block.get("type") in (None, "text")
        ]
        content = "".join(parts) or json.dumps(content, default=str)

    if isinstance(content, dict):
        return content
    if not isinstance(content, str):
        return {"result": content}

    text = content.strip()

    # Nova emits <thinking>…</thinking> and wraps its answer in <response>…
    # </response>. Left in place, the chain-of-thought ends up displayed to the
    # user as if it were the result.
    response_match = re.search(r"<response>(.*?)</response>", text, re.S | re.I)
    if response_match:
        text = response_match.group(1).strip()
    else:
        text = re.sub(r"<thinking>.*?</thinking>", "", text, flags=re.S | re.I).strip()

    if text.startswith("```"):
        body = text.split("```", 2)
        if len(body) >= 2:
            text = body[1]
            if text.lstrip().lower().startswith("json"):
                text = text.lstrip()[4:]
            text = text.strip()

    if text[:1] in ("{", "["):
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return parsed
            return {"result": parsed}
        except json.JSONDecodeError:
            pass
    return {"summary": text} if text else {}


class BedrockLangGraphRuntime(AgentRuntime):
    """LangGraph ReAct agent on Amazon Bedrock, optionally holding real tools."""

    def __init__(
        self,
        model_id: str = "amazon.nova-micro-v1:0",
        region: str = "eu-central-1",
        tool_provider: LiveToolProvider | None = None,
        credentials_profile_name: str = "",
    ) -> None:
        self._model_id = model_id
        self._region = region
        self._tool_provider = tool_provider
        self._credentials_profile_name = credentials_profile_name
        self._fallback = DeterministicMockModel()

    @property
    def name(self) -> str:
        return "bedrock_langgraph"

    async def execute(
        self, step: AITaskStep, input_data: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        try:
            return await self._run_agent(step, input_data)
        except Exception as exc:
            if not self._is_missing_credentials(exc):
                # A real failure — surface it. Silently substituting mock output
                # here is what made broken runs look successful.
                logger.error(
                    "Bedrock agent failed for step %s (%s: %s)",
                    step.id, type(exc).__name__, exc,
                )
                raise
            logger.warning(
                "No usable Bedrock credentials (%s) — using the deterministic model. "
                "Output is NOT from a real model.",
                type(exc).__name__,
            )
            output, usage = await self._fallback.execute(step, input_data)
            output["_warning"] = (
                "Generated without a model: Bedrock credentials are not configured."
            )
            usage["degraded"] = True
            emit_model_metrics(
                provider="deterministic_mock",
                model_id=self._model_id,
                input_tokens=0,
                output_tokens=0,
                cost_usd=0.0,
                duration_ms=0.0,
                degraded=True,
            )
            return output, usage

    @staticmethod
    def _is_missing_credentials(exc: Exception) -> bool:
        name = type(exc).__name__
        if name in ("NoCredentialsError", "PartialCredentialsError", "NoRegionError"):
            return True
        text = str(exc).lower()
        return "unable to locate credentials" in text or "no credentials" in text

    def _build_live_tools(self) -> list[Any]:
        """Wrap the tenant's MCP tools as LangChain tools the agent may call."""
        if self._tool_provider is None:
            return []

        from langchain_core.tools import StructuredTool

        provider = self._tool_provider
        tools: list[Any] = []
        for spec in provider.describe_tools():
            connection_id = spec["connection_id"]
            tool_name = spec["tool_name"]

            # Bind the identifiers as defaults so each closure keeps its own.
            async def _call(
                _cid: str = connection_id,
                _name: str = tool_name,
                _provider: LiveToolProvider = provider,
                **kwargs: Any,
            ) -> str:
                try:
                    result = await _provider.call_named_tool(_cid, _name, kwargs)
                except Exception as exc:  # surfaced to the model, not swallowed
                    return json.dumps({"error": f"{type(exc).__name__}: {exc}"})
                return json.dumps(result, default=str)[:8000]

            schema = spec.get("input_schema") or {"type": "object", "properties": {}}
            description = (
                f"{spec.get('description') or tool_name} "
                f"(read-only tool on {spec.get('connection_name', 'a connected system')})"
            )
            tools.append(
                StructuredTool(
                    name=f"{spec.get('connector_id', 'tool')}__{tool_name}"[:64],
                    description=description[:1024],
                    args_schema=schema,
                    coroutine=_call,
                    func=None,
                )
            )
        return tools

    async def _run_agent(
        self, step: AITaskStep, input_data: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        # Lazy imports so the module imports fine without langchain installed.
        import time

        from langchain_aws import ChatBedrockConverse
        from langgraph.prebuilt import create_react_agent

        started = time.monotonic()

        task = step.task
        system_prompt = _TASK_SYSTEM_PROMPTS.get(task, _DEFAULT_PROMPT)
        tools = self._build_live_tools()
        if tools:
            system_prompt += (
                "\n\nYou may call the provided tools to look up additional data you "
                "need. They are read-only. Do not claim a fact you did not read "
                "from the input or from a tool result."
            )
        if step.output_schema:
            system_prompt += (
                "\n\nThe result must conform to this JSON schema:\n"
                + json.dumps(step.output_schema)
            )

        llm_kwargs: dict[str, Any] = {
            "model_id": self._model_id,
            "region_name": self._region,
        }
        if self._credentials_profile_name:
            llm_kwargs["credentials_profile_name"] = self._credentials_profile_name
        llm = ChatBedrockConverse(**llm_kwargs)
        agent = create_react_agent(llm, tools, prompt=system_prompt)

        human_message = (
            f"Task type: {task}\nSpecific business objective: {step.name}\n\n"
            f"Context:\n{_prompt_payload(input_data)}"
        )
        raw: Any = await agent.ainvoke(
            {"messages": [{"role": "user", "content": human_message}]}
        )

        messages: list[Any] = raw.get("messages", []) if isinstance(raw, dict) else []

        input_tokens = 0
        output_tokens = 0
        tool_calls: list[str] = []
        for msg in messages:
            usage: Any = getattr(msg, "usage_metadata", None)
            if usage is not None:
                if isinstance(usage, dict):
                    input_tokens += int(usage.get("input_tokens", 0))
                    output_tokens += int(usage.get("output_tokens", 0))
                else:
                    input_tokens += int(getattr(usage, "input_tokens", 0))
                    output_tokens += int(getattr(usage, "output_tokens", 0))
            if getattr(msg, "type", "") == "tool":
                tool_calls.append(str(getattr(msg, "name", "") or "unknown"))

        # Take the model's own final answer. Tool results are inputs to that
        # answer, not the answer — preferring them was the old bug.
        output_data: dict[str, Any] = {}
        for msg in reversed(messages):
            if getattr(msg, "type", "") == "ai":
                content = getattr(msg, "content", None)
                if content:
                    output_data = _parse_model_output(content)
                    break

        if not output_data:
            output_data = {"result": "The model returned no content."}
        if step.task == "summarize":
            evidence = evidence_insights(input_data)
            if evidence:
                if output_data.get("summary"):
                    output_data["model_summary"] = output_data["summary"]
                output_data.update(evidence)

        cost_usd = (
            input_tokens * _INPUT_COST_PER_TOKEN + output_tokens * _OUTPUT_COST_PER_TOKEN
        )
        model_usage: dict[str, Any] = {
            "provider": "bedrock_langgraph",
            "model_id": self._model_id,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost_usd": cost_usd,
        }
        if tool_calls:
            model_usage["tools_called"] = tool_calls

        emit_model_metrics(
            provider="bedrock_langgraph",
            model_id=self._model_id,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=cost_usd,
            duration_ms=(time.monotonic() - started) * 1000,
        )
        return output_data, model_usage
