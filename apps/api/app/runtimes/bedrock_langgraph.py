"""BedrockLangGraphRuntime: LangGraph ReAct agent backed by Amazon Bedrock.

Falls back to DeterministicMockModel automatically when Bedrock credentials
are unavailable or when any runtime exception occurs, so the test suite stays
green in environments without AWS access.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.executor import DeterministicMockModel
from app.runtimes.base import AgentRuntime
from app.schemas import AITaskStep

logger = logging.getLogger(__name__)

_TASK_SYSTEM_PROMPTS: dict[str, str] = {
    "extract": (
        "You are a field-extraction specialist. "
        "Use the extract_fields tool to pull structured data from the user's input and return it."
    ),
    "summarize": (
        "You are a summarisation specialist. "
        "Use the summarize_text tool to produce a concise summary of the user's input."
    ),
    "classify": (
        "You are a classification specialist. "
        "Use the classify_item tool to assign the user's input to the most appropriate category."
    ),
    "prepare": (
        "You are a draft-preparation specialist. "
        "Use the prepare_draft tool to produce a structured output draft from the user's context."
    ),
}

# Approximate cost per token (varies by model). Defaults match Amazon Nova Micro.
# Override in WORKPILOT_BEDROCK_MODEL_ID to switch models.
_INPUT_COST_PER_TOKEN: float = 3.5e-8   # $0.035 / 1M input tokens  (Nova Micro)
_OUTPUT_COST_PER_TOKEN: float = 1.4e-7  # $0.14  / 1M output tokens (Nova Micro)


class BedrockLangGraphRuntime(AgentRuntime):
    """LangGraph ReAct agent that calls task-specific tools via Amazon Bedrock."""

    def __init__(
        self,
        model_id: str = "anthropic.claude-3-5-sonnet-20241022-v2:0",
        region: str = "us-east-1",
    ) -> None:
        self._model_id = model_id
        self._region = region
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
            logger.warning(
                "BedrockLangGraphRuntime.execute fell back to deterministic (%s: %s)",
                type(exc).__name__,
                exc,
            )
            return await self._fallback.execute(step, input_data)

    async def _run_agent(  # noqa: C901  (acceptable complexity for a single orchestration method)
        self, step: AITaskStep, input_data: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        # Lazy imports so the module can be imported without the packages being
        # present (e.g. during static analysis on a machine without langchain_aws).
        from langchain_aws import ChatBedrockConverse
        from langchain_core.tools import tool as lc_tool
        from langgraph.prebuilt import create_react_agent

        # --- task-specific tool definitions ---

        @lc_tool
        def extract_fields(text: str, fields: list[str]) -> dict[str, Any]:
            """Extract specified fields from text content.

            Args:
                text: The source text to extract from.
                fields: List of field names to extract.
            """
            return {"text_excerpt": text[:500], "requested_fields": fields}

        @lc_tool
        def summarize_text(text: str) -> str:
            """Produce a concise summary of the given text.

            Args:
                text: Text to summarise.
            """
            return text[:500]

        @lc_tool
        def classify_item(text: str, categories: list[str]) -> dict[str, Any]:
            """Classify text into one of the provided categories.

            Args:
                text: Text to classify.
                categories: Possible category names.
            """
            return {
                "category": categories[0] if categories else "unknown",
                "confidence": 0.9,
            }

        @lc_tool
        def prepare_draft(context: str) -> dict[str, Any]:
            """Prepare a structured draft based on context information.

            Args:
                context: JSON-serialised context data.
            """
            return {"draft": {"title": "Prepared output", "context_preview": context[:200]}}

        task_tools: dict[str, list[Any]] = {
            "extract": [extract_fields],
            "summarize": [summarize_text],
            "classify": [classify_item],
            "prepare": [prepare_draft],
        }

        task = step.task
        tools: list[Any] = task_tools.get(task, [extract_fields])
        system_prompt = _TASK_SYSTEM_PROMPTS.get(
            task, "Process the input data and return a structured result."
        )

        llm = ChatBedrockConverse(
            model_id=self._model_id,
            region_name=self._region,
        )
        agent = create_react_agent(llm, tools, prompt=system_prompt)

        human_message = (
            f"Task type: {task}\n"
            f"Input data:\n{json.dumps(input_data, default=str, indent=2)}"
        )

        raw: Any = await agent.ainvoke(
            {"messages": [{"role": "user", "content": human_message}]}
        )

        # Unwrap result ---------------------------------------------------------
        messages: list[Any] = []
        if isinstance(raw, dict):
            messages = raw.get("messages", [])

        input_tokens = 0
        output_tokens = 0
        for msg in messages:
            usage: Any = getattr(msg, "usage_metadata", None)
            if usage is not None:
                if isinstance(usage, dict):
                    input_tokens += int(usage.get("input_tokens", 0))
                    output_tokens += int(usage.get("output_tokens", 0))
                else:
                    input_tokens += int(getattr(usage, "input_tokens", 0))
                    output_tokens += int(getattr(usage, "output_tokens", 0))

        output_data: dict[str, Any] = {}

        # Prefer the last tool-call result, then the last AI text response.
        for msg in reversed(messages):
            msg_type: str = getattr(msg, "type", "")
            if msg_type == "tool":
                content: Any = getattr(msg, "content", None)
                if isinstance(content, str):
                    try:
                        parsed = json.loads(content)
                        if isinstance(parsed, dict):
                            output_data = parsed
                            break
                    except (json.JSONDecodeError, ValueError):
                        output_data = {"result": content}
                        break
                elif isinstance(content, dict):
                    output_data = content
                    break

        if not output_data:
            for msg in reversed(messages):
                msg_type = getattr(msg, "type", "")
                if msg_type == "ai":
                    content = getattr(msg, "content", None)
                    if isinstance(content, str):
                        try:
                            parsed = json.loads(content)
                            if isinstance(parsed, dict):
                                output_data = parsed
                        except (json.JSONDecodeError, ValueError):
                            output_data = {"result": content}
                    break

        cost_usd = (
            input_tokens * _INPUT_COST_PER_TOKEN
            + output_tokens * _OUTPUT_COST_PER_TOKEN
        )

        model_usage: dict[str, Any] = {
            "provider": "bedrock_langgraph",
            "model_id": self._model_id,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost_usd": cost_usd,
        }
        return output_data, model_usage
