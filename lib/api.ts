const BASE = (process.env.NEXT_PUBLIC_CONTROL_PLANE_URL ?? "http://localhost:8000").replace(/\/$/, "");
const DEMO_TENANT = "tenant-northstar";

function authHeaders(): Record<string, string> {
  if (typeof window === "undefined") return { "X-WorkPilot-Tenant-ID": DEMO_TENANT };
  const jwt = localStorage.getItem("wp-jwt");
  if (jwt) return { Authorization: `Bearer ${jwt}` };
  return { "X-WorkPilot-Tenant-ID": DEMO_TENANT };
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
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
}

export interface ApiStepRun {
  id: string;
  step_id: string;
  status: string;
  model_usage: Record<string, unknown>;
  started_at: string;
  finished_at: string | null;
  input_data: Record<string, unknown>;
  output_data: Record<string, unknown>;
}

export interface ApiRun {
  id: string;
  workflow_id: string;
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

export function formatRelativeTime(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "Yesterday" : `${d} days ago`;
}

export function formatDuration(started: string, finished: string | null): string {
  if (!finished) return "running…";
  const ms = new Date(finished).getTime() - new Date(started).getTime();
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
}

// ──────────────────────────────────────────────── API calls ──

export const api = {
  workflows: {
    list: (): Promise<ApiWorkflow[]> => apiFetch("/v1/workflows?limit=50"),
    get: (id: string): Promise<ApiWorkflowDetail> => apiFetch(`/v1/workflows/${id}`),
    updateStatus: (id: string, status: "active" | "draft" | "paused"): Promise<ApiWorkflow> =>
      apiFetch(`/v1/workflows/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
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

export function logout(): void {
  localStorage.removeItem("wp-jwt");
  window.location.href = "/login";
}
