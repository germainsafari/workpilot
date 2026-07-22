import asyncio
import json

import structlog
from redis.asyncio import Redis

from app.auth import Principal
from app.config import get_settings
from app.db import SessionFactory
from app.run_service import execute_persisted_run

logger = structlog.get_logger()


async def run_worker() -> None:
    settings = get_settings()
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    logger.info("worker.started", queue="workpilot:runs")
    try:
        while True:
            item = await redis.blpop("workpilot:runs", timeout=5)
            if item is None:
                continue
            _, raw = item
            payload = json.loads(raw)
            principal = Principal(
                tenant_id=payload["tenant_id"],
                user_id=payload["user_id"],
                role=payload.get("role", "operator"),
            )
            async with SessionFactory() as session:
                try:
                    await execute_persisted_run(session, principal, payload["run_id"])
                except Exception as error:
                    logger.exception(
                        "worker.run_failed", run_id=payload["run_id"], error_type=type(error).__name__
                    )
                else:
                    logger.info("worker.run_completed", run_id=payload["run_id"])
    finally:
        await redis.aclose()


if __name__ == "__main__":
    asyncio.run(run_worker())
