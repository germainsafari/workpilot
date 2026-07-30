import { z } from "zod";
import { audit, ensureDatabase, tenantIdFrom } from "../../../../db/runtime";
import { parseSettings, readWorkspace, WORKSPACE_SETTINGS_DEFAULTS } from "../../../../db/workspace-demo";

const saveSettings = z.object({
  require_approval_for_writes: z.boolean().optional(),
  max_run_cost_usd: z.number().min(0).max(1000).optional(),
  data_region: z.string().min(2).max(40).optional(),
  notify_on_run_failure: z.boolean().optional(),
  notify_on_approval_needed: z.boolean().optional(),
  notify_email: z.string().max(320).optional(),
  retain_run_days: z.number().int().min(1).max(3650).optional(),
});

export async function GET(request: Request) {
  const db = await ensureDatabase();
  const tenantId = tenantIdFrom(request);
  const workspace = await readWorkspace(db, tenantId);
  if (!workspace) {
    return Response.json({ detail: "Workspace not found" }, { status: 404 });
  }
  return Response.json(parseSettings(workspace.settings, workspace.data_region));
}

export async function PUT(request: Request) {
  const parsed = saveSettings.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ detail: "Invalid settings payload" }, { status: 422 });
  }

  const db = await ensureDatabase();
  const tenantId = tenantIdFrom(request);
  const workspace = await readWorkspace(db, tenantId);
  if (!workspace) {
    return Response.json({ detail: "Workspace not found" }, { status: 404 });
  }

  const current = parseSettings(workspace.settings, workspace.data_region);
  const next = {
    ...WORKSPACE_SETTINGS_DEFAULTS,
    ...current,
    ...parsed.data,
  };
  const stored = {
    require_approval_for_writes: next.require_approval_for_writes,
    max_run_cost_usd: next.max_run_cost_usd,
    data_region: next.data_region,
    notify_on_run_failure: next.notify_on_run_failure,
    notify_on_approval_needed: next.notify_on_approval_needed,
    notify_email: next.notify_email,
    retain_run_days: next.retain_run_days,
  };

  await db
    .prepare("UPDATE tenants SET settings = ?, data_region = ? WHERE id = ?")
    .bind(JSON.stringify(stored), next.data_region, tenantId)
    .run();
  await audit(db, tenantId, "workspace.settings_updated", "tenant", tenantId, parsed.data);

  return Response.json({
    allow_tool_writes: false,
    ...stored,
  });
}
