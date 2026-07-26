"""SQLAlchemy ORM tables for the control plane.

The data model is deliberately tenant-scoped: ``Tenant`` → ``User`` → ``Workflow``
→ ``WorkflowVersion`` (immutable, versioned canonical definition) → ``WorkflowRun``
→ ``StepRun``. ``AuditEvent`` is an append-only, per-tenant hash-chained log.

Key constraints worth noting:
* ``workflow_versions`` is unique on (workflow_id, version_number).
* ``workflow_runs`` is unique on (tenant_id, idempotency_key) — this is what makes
  run creation idempotent and prevents duplicate executions.

This schema is mirrored in three places that must stay in sync: this file (the
Postgres/SQLite source of truth), the Alembic migration ``0001_phase_one``, and
the Cloudflare D1 schema in ``db/runtime.ts`` used by the demo deployment.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    return datetime.utcnow()


class Tenant(Base):
    __tablename__ = "tenants"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(180))
    slug: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    plan: Mapped[str] = mapped_column(String(40), default="demo")
    settings: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    data_region: Mapped[str] = mapped_column(String(40), default="eu-central-1")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    email: Mapped[str] = mapped_column(String(320))
    name: Mapped[str] = mapped_column(String(180))
    role: Mapped[str] = mapped_column(String(60), default="workflow_admin")
    status: Mapped[str] = mapped_column(String(30), default="active")
    locale: Mapped[str] = mapped_column(String(20), default="en")
    timezone: Mapped[str] = mapped_column(String(80), default="Europe/Warsaw")


class Workflow(Base):
    __tablename__ = "workflows"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    name: Mapped[str] = mapped_column(String(180))
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(30), default="draft")
    active_version_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    department: Mapped[str] = mapped_column(String(100), default="Operations")
    risk_level: Mapped[str] = mapped_column(String(20), default="low")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    versions: Mapped[list["WorkflowVersion"]] = relationship(
        back_populates="workflow", cascade="all, delete-orphan"
    )


class WorkflowVersion(Base):
    __tablename__ = "workflow_versions"
    __table_args__ = (UniqueConstraint("workflow_id", "version_number"),)
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    workflow_id: Mapped[str] = mapped_column(ForeignKey("workflows.id"), index=True)
    version_number: Mapped[int] = mapped_column(Integer)
    canonical_definition: Mapped[dict[str, Any]] = mapped_column(JSON)
    generated_explanation: Mapped[str] = mapped_column(Text, default="")
    validation_result: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    runtime_plan: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    workflow: Mapped[Workflow] = relationship(back_populates="versions")


class WorkflowRun(Base):
    __tablename__ = "workflow_runs"
    __table_args__ = (UniqueConstraint("tenant_id", "idempotency_key"),)
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    workflow_id: Mapped[str] = mapped_column(ForeignKey("workflows.id"), index=True)
    workflow_version_id: Mapped[str] = mapped_column(ForeignKey("workflow_versions.id"))
    status: Mapped[str] = mapped_column(String(30))
    trigger_type: Mapped[str] = mapped_column(String(50), default="manual")
    trigger_payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    current_step_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    total_cost: Mapped[float] = mapped_column(Float, default=0)
    token_usage: Mapped[int] = mapped_column(Integer, default=0)
    error_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(180))
    trace_id: Mapped[str] = mapped_column(String(64))
    steps: Mapped[list["StepRun"]] = relationship(back_populates="run", cascade="all, delete-orphan")


class StepRun(Base):
    __tablename__ = "step_runs"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("workflow_runs.id"), index=True)
    step_id: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(30))
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    input_data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    output_data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    model_usage: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    tool_usage: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    run: Mapped[WorkflowRun] = relationship(back_populates="steps")


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    actor_type: Mapped[str] = mapped_column(String(30))
    actor_id: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(120), index=True)
    resource_type: Mapped[str] = mapped_column(String(60))
    resource_id: Mapped[str] = mapped_column(String(64), index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, default=dict)
    immutable_hash: Mapped[str] = mapped_column(String(128))
