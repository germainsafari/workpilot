from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="WORKPILOT_", extra="ignore")

    app_name: str = "WorkPilot API"
    environment: str = "local"
    database_url: str = "sqlite+aiosqlite:///./workpilot.db"
    redis_url: str = "redis://localhost:6379/0"
    auto_create_schema: bool = True
    seed_demo_data: bool = True
    execute_runs_inline: bool = True
    local_auth_enabled: bool = True
    jwt_secret: str = "local-development-only-change-me"
    cors_origins: str = "http://localhost:3000"


@lru_cache
def get_settings() -> Settings:
    return Settings()
