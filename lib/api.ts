import { describeApiBase, getApiBase, isLocalControlPlane } from "./api-base";
import {
  DEMO_WORKSPACE,
  DEMO_WORKSPACE_SETTINGS,
  isMissingEndpointError,
  localCompileFallback,
} from "./api-fallbacks";

const DEMO_TENANT = "tenant-northstar";

function authHeaders(): Record<string, string> {
  if (typeof window === "undefined") return { "X-WorkPilot-Tenant-ID": DEMO_TENANT };
  const activeWorkspace = localStorage.getItem("wp-workspace-id") || DEMO_TENANT;

  // Local FastAPI accepts the tenant header stub; Cognito tokens are for staging/production.
  if (isLocalControlPlane()) {
    return { "X-WorkPilot-Tenant-ID": activeWorkspace };
  }

  const jwt = localStorage.getItem("wp-jwt");
  if (jwt) return { Authorization: `Bearer ${jwt}`, "X-WorkPilot-Tenant-ID": activeWorkspace };
  return { "X-WorkPilot-Tenant-ID": activeWorkspace };
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = getApiBase();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  } catch {
    throw new Error(
      `Cannot reach the API (${describeApiBase()}). `
      + (base === "/api/control-plane"
        ? "The server proxy could not forward your request — check that NEXT_PUBLIC_CONTROL_PLANE_URL is set and the AWS API is running."
        : "Check that the API is running and CORS allows this site."),
    );
  }
  if (res.status === 401 && typeof window !== "undefined") {
    localStorage.removeItem("wp-jwt");
    window.location.href = "/login?reason=session";
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// ──────────────────────────────────────────────── Types ──

export interface ApiWorkflow {
  id: string;
  name: string;
  description: string;
  status: "active" | "draft" | "paused";
  department: string;
  risk_level: "low" | "medium" | "high";
  active_version_id: string | null;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface ApiCanonicalStep {
  id: string;
  name: string;
  type: "ai_task" | "tool" | "condition" | "wait" | "end";
  [key: string]: unknown;
}

export interface ApiEdge {
  from: string;
  to: string;
  label: string | null;
}

export interface ApiWorkflowDetail extends ApiWorkflow {
  version_number: number;
  definition: {
    apiVersion: string;
    trigger: { type: string; label: string };
    steps: ApiCanonicalStep[];
    edges: ApiEdge[];
  };
  explanation: string;
  explanation_detail: ApiWorkflowExplanation;
  validation_result: Record<string, unknown>;
  runtime_plan: Record<string, unknown>;
}

export interface ApiWorkflowExplanation {
  summary: string;
  trigger: string;
  steps: Array<{
    order: number;
    step_id: string;
    name: string;
    type: string;
    detail: string;
    binding: string | null;
  }>;
  approval: string;
  on_failure: string;
  safeguards: string[];
  cost: {
    sample_size: number;
    average_cost_usd: number | null;
    average_tokens: number | null;
    headline: string;
    caption: string;
  };
}

export interface ApiCompileResponse {
  definition: WorkflowCreatePayload["definition"];
  rationale: string;
  ai_compiled: boolean;
  compile_error: string | null;
  bound_tools: Array<{
    step_id: string;
    step_name: string;
    connection_id: string;
    connection_name: string;
    tool_name: string;
  }>;
  dropped_bindings: Array<{
    step_id: string;
    connection_id: string | null;
    tool_name: string | null;
    reason: string;
  }>;
  catalog_size: number;
}

export interface WorkflowCreatePayload {
  name: string;
  description?: string;
  department?: string;
  risk_level?: "low" | "medium" | "high";
  definition: {
    apiVersion: string;
    kind?: string;
    trigger: { type: string; label: string };
    steps: Array<Record<string, unknown>>;
    edges: Array<{ from: string; to: string; label?: string | null }>;
  };
}

export interface ApiStepRun {
  id: string;
  step_id: string;
  status: string;
  attempt?: number;
  model_usage: Record<string, unknown>;
  /**
   * What the step did against a connected system: `invoked`, `tool_name`,
   * `connection_name`, `arguments`, `duration_ms`, `result` summary — or
   * `invoked: false` with a `reason` when nothing was called. The API has always
   * returned this; it simply was not typed, so the UI could not display it.
   */
  tool_usage: Record<string, unknown>;
  started_at: string;
  finished_at: string | null;
  input_data: Record<string, unknown>;
  output_data: Record<string, unknown>;
  error: string | null;
}

export interface ApiRun {
  id: string;
  workflow_id: string;
  workflow_name?: string | null;
  status: "pending" | "queued" | "running" | "completed" | "failed";
  trigger_type: string;
  started_at: string;
  finished_at: string | null;
  total_cost: number;
  token_usage: number;
  error_summary: string | null;
  trace_id: string;
  steps: ApiStepRun[];
}

// ──────────────────────────────────────────────── Helpers ──

/** API timestamps are UTC but often omit the trailing Z — parse them as UTC. */
export function parseApiDate(iso: string): Date {
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(iso)) return new Date(iso);
  return new Date(`${iso.endsWith("Z") ? iso : `${iso}Z`}`);
}

export function formatRelativeTime(iso: string): string {
  const diffMin = Math.floor((Date.now() - parseApiDate(iso).getTime()) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "Yesterday" : `${d} days ago`;
}

export function formatDuration(started: string, finished: string | null): string {
  if (!finished) return "running…";
  const ms = parseApiDate(finished).getTime() - parseApiDate(started).getTime();
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
}

export function runWorkflowLabel(run: ApiRun, workflows?: ApiWorkflow[]): string {
  if (run.workflow_name) return run.workflow_name;
  const match = workflows?.find((w) => w.id === run.workflow_id);
  return match?.name ?? run.workflow_id;
}

// ──────────────────────────────────────────────── Connections ──

export interface ApiConnectionTool {
  name: string;
  description: string;
  read_only: boolean;
  input_schema: Record<string, unknown>;
}

/**
 * A stored connection. The credential is never returned by the API — only
 * `has_token` and a masked `token_hint`.
 */
export interface ApiConnection {
  id: string;
  connector_id: string;
  name: string;
  kind: "mcp" | "api_key";
  base_url: string;
  status: "connected" | "error" | "untested";
  has_token: boolean;
  token_hint: string;
  tools: ApiConnectionTool[];
  server_info: Record<string, unknown>;
  last_error: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiAvailableTool {
  connection_id: string;
  connection_name: string;
  connector_id: string;
  tool_name: string;
  description: string;
  read_only: boolean;
  input_schema: Record<string, unknown>;
}

export interface ConnectionCreatePayload {
  name: string;
  connector_id?: string;
  kind: "mcp" | "api_key";
  base_url: string;
  /** Write-only. Encrypted server-side and never echoed back. */
  token?: string;
}

export interface ConnectionUpdatePayload {
  name?: string;
  base_url?: string;
  token?: string;
}

export type TeamRole =
  | "workflow_admin"
  | "workflow_builder"
  | "approver"
  | "operator"
  | "viewer";

export interface ApiTeamMember {
  id: string;
  email: string;
  name: string;
  role: string;
  status: "active" | "invited" | "suspended" | string;
  locale: string;
  timezone: string;
}

export interface TeamInvitePayload {
  email: string;
  name: string;
  role: TeamRole;
}

export interface TeamMemberUpdatePayload {
  name?: string;
  role?: TeamRole;
  status?: "active" | "invited" | "suspended";
}

export interface ApiWorkspace {
  id: string;
  name: string;
  slug: string;
  plan: string;
  data_region: string;
  member_count: number;
  workflow_count: number;
}

export interface ApiWorkspaceSettings {
  allow_tool_writes: boolean;
  require_approval_for_writes: boolean;
  max_run_cost_usd: number;
  data_region: string;
  notify_on_run_failure: boolean;
  notify_on_approval_needed: boolean;
  notify_email: string;
  retain_run_days: number;
}

export type WorkspaceSettingsPayload = Partial<
  Omit<ApiWorkspaceSettings, "allow_tool_writes">
>;

// ──────────────────────────────────────────────── API calls ──

export const api = {
  workflows: {
    list: (): Promise<ApiWorkflow[]> => apiFetch("/v1/workflows?limit=50"),
    get: (id: string): Promise<ApiWorkflowDetail> => apiFetch(`/v1/workflows/${id}`),
    create: (payload: WorkflowCreatePayload): Promise<ApiWorkflow> =>
      apiFetch("/v1/workflows", { method: "POST", body: JSON.stringify(payload) }),
    updateStatus: (id: string, status: "active" | "draft" | "paused"): Promise<ApiWorkflow> =>
      apiFetch(`/v1/workflows/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    /** Persist builder edits (added/renamed steps, rewired edges, tool bindings). */
    saveDefinition: (
      id: string,
      definition: import("./workflow-draft").CanonicalDefinition,
    ): Promise<ApiWorkflow> =>
      apiFetch(`/v1/workflows/${id}/definition`, {
        method: "PUT",
        body: JSON.stringify({ definition }),
      }),
    compile: async (description: string): Promise<ApiCompileResponse> => {
      try {
        return await apiFetch("/v1/workflows/compile", {
          method: "POST",
          body: JSON.stringify({ description }),
        });
      } catch (error) {
        if (isMissingEndpointError(error)) return localCompileFallback(description);
        throw error;
      }
    },
  },
  runs: {
    list: (): Promise<ApiRun[]> => apiFetch("/v1/runs?limit=100"),
    get: (id: string): Promise<ApiRun> => apiFetch(`/v1/runs/${id}`),
    trigger: (workflowId: string, input: Record<string, unknown> = {}): Promise<ApiRun> =>
      apiFetch(`/v1/workflows/${workflowId}/runs`, {
        method: "POST",
        body: JSON.stringify({ input, trigger_type: "manual" }),
      }),
  },
  connections: {
    list: (): Promise<ApiConnection[]> => apiFetch("/v1/connections"),
    /** Every callable tool across all connected servers — what the compiler binds against. */
    tools: (): Promise<ApiAvailableTool[]> => apiFetch("/v1/connections/tools"),
    create: (payload: ConnectionCreatePayload): Promise<ApiConnection> =>
      apiFetch("/v1/connections", { method: "POST", body: JSON.stringify(payload) }),
    update: (id: string, payload: ConnectionUpdatePayload): Promise<ApiConnection> =>
      apiFetch(`/v1/connections/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
    /** Re-handshake and refresh the cached tool catalog. */
    test: (id: string): Promise<ApiConnection> =>
      apiFetch(`/v1/connections/${id}/test`, { method: "POST" }),
    remove: (id: string): Promise<void> =>
      apiFetch(`/v1/connections/${id}`, { method: "DELETE" }),
  },
  team: {
    list: async (): Promise<ApiTeamMember[]> => {
      try {
        return await apiFetch("/v1/team");
      } catch (error) {
        if (isMissingEndpointError(error)) return [];
        throw error;
      }
    },
    /** Creates the member with status "invited". No email is sent yet. */
    invite: (payload: TeamInvitePayload): Promise<ApiTeamMember> =>
      apiFetch("/v1/team", { method: "POST", body: JSON.stringify(payload) }),
    update: (id: string, payload: TeamMemberUpdatePayload): Promise<ApiTeamMember> =>
      apiFetch(`/v1/team/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
    /** 409s when the target is you, the last workflow_admin, or still owns workflows. */
    remove: (id: string): Promise<void> =>
      apiFetch(`/v1/team/${id}`, { method: "DELETE" }),
  },
  workspace: {
    get: async (): Promise<ApiWorkspace> => {
      try {
        return await apiFetch("/v1/workspace");
      } catch (error) {
        if (isMissingEndpointError(error)) return DEMO_WORKSPACE;
        throw error;
      }
    },
    available: async (): Promise<ApiWorkspace[]> => {
      try {
        return await apiFetch("/v1/workspace/available");
      } catch (error) {
        if (isMissingEndpointError(error)) return [DEMO_WORKSPACE];
        throw error;
      }
    },
    /** Rename only — the slug is immutable server-side. */
    rename: async (name: string): Promise<ApiWorkspace> => {
      try {
        return await apiFetch("/v1/workspace", { method: "PATCH", body: JSON.stringify({ name }) });
      } catch (error) {
        if (isMissingEndpointError(error)) return { ...DEMO_WORKSPACE, name };
        throw error;
      }
    },
  },
  settings: {
    get: async (): Promise<ApiWorkspaceSettings> => {
      try {
        return await apiFetch("/v1/workspace/settings");
      } catch (error) {
        if (isMissingEndpointError(error)) return DEMO_WORKSPACE_SETTINGS;
        throw error;
      }
    },
    /** Merges over what is stored; omitted keys keep their saved value. */
    save: async (payload: WorkspaceSettingsPayload): Promise<ApiWorkspaceSettings> => {
      try {
        return await apiFetch("/v1/workspace/settings", { method: "PUT", body: JSON.stringify(payload) });
      } catch (error) {
        if (isMissingEndpointError(error)) return { ...DEMO_WORKSPACE_SETTINGS, ...payload };
        throw error;
      }
    },
  },
};

// ──────────────────────────────────────────────── Cognito auth ──

const COGNITO_REGION = process.env.NEXT_PUBLIC_COGNITO_REGION ?? "eu-central-1";
const COGNITO_CLIENT_ID = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? "";
const COGNITO_ENDPOINT = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`;

export async function cognitoLogin(email: string, password: string): Promise<void> {
  const res = await fetch(COGNITO_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
    },
    body: JSON.stringify({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, string>;
    throw new Error(err.message ?? err.__type ?? "Login failed");
  }
  const data = await res.json() as { AuthenticationResult?: { IdToken?: string } };
  const token = data?.AuthenticationResult?.IdToken;
  if (!token) throw new Error("No token returned from Cognito");
  localStorage.setItem("wp-jwt", token);
}

export function isLoggedIn(): boolean {
  if (typeof window === "undefined") return false;
  return !!localStorage.getItem("wp-jwt");
}

export type SessionUser = { name: string; email: string; initials: string };

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function initialsFrom(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return email.slice(0, 2).toUpperCase() || "WP";
}

/** Read display fields from the stored Cognito ID token (client-side only). */
export function getSessionUser(): SessionUser | null {
  if (typeof window === "undefined") return null;
  const token = localStorage.getItem("wp-jwt");
  if (!token) return null;
  const claims = decodeJwtPayload(token);
  if (!claims) return null;
  const email = String(claims.email ?? "");
  const name = String(claims.name ?? claims["cognito:username"] ?? email.split("@")[0] ?? "User");
  return { name, email, initials: initialsFrom(name, email) };
}

export function logout(): void {
  localStorage.removeItem("wp-jwt");
  window.location.href = "/login";
}
