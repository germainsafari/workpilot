"use client";

import { Check, ExternalLink, Key, Link2, LoaderCircle, Server, X, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  createConnection,
  isRestVendor,
  normalizeMcpEndpoint,
  type SavedConnection,
} from "../../lib/connections";
import { resolveKnownService } from "../../lib/connectors";

export type { SavedConnection };

interface Props {
  type: "app" | "mcp";
  defaultName?: string;
  defaultUrl?: string;
  connectorId?: string;
  onClose: () => void;
  onSave: (conn: SavedConnection) => void;
}

type Phase = "form" | "saving" | "success" | "error";

/**
 * Connect a third-party system.
 *
 * The handshake happens on the server, not here. The previous version probed
 * from the browser and — when CORS blocked it — fell back to an opaque `no-cors`
 * GET and reported **success**, so "Server reachable" could appear when tool
 * discovery had entirely failed. It also wrote the API token to localStorage in
 * plaintext. Now `POST /v1/connections` performs `initialize` + `tools/list`
 * server-side, encrypts the token, and returns the true status.
 */
export function ConnectModal({
  type,
  defaultName = "",
  defaultUrl = "",
  connectorId,
  onClose,
  onSave,
}: Props) {
  const [name, setName] = useState(defaultName);
  const [url, setUrl] = useState(defaultUrl);
  const [token, setToken] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [errMsg, setErrMsg] = useState("");
  const [result, setResult] = useState<SavedConnection | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  const service = resolveKnownService(url, name);

  useEffect(() => { urlRef.current?.focus(); }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const submit = async () => {
    const trimmed = url.trim();
    if (!trimmed) { setErrMsg("URL is required"); setPhase("error"); return; }

    const endpoint = normalizeMcpEndpoint(trimmed, service?.hostname);
    if (endpoint !== trimmed) setUrl(endpoint);

    setPhase("saving");
    setErrMsg("");

    // Known REST vendors (Scoro) always go over REST, even when the user picked
    // "MCP server" — their MCP endpoint needs a JWT an API key cannot satisfy.
    const rest = isRestVendor(service?.hostname);
    const kind: "mcp" | "api_key" = rest
      ? "api_key"
      : type === "mcp" || endpoint.toLowerCase().endsWith("/mcp")
        ? "mcp"
        : "api_key";

    // connector_id selects the server-side REST connector, so it must be the
    // stable slug ("scoro"), not a display label.
    const resolvedConnectorId =
      connectorId ??
      (service?.hostname ? service.hostname.replace(/\.com$/, "") : undefined) ??
      "custom";

    try {
      const conn = await createConnection({
        name: name.trim() || endpoint,
        connector_id: resolvedConnectorId,
        kind,
        base_url: endpoint,
        token: token || undefined,
      });
      setResult(conn);
      onSave(conn);

      if (conn.status === "connected") {
        setPhase("success");
      } else {
        setPhase("error");
        setErrMsg(
          conn.lastError ??
            "Saved, but the server could not be reached. Check the URL and token, then press Test again.",
        );
      }
    } catch (err) {
      setPhase("error");
      setErrMsg(err instanceof Error ? err.message : "Could not save this connection.");
    }
  };

  const discovered = result?.toolDetails ?? [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-header">
          <div className="modal-title-wrap">
            <span className="modal-icon">{type === "mcp" ? <Server size={20} /> : <Link2 size={20} />}</span>
            <div>
              <h2>{type === "mcp" ? "Connect MCP server" : "Connect app"}</h2>
              <p>{type === "mcp"
                ? "Add any Model Context Protocol server — your workflows can then call its tools"
                : "Add a business app for your workflows to read from"}</p>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="modal-body">
          <label className="form-field">
            <span>Display name</span>
            <input value={name} onChange={(e) => setName(e.target.value)}
              disabled={phase === "saving" || phase === "success"}
              placeholder={type === "mcp" ? "e.g. Scoro MCP" : "e.g. Company Drive"} />
          </label>

          <label className="form-field">
            <span>{type === "mcp" ? "MCP server URL" : service ? `${service.label} site address` : "API endpoint"}</span>
            <input ref={urlRef} value={url} onChange={(e) => setUrl(e.target.value)}
              type="url"
              placeholder={type === "mcp" ? "https://yourapp.scoro.com/mcp" : service ? service.urlPlaceholder : "https://api.example.com"}
              disabled={phase === "saving" || phase === "success"} />
          </label>

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
              {" "}<em style={{ color: "var(--muted)", fontStyle: "normal" }}>(leave empty for public servers)</em>
            </span>
            <input value={token} onChange={(e) => setToken(e.target.value)}
              type="password"
              placeholder={service ? `Paste your ${service.label} API token` : "sk-… or leave empty"}
              disabled={phase === "saving" || phase === "success"} />
            <small style={{ color: "var(--muted)", marginTop: 4, display: "block" }}>
              Encrypted before it is stored. It is never sent back to the browser.
            </small>
          </label>

          {phase === "error" && (
            <div className="modal-error">
              <X size={14} /> {errMsg}
              <button className="text-link" style={{ marginLeft: "auto" }}
                onClick={() => { setPhase("form"); setErrMsg(""); }}>Try again</button>
            </div>
          )}

          {phase === "success" && (
            <div className="modal-success">
              <Check size={14} />
              {discovered.length > 0
                ? `Connected — ${discovered.length} tool${discovered.length === 1 ? "" : "s"} discovered`
                : "Connected, but this server advertises no tools"}
              {discovered.length > 0 && (
                <div className="modal-tools">
                  {discovered.slice(0, 12).map((t) => (
                    <span key={t.name} title={`${t.description}${t.read_only ? "" : " (write — blocked in read-only mode)"}`}>
                      <Zap size={10} />{t.name}{t.read_only ? "" : " ⚠"}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="secondary-button" onClick={onClose}>
            {phase === "success" ? "Done" : "Cancel"}
          </button>
          {phase !== "success" && (
            <button className="primary-button" onClick={submit}
              disabled={phase === "saving" || !url.trim()}>
              {phase === "saving"
                ? <><LoaderCircle size={15} className="spin" />Connecting…</>
                : <><Link2 size={15} />Test &amp; connect</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
