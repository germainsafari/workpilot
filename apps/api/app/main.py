from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.runs import router as runs_router
from app.api.workflows import router as workflows_router
from app.config import get_settings
from app.db import create_schema
from app.telemetry import configure_telemetry, instrument_fastapi

# Initialise OTel before the FastAPI app is created.  When
# WORKPILOT_OTEL_ENABLED=false (the default) this is a complete no-op.
configure_telemetry()

settings = get_settings()
logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Attach FastAPI instrumentation now that the app object is fully built.
    instrument_fastapi(app)
    if settings.auto_create_schema:
        await create_schema()
    if settings.seed_demo_data:
        from app.seed import seed

        await seed()
    from app.bootstrap_workflows import bootstrap_workflows

    await bootstrap_workflows()
    yield


app = FastAPI(
    title="WorkPilot Control Plane",
    summary="Governed workflow design and deterministic execution for business teams.",
    version="0.1.0",
    lifespan=lifespan,
    openapi_url="/openapi.json",
    docs_url="/docs",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",")],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-WorkPilot-Tenant-ID", "X-WorkPilot-User-ID"],
)
app.include_router(workflows_router, prefix="/v1")
app.include_router(runs_router, prefix="/v1")


@app.get("/health", tags=["System"])
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "workpilot-api", "environment": settings.environment}


@app.middleware("http")
async def request_logging(request: Request, call_next):  # type: ignore[no-untyped-def]
    request_id = request.headers.get("x-request-id", "local")
    try:
        response = await call_next(request)
        logger.info(
            "request.completed",
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            request_id=request_id,
        )
        response.headers["x-request-id"] = request_id
        return response
    except Exception as error:
        logger.exception(
            "request.failed",
            method=request.method,
            path=request.url.path,
            request_id=request_id,
            error_type=type(error).__name__,
        )
        return JSONResponse(
            status_code=500, content={"detail": "Unexpected server error", "request_id": request_id}
        )
