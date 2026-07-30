import { z } from "zod";
import { audit, ensureDatabase, tenantIdFrom } from "../../../db/runtime";
import { readWorkspace } from "../../../db/workspace-demo";

const renameWorkspace = z.object({
  name: z.string().trim().min(2).max(180),
});

export async function GET(request: Request) {
  const db = await ensureDatabase();
  const tenantId = tenantIdFrom(request);
  const workspace = await readWorkspace(db, tenantId);
  if (!workspace) {
    return Response.json({ detail: "Workspace not found" }, { status: 404 });
  }
  const { settings: _settings, ...payload } = workspace;
  return Response.json(payload);
}

export async function PATCH(request: Request) {
  const parsed = renameWorkspace.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ detail: "Invalid workspace name" }, { status: 422 });
  }

  const db = await ensureDatabase();
  const tenantId = tenantIdFrom(request);
  const existing = await readWorkspace(db, tenantId);
  if (!existing) {
    return Response.json({ detail: "Workspace not found" }, { status: 404 });
  }

  await db.prepare("UPDATE tenants SET name = ? WHERE id = ?").bind(parsed.data.name, tenantId).run();
  await audit(db, tenantId, "workspace.renamed", "tenant", tenantId, {
    from: existing.name,
    to: parsed.data.name,
  });

  const workspace = await readWorkspace(db, tenantId);
  if (!workspace) {
    return Response.json({ detail: "Workspace not found" }, { status: 404 });
  }
  const { settings: _settings, ...payload } = workspace;
  return Response.json(payload);
}
