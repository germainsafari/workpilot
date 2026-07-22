import { ensureDatabase, tenantIdFrom } from "../../../db/runtime";

export async function GET(request: Request) {
  const db = await ensureDatabase();
  const tenantId = tenantIdFrom(request);
  const result = await db.prepare(`SELECT r.id, r.workflow_id AS workflowId, w.name AS workflowName, r.status, r.trigger_type AS triggerType, r.started_at AS startedAt, r.finished_at AS finishedAt, r.total_cost AS totalCost, r.error_summary AS errorSummary FROM workflow_runs r JOIN workflows w ON w.id = r.workflow_id WHERE r.tenant_id = ? ORDER BY r.started_at DESC LIMIT 100`).bind(tenantId).all();
  return Response.json({ runs: result.results });
}
