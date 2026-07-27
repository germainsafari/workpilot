"""BedrockAgentCoreRuntime: delegates step execution to an AWS AgentCore runtime.

The AgentCore runtime runs our agent code in a fully managed AWS microVM.
WorkPilot sends the step task + input_data as a JSON payload and receives
a structured JSON response back.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from app.runtimes.base import AgentRuntime
from app.schemas import AITaskStep

logger = logging.getLogger(__name__)

_INPUT_COST_PER_TOKEN: float = 3.5e-8
_OUTPUT_COST_PER_TOKEN: float = 1.4e-7


class BedrockAgentCoreRuntime(AgentRuntime):
    """AgentCore-backed runtime — executes steps in a managed AWS microVM."""

    def __init__(self, runtime_arn: str, region: str = "eu-central-1") -> None:
        self._runtime_arn = runtime_arn
        self._region = region
        self._client: Any = None

    @property
    def name(self) -> str:
        return "agentcore"

    def _get_client(self) -> Any:
        if self._client is None:
            import boto3
            self._client = boto3.client("bedrock-agentcore", region_name=self._region)
        return self._client

    async def execute(
        self, step: AITaskStep, input_data: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        import asyncio

        prompt = (
            f"Task: {step.task}\n"
            f"Step: {step.id}\n"
            f"Input data:\n{json.dumps(input_data, default=str, indent=2)}"
        )
        payload = json.dumps({"prompt": prompt, "task": step.task, "input": input_data}).encode()

        try:
            loop = asyncio.get_event_loop()
            raw_result = await loop.run_in_executor(None, self._invoke, payload)
        except Exception as exc:
            logger.warning("AgentCore invoke failed (%s: %s), using stub", type(exc).__name__, exc)
            return (
                {"result": f"AgentCore invocation failed: {exc}", "task": step.task},
                {"provider": "agentcore", "model_id": "unknown", "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0},
            )

        output_data: dict[str, Any] = {}
        input_tokens = raw_result.get("usage", {}).get("input_tokens", 0)
        output_tokens = raw_result.get("usage", {}).get("output_tokens", 0)

        if raw_result.get("output"):
            output_data = {"result": raw_result["output"], "task": step.task}
        elif raw_result.get("error"):
            output_data = {"error": raw_result["error"], "task": step.task}
        else:
            output_data = raw_result

        cost_usd = (
            input_tokens * _INPUT_COST_PER_TOKEN + output_tokens * _OUTPUT_COST_PER_TOKEN
        )
        model_usage: dict[str, Any] = {
            "provider": "agentcore",
            "model_id": raw_result.get("model", "eu.amazon.nova-micro-v1:0"),
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost_usd": cost_usd,
            "runtime_arn": self._runtime_arn,
        }
        return output_data, model_usage

    def _invoke(self, payload: bytes) -> dict[str, Any]:
        """Synchronous invoke — runs in a thread executor to avoid blocking the event loop."""
        client = self._get_client()
        resp = client.invoke_agent_runtime(
            agentRuntimeArn=self._runtime_arn,
            payload=payload,
        )
        body_val = resp.get("response") or resp.get("body", b"")
        raw: bytes = body_val.read() if hasattr(body_val, "read") else body_val
        return json.loads(raw)
