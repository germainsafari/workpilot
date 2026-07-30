"""BedrockAgentCoreRuntime: runs a step inside an AWS AgentCore microVM.

Design notes worth reading before changing this file:

* **The microVM has no credentials, and must not.** The tenant's connector
  tokens are encrypted at rest and decrypted only in the API process, so the
  agent cannot call the tenant's tools itself. Instead it *asks*: each turn it
  either answers, or returns ``{"action": "call_tool", ...}``. WorkPilot performs
  the call through the same :class:`~app.tool_invoker.McpToolInvoker` that a
  ``tool`` step uses — which re-checks the read-only policy — and hands the
  result back on the next turn. The loop is capped so a confused agent cannot
  spin.

* **Conversation state lives here, not there.** Every invoke is an independent
  HTTP request to the runtime, so we carry the Bedrock Converse message list in
  the payload and the agent returns the updated list. That keeps the microVM
  stateless and makes a retry harmless.

* **Failures are visible.** This used to return
  ``{"result": "AgentCore invocation failed: …"}`` while the step stayed
  ``completed``, so a broken run looked like a good one. Only a genuinely
  unconfigured runtime (no ARN, or no AWS credentials at all) falls back to the
  deterministic model now, and when that happens the output says so and usage is
  marked ``degraded``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

from app.executor import DeterministicMockModel
from app.runtimes.base import AgentRuntime
from app.runtimes.bedrock_langgraph import (
    _DEFAULT_PROMPT,
    _TASK_SYSTEM_PROMPTS,
    LiveToolProvider,
    _parse_model_output,
    _prompt_payload,
    evidence_insights,
)
from app.schemas import AITaskStep

logger = logging.getLogger(__name__)

_INPUT_COST_PER_TOKEN: float = 3.5e-8   # $0.035 / 1M input tokens (Nova Micro)
_OUTPUT_COST_PER_TOKEN: float = 1.4e-7  # $0.14  / 1M output tokens

# A ReAct loop that has not answered in five turns is not going to.
_MAX_TURNS = 5
# Bedrock tool names allow [a-zA-Z0-9_-], up to 64 characters.
_NAME_SAFE = re.compile(r"[^a-zA-Z0-9_-]")
# Keep a chatty tool result from dominating the next prompt (and the bill).
_MAX_TOOL_RESULT_CHARS = 6_000
_MAX_TOOLS = 40


class AgentCoreError(RuntimeError):
    """The AgentCore runtime was reached but could not complete the step."""


class AgentCoreNotConfigured(AgentCoreError):
    """No AgentCore runtime ARN is configured — there is nothing to invoke."""


def _safe_tool_name(connector_id: str, tool_name: str) -> str:
    return _NAME_SAFE.sub("_", f"{connector_id or 'tool'}__{tool_name}")[:64]


class BedrockAgentCoreRuntime(AgentRuntime):
    """AgentCore-backed runtime with tool calls proxied back through WorkPilot."""

    def __init__(
        self,
        runtime_arn: str,
        region: str = "eu-central-1",
        tool_provider: LiveToolProvider | None = None,
        max_turns: int = _MAX_TURNS,
        credentials_profile_name: str = "",
    ) -> None:
        self._runtime_arn = runtime_arn
        self._region = region
        self._tool_provider = tool_provider
        self._max_turns = max(1, max_turns)
        self._credentials_profile_name = credentials_profile_name
        self._client: Any = None
        self._fallback = DeterministicMockModel()

    @property
    def name(self) -> str:
        return "agentcore"

    # -- boto3 plumbing ----------------------------------------------------

    def _get_client(self) -> Any:
        if self._client is None:
            import boto3

            if self._credentials_profile_name:
                self._client = boto3.Session(
                    profile_name=self._credentials_profile_name
                ).client("bedrock-agentcore", region_name=self._region)
            else:
                self._client = boto3.client("bedrock-agentcore", region_name=self._region)
        return self._client

    def _invoke(self, payload: bytes) -> dict[str, Any]:
        """Synchronous invoke — run in a thread so the event loop keeps turning."""
        client = self._get_client()
        resp = client.invoke_agent_runtime(
            agentRuntimeArn=self._runtime_arn,
            payload=payload,
        )
        body_val = resp.get("response") or resp.get("body", b"")
        raw: Any = body_val.read() if hasattr(body_val, "read") else body_val
        try:
            parsed = json.loads(raw)
        except (json.JSONDecodeError, TypeError, ValueError) as exc:
            raise AgentCoreError(
                f"AgentCore returned a non-JSON body: {raw[:400]!r}"
            ) from exc
        if not isinstance(parsed, dict):
            raise AgentCoreError(
                f"AgentCore returned {type(parsed).__name__}, expected an object"
            )
        return parsed

    async def _post(self, payload: dict[str, Any]) -> dict[str, Any]:
        loop = asyncio.get_running_loop()
        body = json.dumps(payload, default=str).encode()
        return await loop.run_in_executor(None, self._invoke, body)

    # -- tool descriptors --------------------------------------------------

    def _tool_specs(self) -> tuple[list[dict[str, Any]], dict[str, dict[str, str]]]:
        """Return ``(descriptors_for_the_agent, agent_name -> real identifiers)``."""
        if self._tool_provider is None:
            return [], {}

        descriptors: list[dict[str, Any]] = []
        routing: dict[str, dict[str, str]] = {}
        for spec in self._tool_provider.describe_tools()[:_MAX_TOOLS]:
            tool_name = spec.get("tool_name")
            connection_id = spec.get("connection_id")
            if not tool_name or not connection_id:
                continue
            agent_name = _safe_tool_name(
                str(spec.get("connector_id") or "tool"), str(tool_name)
            )
            if agent_name in routing:
                continue
            routing[agent_name] = {
                "connection_id": str(connection_id),
                "tool_name": str(tool_name),
            }
            description = (
                f"{spec.get('description') or tool_name} "
                f"(read-only tool on {spec.get('connection_name', 'a connected system')})"
            )
            descriptors.append(
                {
                    "name": agent_name,
                    "description": description[:1024],
                    "input_schema": spec.get("input_schema")
                    or {"type": "object", "properties": {}},
                }
            )
        return descriptors, routing

    # -- entry point -------------------------------------------------------

    async def execute(
        self, step: AITaskStep, input_data: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        try:
            return await self._run_agent(step, input_data)
        except Exception as exc:
            if not self._is_unconfigured(exc):
                # A real failure — surface it. Silently returning plausible text
                # here is what made broken runs look successful.
                logger.error(
                    "AgentCore run failed for step %s (%s: %s)",
                    step.id, type(exc).__name__, exc,
                )
                raise
            logger.warning(
                "AgentCore is not configured (%s) — using the deterministic model. "
                "Output is NOT from a real model.",
                type(exc).__name__,
            )
            output, usage = await self._fallback.execute(step, input_data)
            output["_warning"] = (
                "Generated without a model: the AgentCore runtime is not configured."
            )
            usage["degraded"] = True
            return output, usage

    @staticmethod
    def _is_unconfigured(exc: Exception) -> bool:
        """True only for a missing runtime ARN or absent AWS credentials."""
        if isinstance(exc, AgentCoreNotConfigured):
            return True
        name = type(exc).__name__
        if name in ("NoCredentialsError", "PartialCredentialsError", "NoRegionError"):
            return True
        text = str(exc).lower()
        return "unable to locate credentials" in text or "no credentials" in text

    # -- the loop ----------------------------------------------------------

    def _system_prompt(self, step: AITaskStep, has_tools: bool) -> str:
        prompt = _TASK_SYSTEM_PROMPTS.get(step.task, _DEFAULT_PROMPT)
        if has_tools:
            prompt += (
                "\n\nYou may call the provided tools to look up additional data you "
                "need. They are read-only. Do not claim a fact you did not read "
                "from the input or from a tool result."
            )
        if step.output_schema:
            prompt += (
                "\n\nThe result must conform to this JSON schema:\n"
                + json.dumps(step.output_schema)
            )
        return prompt

    async def _run_agent(
        self, step: AITaskStep, input_data: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        if not self._runtime_arn:
            raise AgentCoreNotConfigured(
                "WORKPILOT_AGENTCORE_RUNTIME_ARN is not set, so there is no "
                "AgentCore runtime to invoke."
            )

        descriptors, routing = self._tool_specs()
        system_prompt = self._system_prompt(step, bool(descriptors))
        user_message = (
            f"Task type: {step.task}\nSpecific business objective: {step.name}\n\n"
            f"Context:\n{_prompt_payload(input_data)}"
        )

        messages: list[dict[str, Any]] | None = None
        tool_result: dict[str, Any] | None = None
        input_tokens = 0
        output_tokens = 0
        turns = 0
        tools_called: list[str] = []
        model_id = ""
        output_data: dict[str, Any] = {}
        turn_limit_reached = False

        for turn in range(self._max_turns):
            # On the final permitted turn we withdraw the tools, so the agent has
            # to commit to an answer instead of asking for one more lookup.
            last_turn = turn == self._max_turns - 1
            payload: dict[str, Any] = {
                "protocol": 2,
                "task": step.task,
                "step_id": step.id,
                "system": system_prompt,
                "user_message": user_message,
                "tools": [] if last_turn else descriptors,
                "messages": messages,
                "tool_result": tool_result,
                # Understood by the pre-tool agent build too, so a stale zip
                # still answers rather than erroring.
                "prompt": user_message,
                "input": input_data,
            }
            reply = await self._post(payload)
            turns += 1

            if reply.get("error"):
                raise AgentCoreError(
                    f"AgentCore agent error on turn {turns}: {reply['error']}"
                )

            usage = reply.get("usage") or {}
            input_tokens += int(usage.get("input_tokens") or 0)
            output_tokens += int(usage.get("output_tokens") or 0)
            model_id = str(reply.get("model") or model_id)
            if isinstance(reply.get("messages"), list):
                messages = reply["messages"]

            if reply.get("action") == "call_tool":
                name = str(reply.get("tool") or "")
                arguments = reply.get("arguments")
                if not isinstance(arguments, dict):
                    arguments = {}
                result = await self._proxy_tool_call(name, arguments, routing)
                if name in routing:
                    tools_called.append(name)
                tool_result = {
                    "tool_use_id": reply.get("tool_use_id"),
                    "name": name,
                    "content": self._render_tool_result(result),
                }
                continue

            output_data = _parse_model_output(reply.get("output"))
            break
        else:
            turn_limit_reached = True
            output_data = {
                "result": (
                    "The AgentCore agent kept requesting tools and did not produce "
                    f"an answer within {self._max_turns} turns."
                )
            }

        if not output_data:
            output_data = {"result": "The AgentCore agent returned no content."}
        if step.task == "summarize":
            evidence = evidence_insights(input_data)
            if evidence:
                if output_data.get("summary"):
                    output_data["model_summary"] = output_data["summary"]
                output_data.update(evidence)

        model_usage: dict[str, Any] = {
            "provider": "agentcore",
            "model_id": model_id or "eu.amazon.nova-micro-v1:0",
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost_usd": (
                input_tokens * _INPUT_COST_PER_TOKEN
                + output_tokens * _OUTPUT_COST_PER_TOKEN
            ),
            "runtime_arn": self._runtime_arn,
            "turns": turns,
        }
        if tools_called:
            model_usage["tools_called"] = tools_called
        if turn_limit_reached:
            model_usage["turn_limit_reached"] = True
        return output_data, model_usage

    async def _proxy_tool_call(
        self,
        name: str,
        arguments: dict[str, Any],
        routing: dict[str, dict[str, str]],
    ) -> Any:
        """Run one agent-requested tool call here, where the credentials live.

        Errors come back to the model as data — it can pick another tool or
        answer without one — but they never masquerade as a result.
        """
        target = routing.get(name)
        if target is None or self._tool_provider is None:
            return {"error": f"unknown tool {name!r}", "available": sorted(routing)}
        try:
            return await self._tool_provider.call_named_tool(
                target["connection_id"], target["tool_name"], arguments
            )
        except Exception as exc:
            logger.warning(
                "AgentCore tool call %s failed (%s: %s)", name, type(exc).__name__, exc
            )
            return {"error": f"{type(exc).__name__}: {exc}"}

    @staticmethod
    def _render_tool_result(result: Any) -> str:
        text = json.dumps(result, default=str)
        if len(text) > _MAX_TOOL_RESULT_CHARS:
            text = text[:_MAX_TOOL_RESULT_CHARS] + "… [truncated]"
        return text
