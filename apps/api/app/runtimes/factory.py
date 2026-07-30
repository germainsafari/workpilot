from typing import Any

from app.config import get_settings
from app.runtimes.base import AgentRuntime


def get_runtime(tool_provider: Any | None = None) -> AgentRuntime:
    """Return the configured AgentRuntime for the current environment.

    ``tool_provider`` is passed to any runtime that can use the tenant's real
    (read-only) tools, so an ``ai_task`` can fetch data it needs on its own.
    """
    settings = get_settings()
    if settings.agent_runtime == "bedrock_langgraph":
        from app.runtimes.bedrock_langgraph import BedrockLangGraphRuntime

        return BedrockLangGraphRuntime(
            model_id=settings.bedrock_model_id,
            region=settings.bedrock_region,
            tool_provider=tool_provider,
            credentials_profile_name=settings.aws_profile,
        )
    if settings.agent_runtime == "agentcore":
        from app.runtimes.bedrock_agentcore import BedrockAgentCoreRuntime

        return BedrockAgentCoreRuntime(
            runtime_arn=settings.agentcore_runtime_arn,
            region=settings.bedrock_region,
            tool_provider=tool_provider,
            credentials_profile_name=settings.aws_profile,
        )
    from app.runtimes.deterministic import DeterministicRuntime

    return DeterministicRuntime()
