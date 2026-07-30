/**
 * Connections are stored server-side, encrypted, and are the only reason a
 * workflow step can reach a real system.
 *
 * This module used to keep them in `localStorage` — including API tokens in
 * plaintext — and nothing on the backend ever read them, which is why a
 * connected server could be listed while every tool step still returned a
 * placeholder. Everything now goes through `/v1/connections`.
 */

import {
  api,
  type ApiConnection,
  type ConnectionCreatePayload,
  type ConnectionUpdatePayload,
} from "./api";

/** A connection as the UI consumes it. Never carries the credential. */
export interface SavedConnection {
  id: string;
  name: string;
  url: string;
  type: "app" | "mcp";
  connectorId: string;
  status: "connected" | "error" | "untested";
  hasToken: boolean;
  tokenHint: string;
  /** Tool names, for compact display. */
  tools: string[];
  /** Full catalog including which tools are read-only. */
  toolDetails: ApiConnection["tools"];
  lastError: string | null;
  connectedAt: string;
}

export function fromApi(row: ApiConnection): SavedConnection {
  return {
    id: row.id,
    name: row.name,
    url: row.base_url,
    type: row.kind === "mcp" ? "mcp" : "app",
    connectorId: row.connector_id,
    status: row.status,
    hasToken: row.has_token,
    tokenHint: row.token_hint,
    tools: row.tools.map((t) => t.name),
    toolDetails: row.tools,
    lastError: row.last_error,
    connectedAt: row.created_at,
  };
}

export function normalizeConnectionUrl(url: string): string {
  return url.trim().replace(/\/$/, "");
}

/** Vendors WorkPilot talks to over REST rather than MCP. */
const REST_HOSTS = new Set(["scoro.com"]);

export function isRestVendor(hostname?: string): boolean {
  return !!hostname && REST_HOSTS.has(hostname);
}

/**
 * Tidy a pasted URL for the transport that will actually be used.
 *
 * Scoro used to get a `/mcp` suffix appended here. That was wrong: Scoro's MCP
 * endpoint sits behind a gateway that requires a JWT, so an API key gets a
 * `401 invalid jwt`. WorkPilot uses Scoro's REST API v2 instead, so a pasted
 * `/mcp` is stripped back to the site root and the connector appends `/api/v2`.
 */
export function normalizeMcpEndpoint(url: string, hostname?: string): string {
  const endpoint = normalizeConnectionUrl(url);
  if (!endpoint) return endpoint;
  if (isRestVendor(hostname)) {
    return endpoint.replace(/\/mcp\/?$/i, "");
  }
  return endpoint;
}

export async function loadConnections(): Promise<SavedConnection[]> {
  const rows = await api.connections.list();
  return rows.map(fromApi);
}

/**
 * Create a connection. The server performs the MCP handshake before replying,
 * so the returned `status` reflects whether it genuinely connected — a failure
 * still persists the row (so a bad token is fixable) but reports `error`.
 */
export async function createConnection(
  payload: ConnectionCreatePayload,
): Promise<SavedConnection> {
  return fromApi(await api.connections.create(payload));
}

export async function updateConnection(
  id: string,
  payload: ConnectionUpdatePayload,
): Promise<SavedConnection> {
  return fromApi(await api.connections.update(id, payload));
}

/** Re-handshake and refresh the cached tool catalog. */
export async function testConnection(id: string): Promise<SavedConnection> {
  return fromApi(await api.connections.test(id));
}

export async function removeConnection(id: string): Promise<void> {
  await api.connections.remove(id);
}

/**
 * One-time migration of connections left in localStorage by the old build.
 *
 * Tokens are deliberately NOT carried across: they were stored in plaintext, so
 * they are treated as compromised and must be re-entered. The endpoint and name
 * are migrated so the user does not lose their list. The local copy is cleared
 * either way, so a plaintext token never lingers in the browser.
 */
const LEGACY_KEY = "wp-connections";

export async function migrateLegacyConnections(): Promise<number> {
  if (typeof window === "undefined") return 0;

  let legacy: Array<{ name?: string; url?: string; type?: string }> = [];
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return 0;
    legacy = JSON.parse(raw) as typeof legacy;
  } catch {
    localStorage.removeItem(LEGACY_KEY);
    return 0;
  }

  let migrated = 0;
  for (const entry of legacy) {
    if (!entry?.url) continue;
    try {
      await createConnection({
        name: entry.name?.trim() || entry.url,
        kind: entry.type === "app" ? "api_key" : "mcp",
        base_url: entry.url,
        connector_id: "custom",
      });
      migrated += 1;
    } catch {
      // Already exists, or the server rejected it — either way, keep going.
    }
  }

  localStorage.removeItem(LEGACY_KEY);
  return migrated;
}
