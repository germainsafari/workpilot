export const WORKSPACE_SETTINGS_DEFAULTS = {
  require_approval_for_writes: true,
  max_run_cost_usd: 1,
  notify_on_run_failure: true,
  notify_on_approval_needed: true,
  notify_email: "",
  retain_run_days: 90,
} as const;

export type WorkspaceSettings = typeof WORKSPACE_SETTINGS_DEFAULTS & {
  allow_tool_writes: boolean;
  data_region: string;
};

export function parseSettings(raw: string | null | undefined, dataRegion: string): WorkspaceSettings {
  let stored: Record<string, unknown> = {};
  if (raw) {
    try {
      stored = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      stored = {};
    }
  }
  return {
    allow_tool_writes: false,
    require_approval_for_writes: Boolean(
      stored.require_approval_for_writes ?? WORKSPACE_SETTINGS_DEFAULTS.require_approval_for_writes,
    ),
    max_run_cost_usd: Number(stored.max_run_cost_usd ?? WORKSPACE_SETTINGS_DEFAULTS.max_run_cost_usd),
    data_region: String(stored.data_region ?? dataRegion),
    notify_on_run_failure: Boolean(
      stored.notify_on_run_failure ?? WORKSPACE_SETTINGS_DEFAULTS.notify_on_run_failure,
    ),
    notify_on_approval_needed: Boolean(
      stored.notify_on_approval_needed ?? WORKSPACE_SETTINGS_DEFAULTS.notify_on_approval_needed,
    ),
    notify_email: String(stored.notify_email ?? WORKSPACE_SETTINGS_DEFAULTS.notify_email),
    retain_run_days: Number(stored.retain_run_days ?? WORKSPACE_SETTINGS_DEFAULTS.retain_run_days),
  };
}

export async function readWorkspace(db: D1Database, tenantId: string) {
  const tenant = await db
    .prepare("SELECT id, name, slug, plan, data_region, settings FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<{ id: string; name: string; slug: string; plan: string; data_region: string; settings: string }>();
  if (!tenant) return null;

  const memberCount = await db
    .prepare("SELECT COUNT(*) AS count FROM users WHERE tenant_id = ?")
    .bind(tenantId)
    .first<{ count: number }>();
  const workflowCount = await db
    .prepare("SELECT COUNT(*) AS count FROM workflows WHERE tenant_id = ?")
    .bind(tenantId)
    .first<{ count: number }>();

  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    plan: tenant.plan,
    data_region: tenant.data_region,
    member_count: memberCount?.count ?? 0,
    workflow_count: workflowCount?.count ?? 0,
    settings: tenant.settings,
  };
}
