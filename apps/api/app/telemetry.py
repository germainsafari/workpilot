"""OpenTelemetry + ADOT setup for WorkPilot.

Exports:
  - Traces   → AWS X-Ray (via OTLP gRPC to ADOT collector, or direct via aws-xray-sdk fallback)
  - Metrics  → CloudWatch Embedded Metrics Format (EMF) via structlog side-channel

When WORKPILOT_OTEL_ENABLED=false (default in local dev), this is a no-op so
the existing test suite keeps passing without any AWS credentials.
"""
from __future__ import annotations

import contextlib
import logging
from collections.abc import Generator
from typing import Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# No-op shims — used when opentelemetry-api is not installed at all
# ---------------------------------------------------------------------------


class _NoOpSpan:
    """Minimal span shim when opentelemetry is not installed."""

    def set_attribute(self, key: str, value: Any) -> None:  # noqa: ARG002
        pass

    def add_event(self, name: str, attributes: dict[str, Any] | None = None) -> None:  # noqa: ARG002
        pass

    def set_status(self, status: Any) -> None:  # noqa: ARG002
        pass

    def record_exception(  # noqa: ARG002
        self, exception: BaseException, attributes: dict[str, Any] | None = None
    ) -> None:
        pass


class _NoOpTracer:
    """Minimal tracer shim when opentelemetry is not installed."""

    @contextlib.contextmanager
    def start_as_current_span(  # noqa: ARG002
        self,
        name: str,
        **kwargs: Any,
    ) -> Generator[_NoOpSpan, None, None]:
        yield _NoOpSpan()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def configure_telemetry() -> None:
    """Configure OpenTelemetry once at startup.

    When ``WORKPILOT_OTEL_ENABLED=false`` (the default) this function is a
    complete no-op — no imports of heavy OTel packages occur, so the test
    suite passes even without AWS credentials or a running ADOT sidecar.
    """
    from app.config import get_settings

    settings = get_settings()

    if not settings.otel_enabled:
        return

    try:
        _setup_otel(settings)
    except ImportError as exc:
        logger.warning(
            "OpenTelemetry packages unavailable — tracing disabled. "
            "Install workpilot-api[otel] to enable. Error: %s",
            exc,
        )


def _setup_otel(settings: Any) -> None:  # noqa: ANN401 — Any used for Settings to avoid circular import typing
    """Internal: perform all OTel SDK initialisation (only called when enabled)."""
    from opentelemetry import trace
    from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
    from opentelemetry.propagate import set_global_textmap
    from opentelemetry.propagators.aws import AwsXRayPropagator
    from opentelemetry.sdk.extension.aws.trace import AwsXRayIdGenerator
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    resource = Resource.create(
        {
            "service.name": "workpilot-api",
            "service.version": settings.app_version,
            "deployment.environment": settings.environment,
        }
    )

    provider = TracerProvider(
        resource=resource,
        id_generator=AwsXRayIdGenerator(),
    )

    exporter = OTLPSpanExporter(endpoint=settings.otel_exporter_endpoint)
    provider.add_span_processor(BatchSpanProcessor(exporter))

    trace.set_tracer_provider(provider)
    set_global_textmap(AwsXRayPropagator())

    # SQLAlchemy auto-instrumentation (async engine exposes .sync_engine for the
    # underlying sync connection pool that the instrumentor hooks into).
    from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor  # noqa: PLC0415

    from app.db import engine as _async_engine  # noqa: PLC0415

    SQLAlchemyInstrumentor().instrument(engine=_async_engine.sync_engine)

    logger.info(
        "OpenTelemetry configured — exporting to %s",
        settings.otel_exporter_endpoint,
    )


def instrument_fastapi(app: Any) -> None:  # noqa: ANN401
    """Attach FastAPIInstrumentor to the running app.

    Call this from the lifespan hook *after* the FastAPI application object
    has been fully configured (middleware, routers, etc.).
    When OTel is disabled this is a no-op.
    """
    from app.config import get_settings

    if not get_settings().otel_enabled:
        return

    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

        FastAPIInstrumentor.instrument_app(app)
    except ImportError:
        pass


def get_tracer(name: str) -> Any:  # noqa: ANN401
    """Return the global tracer for *name*.

    Returns a real ``opentelemetry.trace.Tracer`` when the SDK is available,
    or a lightweight no-op shim otherwise.  Either way, callers can use
    ``start_as_current_span`` / ``set_attribute`` / ``add_event`` / etc.
    """
    try:
        from opentelemetry import trace

        return trace.get_tracer(name)
    except ImportError:
        return _NoOpTracer()
