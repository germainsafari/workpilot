from app.config import get_settings
from app.runtimes.base import AgentRuntime


def get_runtime() -> AgentRuntime:
    """Return the configured AgentRuntime for the current environment."""
    settings = get_settings()
    if settings.agent_runtime == "bedrock_langgraph":
        from app.runtimes.bedrock_langgraph import BedrockLangGraphRuntime

        return BedrockLangGraphRuntime(
            model_id=settings.bedrock_model_id,
            region=settings.bedrock_region,
        )
    from app.runtimes.deterministic import DeterministicRuntime

    return DeterministicRuntime()
