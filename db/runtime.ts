// Raw Cloudflare D1 (SQLite) access for the self-contained demo backend that
// runs entirely inside the Worker (see app/v1/**). This mirrors the Python
// control plane's schema and seed data so the app works with no AWS backend.
// `ensureDatabase()` lazily creates the tables and seeds the Northstar demo
// tenant on first request. The Drizzle ORM version of the same schema lives in
// db/schema.ts + db/index.ts (used for typed queries / migrations).
import { env } from "cloudflare:workers";

export const DEMO_TENANT_ID = "tenant-northstar";
export const DEMO_USER_ID = "user-alex";

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, plan TEXT NOT NULL DEFAULT 'demo', settings TEXT NOT NULL DEFAULT '{}', data_region TEXT NOT NULL DEFAULT 'eu-central-1', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), email TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'workflow_admin', status TEXT NOT NULL DEFAULT 'active', locale TEXT NOT NULL DEFAULT 'en', timezone TEXT NOT NULL DEFAULT 'Europe/Warsaw')`,
  `CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft', active_version_id TEXT, owner_id TEXT NOT NULL REFERENCES users(id), department TEXT NOT NULL DEFAULT 'Operations', risk_level TEXT NOT NULL DEFAULT 'low', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS workflows_tenant_idx ON workflows (tenant_id, updated_at)`,
  `CREATE TABLE IF NOT EXISTS workflow_versions (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES workflows(id), version_number INTEGER NOT NULL, canonical_definition TEXT NOT NULL, generated_explanation TEXT NOT NULL DEFAULT '', validation_result TEXT NOT NULL DEFAULT '{}', runtime_plan TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, published_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS workflow_runs (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), workflow_id TEXT NOT NULL REFERENCES workflows(id), workflow_version_id TEXT NOT NULL REFERENCES workflow_versions(id), status TEXT NOT NULL, trigger_type TEXT NOT NULL DEFAULT 'manual', trigger_payload TEXT NOT NULL DEFAULT '{}', started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, finished_at TEXT, current_step_id TEXT, total_cost REAL NOT NULL DEFAULT 0, token_usage INTEGER NOT NULL DEFAULT 0, error_summary TEXT, idempotency_key TEXT NOT NULL UNIQUE)`,
  `CREATE INDEX IF NOT EXISTS workflow_runs_tenant_idx ON workflow_runs (tenant_id, started_at)`,
  `CREATE TABLE IF NOT EXISTS step_runs (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES workflow_runs(id), step_id TEXT NOT NULL, status TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 1, started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, finished_at TEXT, input_data TEXT NOT NULL DEFAULT '{}', output_data TEXT NOT NULL DEFAULT '{}', model_usage TEXT NOT NULL DEFAULT '{}', tool_usage TEXT NOT NULL DEFAULT '{}', error TEXT)`,
  `CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), actor_type TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, metadata TEXT NOT NULL DEFAULT '{}', immutable_hash TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS audit_events_tenant_idx ON audit_events (tenant_id, timestamp)`,
];

const clientBriefDefinition = JSON.stringify({
  apiVersion: "workpilot.io/v1",
  kind: "Workflow",
  trigger: { type: "form", label: "New client brief received" },
  steps: [
    { id: "extract", name: "Organize requirements", type: "ai_task" },
    { id: "check", name: "Check for missing details", type: "condition", condition: { field: "missing_details", equals: false } },
    { id: "wait", name: "Wait for account manager", type: "wait", durationSeconds: 0 },
    { id: "tasks", name: "Prepare project tasks", type: "tool", operation: "prepare_tasks", dryRun: true },
    { id: "end", name: "Brief ready", type: "end" },
  ],
  edges: [
    { from: "extract", to: "check" }, { from: "check", to: "wait" }, { from: "wait", to: "tasks" }, { from: "tasks", to: "end" },
  ],
});

export function getD1(): D1Database {
  const bindings = env as unknown as { DB?: D1Database };
  if (!bindings.DB) throw new Error("WorkPilot database binding DB is unavailable");
  return bindings.DB;
}

export async function ensureDatabase(): Promise<D1Database> {
  const db = getD1();
  await db.batch(schemaStatements.map((statement) => db.prepare(statement)));
  const existing = await db.prepare("SELECT id FROM tenants WHERE id = ?").bind(DEMO_TENANT_ID).first();
  if (!existing) {
    const seed = [
      db.prepare("INSERT INTO tenants (id, name, slug, plan) VALUES (?, ?, ?, ?)").bind(DEMO_TENANT_ID, "Northstar Projects", "northstar-projects", "demo"),
      db.prepare("INSERT INTO users (id, tenant_id, email, name, role) VALUES (?, ?, ?, ?, ?)").bind(DEMO_USER_ID, DEMO_TENANT_ID, "alex@northstar.example", "Alex Morgan", "workflow_admin"),
      db.prepare("INSERT INTO users (id, tenant_id, email, name, role) VALUES (?, ?, ?, ?, ?)").bind("user-maya", DEMO_TENANT_ID, "maya@northstar.example", "Maya Chen", "workflow_admin"),
      db.prepare("INSERT INTO users (id, tenant_id, email, name, role) VALUES (?, ?, ?, ?, ?)").bind("user-priya", DEMO_TENANT_ID, "priya@northstar.example", "Priya Shah", "operator"),
      db.prepare("INSERT INTO users (id, tenant_id, email, name, role) VALUES (?, ?, ?, ?, ?)").bind("user-noah", DEMO_TENANT_ID, "noah@northstar.example", "Noah Williams", "approver"),
      db.prepare("INSERT INTO users (id, tenant_id, email, name, role) VALUES (?, ?, ?, ?, ?)").bind("user-elena", DEMO_TENANT_ID, "elena@northstar.example", "Elena Rossi", "workflow_builder"),
      db.prepare("INSERT INTO workflows (id, tenant_id, name, description, status, active_version_id, owner_id, department, risk_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("wf-client-brief", DEMO_TENANT_ID, "Client brief processor", "Turns incoming requests into an approved, delivery-ready project brief.", "active", "version-client-brief-1", DEMO_USER_ID, "Client services", "medium"),
      db.prepare("INSERT INTO workflow_versions (id, workflow_id, version_number, canonical_definition, generated_explanation, validation_result, runtime_plan, created_by, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)").bind("version-client-brief-1", "wf-client-brief", 1, clientBriefDefinition, "Organizes a client brief, checks required details, pauses for review, and prepares tasks in safe mode.", JSON.stringify({ valid: true, errors: [] }), JSON.stringify({ primaryRuntime: "native", estimatedCost: [0.02, 0.05] }), DEMO_USER_ID),
      db.prepare("INSERT INTO audit_events (id, tenant_id, actor_type, actor_id, action, resource_type, resource_id, metadata, immutable_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("audit-seed-1", DEMO_TENANT_ID, "system", "seed", "workflow.created", "workflow", "wf-client-brief", JSON.stringify({ source: "demo_seed" }), "seed:wf-client-brief"),
    ];
    await db.batch(seed);
  }
  return db;
}

export function tenantIdFrom(request: Request): string {
  return request.headers.get("x-workpilot-tenant-id") || DEMO_TENANT_ID;
}

export async function audit(db: D1Database, tenantId: string, action: string, resourceType: string, resourceId: string, metadata: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  const serialized = JSON.stringify(metadata);
  await db.prepare("INSERT INTO audit_events (id, tenant_id, actor_type, actor_id, action, resource_type, resource_id, metadata, immutable_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, tenantId, "user", DEMO_USER_ID, action, resourceType, resourceId, serialized, `${id}:${action}:${resourceId}`).run();
}
