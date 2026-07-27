from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="WORKPILOT_", extra="ignore")

    app_name: str = "WorkPilot API"
    app_version: str = "0.1.0"
    environment: str = "local"
    database_url: str = "sqlite+aiosqlite:///./workpilot.db"
    redis_url: str = "redis://localhost:6379/0"
    auto_create_schema: bool = True
    seed_demo_data: bool = True
    execute_runs_inline: bool = True
    local_auth_enabled: bool = True
    jwt_secret: str = ""
    cors_origins: str = "http://localhost:3000,http://localhost:3001"
    cognito_user_pool_id: str = ""       # e.g. "eu-central-1_XXXXXXXXX"
    cognito_region: str = "eu-central-1"
    cognito_app_client_id: str = ""      # for aud validation
    # OpenTelemetry / ADOT
    otel_enabled: bool = False
    otel_exporter_endpoint: str = "http://localhost:4317"

    # Agent runtime -------------------------------------------------------
    # "deterministic"     – DeterministicMockModel (default, no credentials needed)
    # "bedrock_langgraph" – LangGraph ReAct on Amazon Bedrock
    # "agentcore"         – AWS AgentCore managed runtime
    agent_runtime: str = "deterministic"
    # Amazon Nova Micro — cheapest Bedrock model with tool-calling support, no use-case form needed.
    # To switch to Claude: eu.anthropic.claude-haiku-4-5-20251001-v1:0 (requires Anthropic EU form)
    # To switch to Llama: meta.llama3-8b-instruct-v1:0
    bedrock_model_id: str = "amazon.nova-micro-v1:0"
    bedrock_region: str = "eu-central-1"
    # AgentCore runtime ARN — only used when agent_runtime="agentcore"
    agentcore_runtime_arn: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
