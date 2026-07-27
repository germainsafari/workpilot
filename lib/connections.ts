import type { SavedConnection } from "../app/components/ConnectModal";

const STORAGE_KEY = "wp-connections";

export function loadConnections(): SavedConnection[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as SavedConnection[];
  } catch {
    return [];
  }
}

export function normalizeConnectionUrl(url: string): string {
  return url.trim().replace(/\/$/, "");
}

/** Scoro MCP lives at {site}/mcp — auto-append when user pastes the site root. */
export function normalizeMcpEndpoint(url: string, hostname?: string): string {
  let endpoint = normalizeConnectionUrl(url);
  if (!endpoint) return endpoint;

  if (hostname === "scoro.com" && !endpoint.endsWith("/mcp")) {
    endpoint = `${endpoint}/mcp`;
  }

  return endpoint;
}

export function persistConnection(conn: SavedConnection): SavedConnection[] {
  const key = normalizeConnectionUrl(conn.url);
  const stored = loadConnections().filter((c) => normalizeConnectionUrl(c.url) !== key);
  const next = [...stored, conn];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function removeConnection(id: string): SavedConnection[] {
  const next = loadConnections().filter((c) => c.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
