import { z } from "zod";
import { audit, ensureDatabase, tenantIdFrom } from "../../../../../db/runtime";
import { executeNativeWorkflow, type ExecutableStep } from "../../../../../lib/native-executor";

type RouteContext = { params: Promise<{ id: string }> };
const runRequest = z.object({ input: z.record(z.string(), z.unknown()).default({}), idempotencyKey: z.string().min(8).max(200).optional(), triggerType: z.string().max(60).default("manual") });

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = runRequest.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid run request", details: parsed.error.flatten() }, { status: 400 });
  const db = await ensureDatabase();
  const tenantId = tenantIdFrom(request);
  const idempotencyKey = parsed.data.idempotencyKey ?? crypto.randomUUID();
  const prior = await db.prepare("SELECT id, status FROM workflow_runs WHERE idempotency_key = ? AND tenant_id = ?").bind(idempotencyKey, tenantId).first();
  if (prior) return Response.json({ run: prior, replayed: true });
  const version = await db.prepare(`SELECT v.id, v.canonical_definition AS definition FROM workflows w JOIN workflow_versions v ON v.id = w.active_version_id WHERE w.id = ? AND w.tenant_id = ?`).bind(id, tenantId).first<{ id: string; definition: string }>();
  if (!version) return Response.json({ error: "Workflow not found" }, { status: 404 });
  const definition = JSON.parse(version.definition) as { steps?: ExecutableStep[] };
  const runId = `run-${crypto.randomUUID()}`;
  const startedAt = new Date().toISOString();
  await db.prepare("INSERT INTO workflow_runs (id, tenant_id, workflow_id, workflow_version_id, status, trigger_type, trigger_payload, started_at, idempotency_key) VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?)").bind(runId, tenantId, id, version.id, parsed.data.triggerType, JSON.stringify(parsed.data.input), startedAt, idempotencyKey).run();
  await audit(db, tenantId, "run.started", "workflow_run", runId, { workflowId: id });
  const executions = await executeNativeWorkflow(definition.steps ?? [], parsed.data.input);
  const now = new Date().toISOString();
  if (executions.length) await db.batch(executions.map((step) => db.prepare("INSERT INTO step_runs (id, run_id, step_id, status, attempt, started_at, finished_at, input_data, output_data, model_usage, tool_usage) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)").bind(`step-run-${crypto.randomUUID()}`, runId, step.stepId, step.status, startedAt, now, JSON.stringify(step.input), JSON.stringify(step.output), JSON.stringify(step.modelUsage), JSON.stringify(step.toolUsage))));
  await db.prepare("UPDATE workflow_runs SET status = 'completed', finished_at = ?, current_step_id = NULL, total_cost = 0, token_usage = 0 WHERE id = ? AND tenant_id = ?").bind(now, runId, tenantId).run();
  await audit(db, tenantId, "run.completed", "workflow_run", runId, { steps: executions.length });
  return Response.json({ run: { id: runId, workflowId: id, status: "completed", startedAt, finishedAt: now, totalCost: 0, steps: executions } }, { status: 201 });
}
