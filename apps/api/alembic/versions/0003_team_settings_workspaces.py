"""Team, workspace and settings features — deliberately a schema no-op.

The Team screen, the workspace detail panel and the Settings screen were all
mockups. Making them real needed no new storage:

* team members are rows of the existing ``users`` table (id, tenant_id, email,
  name, role, status, locale, timezone) — a parallel ``team_members`` table
  would only have given the two a way to disagree;
* the workspace panel reads and renames the existing ``tenants`` row;
* workspace settings are a small, read-mostly, one-row-per-tenant document, so
  they live in the existing ``tenants.settings`` JSON column.

This revision exists anyway so the migration chain stays linear and a
deployment that stamped 0003 means the same thing everywhere. Both directions
are intentionally empty.
"""

revision = "0003_team_settings_workspaces"
down_revision = "0002_connections"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No schema change — see the module docstring."""


def downgrade() -> None:
    """Nothing to undo; kept so the chain is reversible without a special case."""
