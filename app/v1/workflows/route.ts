// Demo control-plane API served by the Cloudflare Worker itself (D1-backed).
// This is a lightweight mirror of the Python FastAPI endpoint in
// apps/api/app/api/workflows.py, used when the app is deployed without the AWS
// backend. lib/api.ts points at the Python API instead when
// NEXT_PUBLIC_CONTROL_PLANE_URL is set.
import { z } from "zod";
import { audit, DEMO_USER_ID, ensureDatabase, tenantIdFrom } from "../../../db/runtime";

const createWorkflow = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(1000).default(""),
  department: z.string().trim().min(2).max(80).default("Operations"),
  riskLevel: z.enum(["low", "medium", "high"]).default("low"),
  definition: z.record(z.string(), z.unknown()),
});

export async function GET(request: Request) {
  const db = await ensureDatabase();
  const tenantId = tenantIdFrom(request);
  const result = await db.prepare(`SELECT w.id, w.name, w.description, w.status, w.department, w.risk_level AS riskLevel, w.created_at AS createdAt, w.updated_at AS updatedAt, u.name AS owner FROM workflows w JOIN users u ON u.id = w.owner_id WHERE w.tenant_id = ? ORDER BY w.updated_at DESC`).bind(tenantId).all();
  return Response.json({ workflows: result.results });
}

export async function POST(request: Request) {
  const parsed = createWorkflow.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid workflow", details: parsed.error.flatten() }, { status: 400 });
  const db = await ensureDatabase();
  const tenantId = tenantIdFrom(request);
  const workflowId = `wf-${crypto.randomUUID()}`;
  const versionId = `version-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT INTO workflows (id, tenant_id, name, description, status, active_version_id, owner_id, department, risk_level, created_at, updated_at) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)").bind(workflowId, tenantId, parsed.data.name, parsed.data.description, versionId, DEMO_USER_ID, parsed.data.department, parsed.data.riskLevel, now, now),
    db.prepare("INSERT INTO workflow_versions (id, workflow_id, version_number, canonical_definition, generated_explanation, validation_result, runtime_plan, created_by, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)").bind(versionId, workflowId, JSON.stringify(parsed.data.definition), "Draft created by the workflow builder.", JSON.stringify({ valid: true, errors: [] }), JSON.stringify({ primaryRuntime: "native" }), DEMO_USER_ID, now),
  ]);
  await audit(db, tenantId, "workflow.created", "workflow", workflowId, { versionId });
  return Response.json({ workflow: { id: workflowId, ...parsed.data, status: "draft", activeVersionId: versionId, createdAt: now } }, { status: 201 });
}
