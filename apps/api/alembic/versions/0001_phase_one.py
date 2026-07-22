"""Create the Phase 1 tenant, workflow, run, and audit tables."""

import sqlalchemy as sa

from alembic import op

revision = "0001_phase_one"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tenants",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(180), nullable=False),
        sa.Column("slug", sa.String(100), nullable=False, unique=True),
        sa.Column("plan", sa.String(40), nullable=False),
        sa.Column("settings", sa.JSON(), nullable=False),
        sa.Column("data_region", sa.String(40), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_tenants_slug", "tenants", ["slug"], unique=True)
    op.create_table(
        "users",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("tenant_id", sa.String(64), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("name", sa.String(180), nullable=False),
        sa.Column("role", sa.String(60), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("locale", sa.String(20), nullable=False),
        sa.Column("timezone", sa.String(80), nullable=False),
    )
    op.create_index("ix_users_tenant_id", "users", ["tenant_id"])
    op.create_table(
        "workflows",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("tenant_id", sa.String(64), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("name", sa.String(180), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("active_version_id", sa.String(64), nullable=True),
        sa.Column("owner_id", sa.String(64), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("department", sa.String(100), nullable=False),
        sa.Column("risk_level", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_workflows_tenant_id", "workflows", ["tenant_id"])
    op.create_table(
        "workflow_versions",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("workflow_id", sa.String(64), sa.ForeignKey("workflows.id"), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("canonical_definition", sa.JSON(), nullable=False),
        sa.Column("generated_explanation", sa.Text(), nullable=False),
        sa.Column("validation_result", sa.JSON(), nullable=False),
        sa.Column("runtime_plan", sa.JSON(), nullable=False),
        sa.Column("created_by", sa.String(64), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("published_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("workflow_id", "version_number"),
    )
    op.create_index("ix_workflow_versions_workflow_id", "workflow_versions", ["workflow_id"])
    op.create_table(
        "workflow_runs",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("tenant_id", sa.String(64), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("workflow_id", sa.String(64), sa.ForeignKey("workflows.id"), nullable=False),
        sa.Column(
            "workflow_version_id", sa.String(64), sa.ForeignKey("workflow_versions.id"), nullable=False
        ),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("trigger_type", sa.String(50), nullable=False),
        sa.Column("trigger_payload", sa.JSON(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("current_step_id", sa.String(120), nullable=True),
        sa.Column("total_cost", sa.Float(), nullable=False),
        sa.Column("token_usage", sa.Integer(), nullable=False),
        sa.Column("error_summary", sa.Text(), nullable=True),
        sa.Column("idempotency_key", sa.String(180), nullable=False),
        sa.Column("trace_id", sa.String(64), nullable=False),
        sa.UniqueConstraint("tenant_id", "idempotency_key"),
    )
    op.create_index("ix_workflow_runs_tenant_id", "workflow_runs", ["tenant_id"])
    op.create_index("ix_workflow_runs_workflow_id", "workflow_runs", ["workflow_id"])
    op.create_table(
        "step_runs",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("run_id", sa.String(64), sa.ForeignKey("workflow_runs.id"), nullable=False),
        sa.Column("step_id", sa.String(120), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("input_data", sa.JSON(), nullable=False),
        sa.Column("output_data", sa.JSON(), nullable=False),
        sa.Column("model_usage", sa.JSON(), nullable=False),
        sa.Column("tool_usage", sa.JSON(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
    )
    op.create_index("ix_step_runs_run_id", "step_runs", ["run_id"])
    op.create_table(
        "audit_events",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("tenant_id", sa.String(64), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("actor_type", sa.String(30), nullable=False),
        sa.Column("actor_id", sa.String(64), nullable=False),
        sa.Column("action", sa.String(120), nullable=False),
        sa.Column("resource_type", sa.String(60), nullable=False),
        sa.Column("resource_id", sa.String(64), nullable=False),
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column("immutable_hash", sa.String(128), nullable=False),
    )
    op.create_index("ix_audit_events_tenant_id", "audit_events", ["tenant_id"])
    op.create_index("ix_audit_events_action", "audit_events", ["action"])
    op.create_index("ix_audit_events_resource_id", "audit_events", ["resource_id"])


def downgrade() -> None:
    op.drop_table("audit_events")
    op.drop_table("step_runs")
    op.drop_table("workflow_runs")
    op.drop_table("workflow_versions")
    op.drop_table("workflows")
    op.drop_table("users")
    op.drop_table("tenants")
