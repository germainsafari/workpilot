import { ensureDatabase, tenantIdFrom } from "../../../../db/runtime";
import { readWorkspace } from "../../../../db/workspace-demo";

export async function GET(request: Request) {
  const db = await ensureDatabase();
  const tenantId = tenantIdFrom(request);
  const workspace = await readWorkspace(db, tenantId);
  if (!workspace) {
    return Response.json({ detail: "Workspace not found" }, { status: 404 });
  }
  const { settings: _settings, ...payload } = workspace;
  return Response.json([payload]);
}
