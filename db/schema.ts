import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: text("plan").notNull().default("demo"),
  settings: text("settings").notNull().default("{}"),
  dataRegion: text("data_region").notNull().default("eu-central-1"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("workflow_admin"),
  status: text("status").notNull().default("active"),
  locale: text("locale").notNull().default("en"),
  timezone: text("timezone").notNull().default("Europe/Warsaw"),
});

export const workflows = sqliteTable("workflows", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("draft"),
  activeVersionId: text("active_version_id"),
  ownerId: text("owner_id").notNull().references(() => users.id),
  department: text("department").notNull().default("Operations"),
  riskLevel: text("risk_level").notNull().default("low"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const workflowVersions = sqliteTable("workflow_versions", {
  id: text("id").primaryKey(),
  workflowId: text("workflow_id").notNull().references(() => workflows.id),
  versionNumber: integer("version_number").notNull(),
  canonicalDefinition: text("canonical_definition").notNull(),
  generatedExplanation: text("generated_explanation").notNull().default(""),
  validationResult: text("validation_result").notNull().default("{}"),
  runtimePlan: text("runtime_plan").notNull().default("{}"),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  publishedAt: text("published_at"),
});

export const workflowRuns = sqliteTable("workflow_runs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  workflowId: text("workflow_id").notNull().references(() => workflows.id),
  workflowVersionId: text("workflow_version_id").notNull().references(() => workflowVersions.id),
  status: text("status").notNull(),
  triggerType: text("trigger_type").notNull().default("manual"),
  triggerPayload: text("trigger_payload").notNull().default("{}"),
  startedAt: text("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  finishedAt: text("finished_at"),
  currentStepId: text("current_step_id"),
  totalCost: real("total_cost").notNull().default(0),
  tokenUsage: integer("token_usage").notNull().default(0),
  errorSummary: text("error_summary"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
});

export const stepRuns = sqliteTable("step_runs", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => workflowRuns.id),
  stepId: text("step_id").notNull(),
  status: text("status").notNull(),
  attempt: integer("attempt").notNull().default(1),
  startedAt: text("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  finishedAt: text("finished_at"),
  inputData: text("input_data").notNull().default("{}"),
  outputData: text("output_data").notNull().default("{}"),
  modelUsage: text("model_usage").notNull().default("{}"),
  toolUsage: text("tool_usage").notNull().default("{}"),
  error: text("error"),
});

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id").notNull(),
  timestamp: text("timestamp").notNull().default(sql`CURRENT_TIMESTAMP`),
  metadata: text("metadata").notNull().default("{}"),
  immutableHash: text("immutable_hash").notNull(),
});
