"use client";

import { Check, ExternalLink, Key, Link2, LoaderCircle, Server, X, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { normalizeMcpEndpoint, persistConnection } from "../../lib/connections";
import { resolveKnownService } from "../../lib/connectors";

export interface SavedConnection {
  id: string;
  name: string;
  url: string;
  type: "app" | "mcp";
  token?: string;
  status: "connected" | "error";
  tools?: string[];
  connectedAt: string;
}

interface Props {
  type: "app" | "mcp";
  defaultName?: string;
  defaultUrl?: string;
  onClose: () => void;
  onSave: (conn: SavedConnection) => void;
}

type Phase = "form" | "probing" | "success" | "error";

export function ConnectModal({ type, defaultName = "", defaultUrl = "", onClose, onSave }: Props) {
  const [name, setName] = useState(defaultName);
  const [url, setUrl] = useState(defaultUrl);
  const [token, setToken] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [errMsg, setErrMsg] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const urlRef = useRef<HTMLInputElement>(null);

  const service = resolveKnownService(url, name);

  useEffect(() => { urlRef.current?.focus(); }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const probe = async () => {
    if (!url.trim()) { setErrMsg("URL is required"); return; }
    setPhase("probing");
    setErrMsg("");

    const trimmed = url.trim();
    const endpoint = normalizeMcpEndpoint(trimmed, service?.hostname);
    if (endpoint !== trimmed.replace(/\/$/, "")) {
      setUrl(endpoint);
    }
    const mcpHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    };
    if (token) mcpHeaders["Authorization"] = `Bearer ${token}`;

    let discoveredTools: string[] = [];

    const parseSse = (text: string): unknown => {
      for (const line of text.split("\n")) {
        if (line.startsWith("data:")) {
          try { return JSON.parse(line.slice(5).trim()); } catch { /* skip */ }
        }
      }
      try { return JSON.parse(text); } catch { return null; }
    };

    try {
      // Step 1: MCP initialize — required to obtain session ID
      const initResp = await fetch(endpoint, {
        method: "POST",
        headers: mcpHeaders,
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "workpilot-ui", version: "1" } },
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (!initResp.ok) {
        if (initResp.status === 401) throw new Error("auth_required");
        throw new Error(`Server returned ${initResp.status}`);
      }

      const sessionId = initResp.headers.get("mcp-session-id");
      const toolsHeaders = { ...mcpHeaders };
      if (sessionId) toolsHeaders["mcp-session-id"] = sessionId;

      // Step 2: tools/list
      const toolsResp = await fetch(endpoint, {
        method: "POST",
        headers: toolsHeaders,
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
        signal: AbortSignal.timeout(8000),
      });

      if (toolsResp.ok) {
        const raw = await toolsResp.text();
        const data = parseSse(raw) as { result?: { tools?: Array<{ name: string }> } } | null;
        if (data?.result?.tools) {
          discoveredTools = data.result.tools.map((t) => t.name).slice(0, 8);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";

      if (msg === "auth_required") {
        setPhase("error");
        setErrMsg(
          service
            ? `${service.label} requires an API token. Use the link above to get yours, then paste it in the token field and try again.`
            : "Server requires authentication. Add your API key or Bearer token above and try again."
        );
        return;
      }

      // CORS or network failure — try a no-cors GET to at least confirm reachability
      try {
        await fetch(url.trim(), { method: "GET", mode: "no-cors", signal: AbortSignal.timeout(5000) });
        // Opaque response means server is reachable but CORS blocks discovery
        setTools([]);
        setPhase("success");
        return;
      } catch {
        setPhase("error");
        setErrMsg("Could not reach the server. Check the URL, ensure it is running, and that CORS allows this origin.");
        return;
      }
    }

    setTools(discoveredTools);
    setPhase("success");
  };

  const save = () => {
    if (!url.trim()) {
      setErrMsg("URL is required");
      setPhase("error");
      return;
    }

    const endpoint = normalizeMcpEndpoint(url.trim(), service?.hostname);
    const conn: SavedConnection = {
      id: crypto.randomUUID(),
      name: name.trim() || endpoint,
      url: endpoint,
      type: type === "app" && service?.hostname === "scoro.com" ? "mcp" : type,
      token: token || undefined,
      status: phase === "error" ? "error" : "connected",
      tools: tools.length ? tools : undefined,
      connectedAt: new Date().toISOString(),
    };

    try {
      persistConnection(conn);
      onSave(conn);
      onClose();
    } catch {
      setPhase("error");
      setErrMsg("Could not save this connection. Check that your browser allows local storage.");
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-header">
          <div className="modal-title-wrap">
            <span className="modal-icon">{type === "mcp" ? <Server size={20} /> : <Link2 size={20} />}</span>
            <div>
              <h2>{type === "mcp" ? "Connect MCP server" : "Connect app"}</h2>
              <p>{type === "mcp"
                ? "Add any Model Context Protocol server — your AI agents can then call its tools"
                : "Add a business app for your workflows to read from or write to"}</p>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="modal-body">
          <label className="form-field">
            <span>Display name</span>
            <input value={name} onChange={(e) => setName(e.target.value)}
              placeholder={type === "mcp" ? "e.g. Scoro MCP" : "e.g. Company Drive"} />
          </label>

          <label className="form-field">
            <span>{type === "mcp" ? "MCP server URL" : service ? `${service.label} site address` : "API / OAuth endpoint"}</span>
            <input ref={urlRef} value={url} onChange={(e) => setUrl(e.target.value)}
              type="url"
              placeholder={type === "mcp" ? "https://yourapp.scoro.com/mcp" : service ? service.urlPlaceholder : "https://api.example.com/oauth"}
              disabled={phase === "probing" || phase === "success"} />
          </label>

          {/* Service-specific auth guide — shown as soon as a known service is detected */}
          {service && phase !== "success" && (
            <div className="modal-service-hint">
              <span className="modal-service-icon">{service.icon}</span>
              <div>
                <strong>How to connect {service.label}</strong>
                <p>{service.tokenHelp}</p>
                <ol className="connect-steps">
                  {service.steps.map((step, i) => (
                    <li key={i}><b>{i + 1}</b><span>{step}</span></li>
                  ))}
                </ol>
                <a href={service.tokenUrl} target="_blank" rel="noopener noreferrer" className="modal-service-link">
                  <ExternalLink size={12} />{service.tokenLinkLabel}
                </a>
              </div>
            </div>
          )}

          <label className="form-field">
            <span><Key size={13} style={{ display: "inline", marginRight: 4 }} />
              {service ? `${service.label} API token` : "API key / Bearer token"}
              {" "}<em style={{ color: "var(--muted)", fontStyle: "normal" }}>(optional for public servers)</em>
            </span>
            <input value={token} onChange={(e) => setToken(e.target.value)}
              type="password"
              placeholder={service ? `Paste your ${service.label} API token here` : "sk-… or leave empty for public servers"}
              disabled={phase === "probing" || phase === "success"} />
          </label>

          {phase === "error" && (
            <div className="modal-error">
              <X size={14} /> {errMsg}
              <button className="text-link" style={{ marginLeft: "auto" }} onClick={() => setPhase("form")}>Try again</button>
            </div>
          )}

          {phase === "success" && (
            <div className="modal-success">
              <Check size={14} /> Server reachable{tools.length > 0 ? ` — ${tools.length} tools discovered` : ""}
              {tools.length > 0 && (
                <div className="modal-tools">
                  {tools.map((t) => <span key={t}><Zap size={10} />{t}</span>)}
                </div>
              )}
            </div>
          )}

          {type === "mcp" && phase === "form" && !service && (
            <div className="modal-hint">
              <ExternalLink size={13} />
              <span>Popular servers: <code>npx @modelcontextprotocol/server-filesystem</code> · <code>npx @modelcontextprotocol/server-brave-search</code></span>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="secondary-button" onClick={onClose}>Cancel</button>
          {phase === "success" ? (
            <button className="primary-button" onClick={save}><Check size={15} />Save connection</button>
          ) : phase === "error" ? (
            <button className="primary-button" onClick={save}><Check size={15} />Save anyway</button>
          ) : (
            <button className="primary-button" onClick={probe} disabled={phase === "probing" || !url.trim()}>
              {phase === "probing"
                ? <><LoaderCircle size={15} className="spin" />Testing…</>
                : <><Link2 size={15} />Test & connect</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
