import { z } from "zod";
import { audit, ensureDatabase, tenantIdFrom } from "../../../../db/runtime";

type RouteContext = { params: Promise<{ id: string }> };
const updateWorkflow = z.object({ name: z.string().trim().min(3).max(120).optional(), description: z.string().trim().max(1000).optional(), department: z.string().trim().min(2).max(80).optional(), riskLevel: z.enum(["low", "medium", "high"]).optional(), status: z.enum(["draft", "active", "paused"]).optional() });

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const db = await ensureDatabase();
  const tenantId = tenantIdFrom(request);
  const workflow = await db.prepare(`SELECT w.id, w.name, w.description, w.status, w.department, w.risk_level AS riskLevel, w.active_version_id AS activeVersionId, w.created_at AS createdAt, w.updated_at AS updatedAt, u.name AS owner, v.version_number AS versionNumber, v.canonical_definition AS definition, v.generated_explanation AS explanation, v.validation_result AS validationResult, v.runtime_plan AS runtimePlan FROM workflows w JOIN users u ON u.id = w.owner_id JOIN workflow_versions v ON v.id = w.active_version_id WHERE w.id = ? AND w.tenant_id = ?`).bind(id, tenantId).first<Record<string, unknown>>();
  if (!workflow) return Response.json({ error: "Workflow not found" }, { status: 404 });
  for (const field of ["definition", "validationResult", "runtimePlan"] as const) if (typeof workflow[field] === "string") workflow[field] = JSON.parse(workflow[field] as string);
  return Response.json({ workflow });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = updateWorkflow.safeParse(await request.json());
  if (!parsed.success || Object.keys(parsed.data).length === 0) return Response.json({ error: "No valid changes supplied" }, { status: 400 });
  const db = await ensureDatabase();
  const tenantId = tenantIdFrom(request);
  const existing = await db.prepare("SELECT id FROM workflows WHERE id = ? AND tenant_id = ?").bind(id, tenantId).first();
  if (!existing) return Response.json({ error: "Workflow not found" }, { status: 404 });
  const fields: string[] = []; const values: unknown[] = [];
  const mapping: Record<string, string> = { name: "name", description: "description", department: "department", riskLevel: "risk_level", status: "status" };
  for (const [key, value] of Object.entries(parsed.data)) { fields.push(`${mapping[key]} = ?`); values.push(value); }
  fields.push("updated_at = ?"); values.push(new Date().toISOString(), id, tenantId);
  await db.prepare(`UPDATE workflows SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`).bind(...values).run();
  await audit(db, tenantId, "workflow.updated", "workflow", id, { fields: Object.keys(parsed.data) });
  return Response.json({ id, ...parsed.data });
}

export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const db = await ensureDatabase();
  const tenantId = tenantIdFrom(request);
  const workflow = await db.prepare("SELECT id FROM workflows WHERE id = ? AND tenant_id = ?").bind(id, tenantId).first();
  if (!workflow) return Response.json({ error: "Workflow not found" }, { status: 404 });
  await audit(db, tenantId, "workflow.deleted", "workflow", id);
  await db.batch([db.prepare("DELETE FROM workflow_versions WHERE workflow_id = ?").bind(id), db.prepare("DELETE FROM workflows WHERE id = ? AND tenant_id = ?").bind(id, tenantId)]);
  return new Response(null, { status: 204 });
}
