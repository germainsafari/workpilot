"""Custom CloudWatch metrics via the Embedded Metric Format (EMF).

EMF needs no AWS SDK call and no extra infrastructure: a specially-shaped JSON
object written to stdout is picked up by the CloudWatch Logs agent already
attached to every ECS container (see the `awslogs` log driver in
``infra/ecs.tf``), and CloudWatch extracts the named metrics automatically.

This is what turns "a run happened" into "a run happened, it took 840ms, cost
$0.00012, called Scoro's list_projects tool, and used bedrock_langgraph" —
queryable as real CloudWatch metrics (for dashboards/alarms), not just prose
buried in a trace.

Reference: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Literal

logger = logging.getLogger(__name__)

Unit = Literal["Milliseconds", "Count", "None", "Percent", "Bytes"]

NAMESPACE = "WorkPilot"


def emit_metric(
    metric_name: str,
    value: float,
    unit: Unit = "None",
    dimensions: dict[str, str] | None = None,
    extra_properties: dict[str, Any] | None = None,
) -> None:
    """Emit one EMF record. Never raises — a metrics bug must not break a run.

    ``dimensions`` become both CloudWatch dimensions AND queryable log fields
    (e.g. filter API Logs Insights by ``tool_name``), which is why they are
    also duplicated as top-level properties in the EMF spec.
    """
    try:
        dims = dimensions or {}
        record: dict[str, Any] = {
            "_aws": {
                "Timestamp": int(time.time() * 1000),
                "CloudWatchMetrics": [
                    {
                        "Namespace": NAMESPACE,
                        "Dimensions": [list(dims.keys())] if dims else [[]],
                        "Metrics": [{"Name": metric_name, "Unit": unit}],
                    }
                ],
            },
            metric_name: value,
            **dims,
            **(extra_properties or {}),
        }
        print(json.dumps(record, default=str))
    except Exception:  # pragma: no cover - metrics must never break a run
        logger.debug("failed to emit metric %s", metric_name, exc_info=True)


def emit_run_metrics(
    *, workflow_id: str, status: str, duration_ms: float, cost_usd: float, token_usage: int
) -> None:
    """One EMF record per finished run: RunDuration/RunCost/RunTokens/RunCount by workflow+status."""
    dims = {"workflow_id": workflow_id, "status": status}
    emit_metric("RunDuration", duration_ms, "Milliseconds", dims)
    emit_metric("RunCost", cost_usd, "None", dims)
    emit_metric("RunTokens", token_usage, "Count", dims)
    emit_metric("RunCount", 1, "Count", dims)


def emit_tool_call_metrics(
    *, tool_name: str, connector_id: str, invoked: bool, duration_ms: float = 0, error: bool = False
) -> None:
    """One EMF record per tool step: ToolCallDuration/ToolCallCount by tool+connector+outcome."""
    outcome = "error" if error else ("invoked" if invoked else "not_configured")
    dims = {"tool_name": tool_name, "connector_id": connector_id, "outcome": outcome}
    emit_metric("ToolCallCount", 1, "Count", dims)
    if invoked:
        emit_metric("ToolCallDuration", duration_ms, "Milliseconds", dims)


def emit_model_metrics(
    *,
    provider: str,
    model_id: str,
    input_tokens: int,
    output_tokens: int,
    cost_usd: float,
    duration_ms: float,
    degraded: bool = False,
) -> None:
    """One EMF record per model invocation: ModelDuration/ModelTokens/ModelCost by provider+model."""
    dims = {"provider": provider, "model_id": model_id, "degraded": str(degraded)}
    emit_metric("ModelInvocationCount", 1, "Count", dims)
    emit_metric("ModelDuration", duration_ms, "Milliseconds", dims)
    emit_metric("ModelInputTokens", input_tokens, "Count", dims)
    emit_metric("ModelOutputTokens", output_tokens, "Count", dims)
    emit_metric("ModelCost", cost_usd, "None", dims)
