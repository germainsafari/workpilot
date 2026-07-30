"""Add the connections table for third-party credentials and tool catalogs.

Before this, WorkPilot had no server-side notion of a connection: tokens lived
in browser local storage and nothing read them at execution time, so ``tool``
steps could never reach a real system.

``encrypted_token`` holds a Fernet ciphertext produced by ``app.crypto`` — the
column never contains a plaintext credential.
"""

import sqlalchemy as sa

from alembic import op

revision = "0002_connections"
down_revision = "0001_phase_one"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "connections",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("tenant_id", sa.String(64), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("connector_id", sa.String(80), nullable=False, server_default="custom"),
        sa.Column("name", sa.String(180), nullable=False),
        sa.Column("kind", sa.String(30), nullable=False, server_default="mcp"),
        sa.Column("base_url", sa.String(500), nullable=False, server_default=""),
        sa.Column("encrypted_token", sa.Text(), nullable=True),
        sa.Column("tool_catalog", sa.JSON(), nullable=False),
        sa.Column("server_info", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="untested"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("last_checked_at", sa.DateTime(), nullable=True),
        sa.Column("created_by", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("tenant_id", "name", name="uq_connections_tenant_name"),
    )
    op.create_index("ix_connections_tenant_id", "connections", ["tenant_id"])


def downgrade() -> None:
    op.drop_index("ix_connections_tenant_id", table_name="connections")
    op.drop_table("connections")
