"use client";

import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Cloud,
  Filter,
  Gauge,
  LayoutTemplate,
  LoaderCircle,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  api,
  formatDuration,
  formatRelativeTime,
  parseApiDate,
  runWorkflowLabel,
  type ApiRun,
  type ApiTeamMember,
  type ApiWorkflow,
  type TeamRole,
} from "../../lib/api";
import { usesLiveControlPlane } from "../../lib/api-base";
import { templateCards } from "../../lib/demo-data";
import { dailyRunCounts, totalAutomationHours, workflowTimeSavedRanking } from "../../lib/workflow-stats";
import { ConnectModal } from "../components/ConnectModal";
import {
  loadConnections,
  migrateLegacyConnections,
  removeConnection as removeStoredConnection,
  testConnection,
  type SavedConnection,
} from "../../lib/connections";
import {
  BUSINESS_CONNECTORS,
  CONNECTOR_CATEGORIES,
  connectorModalDefaults,
  isConnectorConnected,
  type BusinessConnector,
  type ConnectorCategory,
} from "../../lib/connectors";
import { RunDetailsDrawer } from "../components/RunDetailsDrawer";
import { StatusPill } from "../components/StatusPill";

const titles: Record<string, [string, string, string]> = {
  templates: ["Template library", "Start with a proven process", "Explore ready-made workflows designed for common business operations."],
  runs: ["Execution history", "Runs", "Follow each workflow from its starting event to a completed outcome."],
  approvals: ["Human decisions", "Approval inbox", "Review sensitive actions and keep important decisions with the right person."],
  connections: ["Business tools", "Connections", "Choose which apps and MCP servers WorkPilot may use and exactly what each workflow can do."],
  team: ["Workspace access", "Team", "Manage people, roles, and decision responsibilities across your workspace."],
  analytics: ["Measured outcomes", "Analytics", "Understand adoption, reliability, estimated time saved, and operating cost."],
  settings: ["Workspace controls", "Settings", "Set defaults for safety, notifications, language, and local preferences."],
  help: ["Guidance", "Help centre", "Learn how to build safe, understandable workflows for your team."],
};

export function SectionPage({ section }: { section: string }) {
  const copy = titles[section] ?? titles.help;
  const [inviteOpen, setInviteOpen] = useState(false);
  return (
    <div className="page section-page">
      <section className="page-heading-row">
        <div>
          <p className="eyebrow">{copy[0]}</p>
          <h1>{copy[1]}</h1>
          <p className="page-subtitle">{copy[2]}</p>
        </div>
        {section === "templates" && (
          <Link href="/workflows/new" className="primary-button">
            <Plus size={18} />Create workflow
          </Link>
        )}
        {section === "team" && (
          <button className="primary-button" onClick={() => setInviteOpen(true)}>
            <Plus size={18} />Invite person
          </button>
        )}
      </section>
      {section === "templates" ? <Templates /> :
       section === "runs" ? <Runs /> :
       section === "approvals" ? <Approvals /> :
       section === "connections" ? <Connections /> :
       section === "team" ? <Team /> :
       section === "analytics" ? <Analytics /> :
       section === "settings" ? <Settings /> :
       <Help />}
      {inviteOpen && <InviteModal onClose={() => setInviteOpen(false)} />}
    </div>
  );
}

export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, [onDone]);
  return <div className="toast"><Check size={16} />{message}</div>;
}

function InviteModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<TeamRole>("operator");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (sent) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
          <div className="modal-body" style={{ alignItems: "center", textAlign: "center", padding: "2rem 1.5rem" }}>
            <span className="modal-icon" style={{ width: 48, height: 48 }}><Check size={24} /></span>
            <h2 style={{ margin: "0.75rem 0 0.25rem" }}>Invitation sent</h2>
            <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>{email} was added as {role.replace(/_/g, " ")}. Their invitation is now tracked in this workspace.</p>
            <button className="primary-button" style={{ marginTop: "1rem" }} onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-header">
          <div className="modal-title-wrap">
            <span className="modal-icon"><Users size={20} /></span>
            <div><h2>Invite a person</h2><p>Send an invitation to join your workspace</p></div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal-body">
          <label className="form-field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Casey Lane" />
          </label>
          <label className="form-field">
            <span>Email address</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
          </label>
          <label className="form-field">
            <span>Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value as TeamRole)} className="select-field">
              <option value="workflow_admin">Workflow Admin</option>
              <option value="workflow_builder">Workflow Builder</option>
              <option value="approver">Approver</option>
              <option value="operator">Operator</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          {error && <div className="modal-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="secondary-button" onClick={onClose}>Cancel</button>
          <button
            className="primary-button"
            onClick={async () => {
              setSending(true);
              setError(null);
              try {
                await api.team.invite({ email, name, role });
                window.dispatchEvent(new Event("workpilot:team-changed"));
                setSent(true);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not add this person");
              } finally {
                setSending(false);
              }
            }}
            disabled={!email.includes("@") || name.trim().length < 2 || sending}
          >
            {sending ? <LoaderCircle size={15} className="spin" /> : <Plus size={15} />}Send invite
          </button>
        </div>
      </div>
    </div>
  );
}

function Templates() {
  const [category, setCategory] = useState("All templates");
  const categories = ["All templates", ...Array.from(new Set(templateCards.map(([, cat]) => cat)))];
  const visible = templateCards
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => category === "All templates" || card[1] === category);

  return (
    <>
      <div className="category-chips">
        {categories.map((item) => (
          <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>
        ))}
      </div>
      <div className="template-catalog">
        {visible.map(({ card: [name, cat, summary], index }) => (
          <article key={name}>
            <span className={`template-art template-art-${index + 1}`}><LayoutTemplate size={24} /></span>
            <div>
              <small>{cat}</small>
              <h2>{name}</h2>
              <p>{summary}</p>
              <ul>
                <li><Check size={14} />Includes human review</li>
                <li><ShieldCheck size={14} />Safe test data included</li>
              </ul>
              <Link href="/workflows/new" className="secondary-button">
                Use template <ArrowRight size={16} />
              </Link>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function Runs() {
  const [runs, setRuns] = useState<ApiRun[]>([]);
  const [workflows, setWorkflows] = useState<ApiWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [openRun, setOpenRun] = useState<ApiRun | null>(null);

  useEffect(() => {
    Promise.all([
      api.runs.list().catch(() => [] as ApiRun[]),
      api.workflows.list().catch(() => [] as ApiWorkflow[]),
    ])
      .then(([r, w]) => {
        setRuns(r);
        setWorkflows(w);
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = runs.filter((r) =>
    (statusFilter === "all" || r.status === statusFilter) &&
    (runWorkflowLabel(r, workflows).toLowerCase().includes(query.toLowerCase()) ||
    r.workflow_id.toLowerCase().includes(query.toLowerCase()) ||
    r.id.toLowerCase().includes(query.toLowerCase()) ||
    r.trigger_type.toLowerCase().includes(query.toLowerCase()))
  );

  const completed = runs.filter((r) => r.status === "completed").length;
  const waiting = runs.filter((r) => r.status === "running" || r.status === "queued").length;
  const totalCost = runs.reduce((sum, r) => sum + r.total_cost, 0);
  const durations = runs.filter((r) => r.finished_at).map((r) => parseApiDate(r.finished_at!).getTime() - parseApiDate(r.started_at).getTime());
  const avgMs = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

  return (
    <>
      <section className="run-metrics">
        <div><span className="metric-icon tone-mint"><CheckCircle2 size={20} /></span><div><strong>{completed}</strong><small>completed</small></div></div>
        <div><span className="metric-icon tone-amber"><Clock3 size={20} /></span><div><strong>{waiting}</strong><small>in progress</small></div></div>
        <div><span className="metric-icon tone-blue"><Gauge size={20} /></span><div><strong>{avgMs > 0 ? `${(avgMs / 1000).toFixed(1)}s` : "—"}</strong><small>average duration</small></div></div>
        <div><span className="metric-icon tone-violet"><CircleDollarSign size={20} /></span><div><strong>${totalCost.toFixed(4)}</strong><small>total AI cost</small></div></div>
      </section>
      <section className="panel">
        <div className="list-toolbar embedded">
          <label className="table-search"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by workflow or run" /></label>
          <div className="filter-chips">
            <Filter size={16} />
            {(["all", "completed", "running", "queued", "failed"] as const).map((s) => (
              <button
                key={s}
                className={statusFilter === s ? "filter-chip active" : "filter-chip"}
                onClick={() => setStatusFilter(s)}
              >
                {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {loading ? (
          <div className="empty-state"><LoaderCircle size={24} className="spin" /><p>Loading runs…</p></div>
        ) : (
          <div className="table-wrap">
            <table className="data-table spacious">
              <thead><tr><th>Run</th><th>Workflow</th><th>Status</th><th>Started</th><th>Steps</th><th>Duration</th><th>AI cost</th><th /></tr></thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign: "center", padding: "2rem", color: "var(--muted)" }}>
                    No runs yet. Trigger a workflow to see results here.
                  </td></tr>
                )}
                {filtered.map((run) => (
                  <tr key={run.id} className="clickable-row" onClick={() => setOpenRun(run)}>
                    <td><strong>#{run.id.slice(-8)}</strong></td>
                    <td><Link href={`/workflows/${run.workflow_id}`} onClick={(e) => e.stopPropagation()}>{runWorkflowLabel(run, workflows)}</Link><small>{run.trigger_type}</small></td>
                    <td><StatusPill status={run.status} /></td>
                    <td>{formatRelativeTime(run.started_at)}</td>
                    <td>
                      <span className="step-progress"><i style={{ width: `${run.steps.length > 0 ? 100 : 0}%` }} /></span>
                      <small>{run.steps.length} steps</small>
                    </td>
                    <td>{formatDuration(run.started_at, run.finished_at)}</td>
                    <td>${run.total_cost.toFixed(4)}</td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label="View run details"
                        title="View run details"
                        onClick={(e) => { e.stopPropagation(); setOpenRun(run); }}
                      >
                        <MoreHorizontal size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {openRun && (
        <RunDetailsDrawer runId={openRun.id} fallback={openRun} onClose={() => setOpenRun(null)} />
      )}
    </>
  );
}

function Approvals() {
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [waitingRuns, setWaitingRuns] = useState<ApiRun[]>([]);
  const [workflows, setWorkflows] = useState<ApiWorkflow[]>([]);
  const liveMode = usesLiveControlPlane();

  useEffect(() => {
    Promise.all([
      api.runs.list().catch(() => [] as ApiRun[]),
      api.workflows.list().catch(() => [] as ApiWorkflow[]),
    ]).then(([runs, wfs]) => {
      setWaitingRuns(runs.filter((r) => r.status === "queued" || r.status === "running"));
      setWorkflows(wfs);
    });
  }, []);

  const staticApprovals = liveMode ? [] : [
    { id: "ap-1", workflow: "Client brief processor", title: "Approve the standardized brief", subject: "Northstar Foods · Spring launch", risk: "medium" as const, due: "Due in 3h", owner: "Maya Chen", summary: "WorkPilot found all required fields and prepared 12 delivery tasks. Review the dates and markets before tasks are created." },
    { id: "ap-2", workflow: "Invoice preparation", title: "Review invoice draft", subject: "Cascade Labs · INV-2026-071", risk: "high" as const, due: "Due today at 16:00", owner: "Noah Williams", summary: "The draft includes 164 approved hours and €820 in expenses. Two weekend entries are above the standard rate." },
    { id: "ap-3", workflow: "Meeting to action", title: "Confirm meeting actions", subject: "Quarterly account review", risk: "low" as const, due: "Due tomorrow", owner: "Alex Morgan", summary: "Seven actions were identified. Two have dates but no owner, so WorkPilot will not create them yet." },
  ];

  const liveApprovals = waitingRuns.map((run) => ({
    id: run.id,
    workflow: runWorkflowLabel(run, workflows),
    title: "Review run output",
    subject: `Run #${run.id.slice(-8)} · ${run.trigger_type}`,
    risk: "medium" as const,
    due: "Awaiting decision",
    owner: "You",
    summary: `This run has been waiting since ${formatRelativeTime(run.started_at)}. It has completed ${run.steps.length} steps and is paused for human review before continuing.`,
    isLive: true,
  }));

  const allApprovals = [...liveApprovals, ...staticApprovals];

  return (
    <div className="approval-layout">
      <div className="approval-list">
        <div className="approval-filter">
          <button className="active">Assigned to me <span>{allApprovals.length}</span></button>
          {liveMode ? (
            <button disabled>Team queue <span>0</span></button>
          ) : (
            <button>Team queue <span>5</span></button>
          )}
          <button>Decided</button>
        </div>
        {allApprovals.length === 0 ? (
          <div className="empty-state"><CheckCircle2 size={24} /><h3>No approvals waiting</h3><p>When a workflow pauses for review, it will appear here.</p></div>
        ) : allApprovals.map((approval) => (
          <article key={approval.id} className="approval-card">
            {decisions[approval.id] ? (
              <div className="decision-state">
                <span><Check size={20} /></span>
                <div><h2>{decisions[approval.id]}</h2><p>The decision was recorded in the audit history.</p></div>
              </div>
            ) : (
              <>
                <div className="approval-card-head">
                  <div>
                    <small>{approval.workflow}{(approval as { isLive?: boolean }).isLive && <span style={{ marginLeft: 8, color: "var(--accent)" }}>● Live</span>}</small>
                    <h2>{approval.title}</h2>
                    <p>{approval.subject}</p>
                  </div>
                  <span className={`risk-label risk-${approval.risk}`}>{approval.risk} risk</span>
                </div>
                <p className="approval-summary">{approval.summary}</p>
                <div className="approval-meta">
                  <span><Clock3 size={15} />{approval.due}</span>
                  <span><Users size={15} />Requested by {approval.owner}</span>
                </div>
                <div className="approval-actions">
                  <button className="primary-button" onClick={() => setDecisions((cur) => ({ ...cur, [approval.id]: "Approved" }))}><Check size={16} />Approve</button>
                  <button className="secondary-button" onClick={() => setDecisions((cur) => ({ ...cur, [approval.id]: "Changes requested" }))}>Request changes</button>
                  <button className="icon-button" onClick={() => setDecisions((cur) => ({ ...cur, [approval.id]: "Rejected" }))} aria-label="Reject"><X size={17} /></button>
                </div>
              </>
            )}
          </article>
        ))}
      </div>
      <aside className="approval-guide">
        <ShieldCheck size={23} />
        <h2>You stay in control</h2>
        <p>Approvals are recorded with the exact data, recommendation, and safeguards shown at decision time.</p>
        <ul>
          <li><Check size={14} />One decision is accepted once</li>
          <li><Check size={14} />Rejected work never continues</li>
          <li><Check size={14} />Every decision is traceable</li>
        </ul>
      </aside>
    </div>
  );
}

function Connections() {
  const [modal, setModal] = useState<{ type: "app" | "mcp"; name?: string; url?: string; connectorId?: string } | null>(null);
  const [saved, setSaved] = useState<SavedConnection[]>([]);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<ConnectorCategory | "all">("all");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoadError(null);
      setSaved(await loadConnections());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load connections.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Sweep up anything the old localStorage build left behind, then load.
    // Tokens are not migrated — they were stored in plaintext, so they must be
    // re-entered rather than trusted.
    migrateLegacyConnections().finally(refresh);
  }, [refresh]);

  const handleSave = (conn: SavedConnection) => {
    setSaved((cur) => [conn, ...cur.filter((c) => c.id !== conn.id)]);
  };

  const removeConnection = async (id: string) => {
    setBusyId(id);
    try {
      await removeStoredConnection(id);
      setSaved((cur) => cur.filter((c) => c.id !== id));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not remove that connection.");
    } finally {
      setBusyId(null);
    }
  };

  /** Re-handshake and refresh the cached tool catalog. */
  const retest = async (id: string) => {
    setBusyId(id);
    try {
      const updated = await testConnection(id);
      setSaved((cur) => cur.map((c) => (c.id === id ? updated : c)));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not test that connection.");
    } finally {
      setBusyId(null);
    }
  };

  const builtInMcp = [
    { name: "WorkPilot Demo MCP", url: "http://localhost:9000/mcp", description: "Local demo server — run apps/mcp-server/server.py to start", tools: ["get_weather", "summarise_text", "list_tasks"] },
    { name: "Filesystem MCP", url: "npx @modelcontextprotocol/server-filesystem", description: "Read & write local files within approved directories", tools: ["read_file", "write_file", "list_directory"] },
    { name: "Brave Search MCP", url: "npx @modelcontextprotocol/server-brave-search", description: "Live web search (requires Brave API key)", tools: ["brave_web_search"] },
  ];

  // One list: everything is server-side now, so an "app" and an "MCP server"
  // differ only by `kind` and both are managed identically.
  const savedConnections = saved;

  const filteredConnectors = BUSINESS_CONNECTORS.filter((connector) => {
    const matchesCategory = categoryFilter === "all" || connector.category === categoryFilter;
    const haystack = [
      connector.name,
      connector.category,
      connector.tagline,
      ...connector.capabilities,
    ].join(" ").toLowerCase();
    const matchesQuery = !query.trim() || haystack.includes(query.trim().toLowerCase());
    return matchesCategory && matchesQuery;
  });

  const openConnector = (connector: BusinessConnector) => {
    const defaults = connectorModalDefaults(connector);
    setModal(defaults);
  };

  const connectedCount = BUSINESS_CONNECTORS.filter((c) => isConnectorConnected(c.name, saved)).length;

  return (
    <>
      {modal && (
        <ConnectModal
          type={modal.type}
          defaultName={modal.name}
          defaultUrl={modal.url}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}

      <div className="connection-note">
        <ShieldCheck size={18} />
        <p>
          <strong>{BUSINESS_CONNECTORS.length} connectors ready.</strong> Credentials are
          encrypted server-side and only read at the moment a workflow step calls a
          tool. WorkPilot is in read-only mode, so workflows can fetch from these
          systems but never modify them.
        </p>
      </div>

      {loadError && (
        <div className="modal-error" style={{ marginBottom: "1rem" }}>
          <X size={14} /> {loadError}
          <button className="text-link" style={{ marginLeft: "auto" }} onClick={refresh}>Retry</button>
        </div>
      )}

      {loading && (
        <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "1rem" }}>
          Loading your connections…
        </p>
      )}

      {savedConnections.length > 0 && (
        <>
          <h2 style={{ margin: "0 0 0.75rem", fontSize: "1rem", fontWeight: 650 }}>
            Your connections ({savedConnections.length})
          </h2>
          <div className="connection-grid" style={{ marginBottom: "1.5rem" }}>
            {savedConnections.map((conn) => {
              const failed = conn.status !== "connected";
              const writeTools = conn.toolDetails.filter((t) => !t.read_only);
              return (
                <article key={conn.id} className={failed ? undefined : "connection-card-connected"}>
                  <span className="connection-icon connection-icon-brand">
                    {conn.type === "mcp" ? <Server size={23} /> : <Cloud size={23} />}
                  </span>
                  <div>
                    <h2>{conn.name}</h2>
                    <StatusPill status={failed ? "Error" : "Connected"} />
                    <p style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                      {conn.url}
                    </p>
                    {conn.hasToken && (
                      <p style={{ fontSize: "0.7rem", color: "var(--muted)", marginTop: "0.2rem" }}>
                        Token {conn.tokenHint} · encrypted at rest
                      </p>
                    )}
                    {failed && conn.lastError && (
                      <p style={{ fontSize: "0.72rem", color: "var(--danger)", marginTop: "0.35rem" }}>
                        {conn.lastError}
                      </p>
                    )}
                    {conn.toolDetails.length > 0 && (
                      <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
                        {conn.toolDetails.map((t) => (
                          <span key={t.name}
                            title={`${t.description}${t.read_only ? "" : " — write tool, blocked in read-only mode"}`}
                            style={{
                              fontSize: "0.7rem", padding: "0.125rem 0.5rem", borderRadius: "99px",
                              background: "var(--chip)", color: "var(--chip-ink)",
                              display: "inline-flex", alignItems: "center", gap: 3,
                              opacity: t.read_only ? 1 : 0.55,
                            }}>
                            <Zap size={10} />{t.name}
                          </span>
                        ))}
                      </div>
                    )}
                    {writeTools.length > 0 && (
                      <p style={{ fontSize: "0.68rem", color: "var(--muted)", marginTop: "0.35rem" }}>
                        {writeTools.length} write tool{writeTools.length === 1 ? "" : "s"} hidden from
                        workflows while WorkPilot is read-only.
                      </p>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                    <button className="secondary-button" disabled={busyId === conn.id}
                      onClick={() => retest(conn.id)}>
                      {busyId === conn.id ? "Testing…" : "Test"}
                    </button>
                    <button className="secondary-button" disabled={busyId === conn.id}
                      onClick={() => removeConnection(conn.id)}>Remove</button>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}

      <div className="list-toolbar embedded" style={{ marginBottom: "1rem" }}>
        <label className="table-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search connectors (Telegram, Outlook, Drive…)"
          />
        </label>
        <div className="filter-chips">
          <Filter size={16} />
          <button
            className={categoryFilter === "all" ? "filter-chip active" : "filter-chip"}
            onClick={() => setCategoryFilter("all")}
          >
            All ({BUSINESS_CONNECTORS.length})
          </button>
          {CONNECTOR_CATEGORIES.map((category) => {
            const count = BUSINESS_CONNECTORS.filter((c) => c.category === category).length;
            return (
              <button
                key={category}
                className={categoryFilter === category ? "filter-chip active" : "filter-chip"}
                onClick={() => setCategoryFilter(category)}
              >
                {category} ({count})
              </button>
            );
          })}
        </div>
      </div>

      <div className="connection-summary">
        <span><strong>{connectedCount}</strong> connected</span>
        <span><strong>{BUSINESS_CONNECTORS.length - connectedCount}</strong> ready to connect</span>
      </div>

      <h2 style={{ margin: "1.25rem 0 0.75rem", fontSize: "1rem", fontWeight: 650 }}>Business apps</h2>

      {(categoryFilter === "all"
        ? CONNECTOR_CATEGORIES
        : [categoryFilter]
      ).map((category) => {
        const items = filteredConnectors.filter((c) => c.category === category);
        if (items.length === 0) return null;
        return (
          <section key={category} className="connector-category-block">
            <h3 className="connector-category-title">{category}</h3>
            <div className="connection-grid">
              {items.map((connector) => {
                const connected = isConnectorConnected(connector.name, saved);
                return (
                  <article key={connector.id}>
                    <span className="connection-icon connection-icon-brand" aria-hidden>{connector.icon}</span>
                    <div>
                      <h2>{connector.name}</h2>
                      <StatusPill status={connected ? "Connected" : "Available"} />
                      <p>{connector.tagline}</p>
                      <div className="connector-capabilities">
                        {connector.capabilities.map((cap) => (
                          <span key={cap}>{cap}</span>
                        ))}
                      </div>
                    </div>
                    <button
                      className={connected ? "secondary-button" : "primary-button"}
                      onClick={() => openConnector(connector)}
                    >
                      {connected ? "Manage" : "Connect"}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}

      {filteredConnectors.length === 0 && (
        <div className="empty-state" style={{ padding: "2rem 0" }}>
          <Search size={22} />
          <p>No connectors match your search.</p>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "2rem 0 0.25rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 650 }}>MCP servers</h2>
        <button className="primary-button" style={{ fontSize: "0.82rem" }} onClick={() => setModal({ type: "mcp" })}>
          <Plus size={15} />Add MCP server
        </button>
      </div>
      <p style={{ color: "var(--muted)", fontSize: "0.875rem", marginBottom: "1rem" }}>
        Model Context Protocol servers expose tools your AI agents can call. Any HTTP MCP-compatible server can be added here.
      </p>


      <div className="connection-grid">
        {builtInMcp.map((srv) => (
          <article key={srv.name}>
            <span className="connection-icon"><Server size={23} /></span>
            <div>
              <h2>{srv.name}</h2>
              <StatusPill status="Available" />
              <p>{srv.description}</p>
              <p style={{ marginTop: "0.25rem", fontSize: "0.72rem", color: "var(--muted)", fontFamily: "monospace" }}>{srv.url}</p>
              <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
                {srv.tools.map((t) => (
                  <span key={t} style={{ fontSize: "0.7rem", padding: "0.125rem 0.5rem", background: "var(--canvas)", borderRadius: "99px", color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: 3 }}><Zap size={10} />{t}</span>
                ))}
              </div>
            </div>
            <button className="primary-button" onClick={() => setModal({ type: "mcp", name: srv.name, url: srv.url.startsWith("http") ? srv.url : "" })}>Connect</button>
          </article>
        ))}
      </div>
    </>
  );
}

function Team({ embedded = false }: { embedded?: boolean }) {
  const [people, setPeople] = useState<ApiTeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    api.team.list()
      .then(setPeople)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load team"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener("workpilot:team-changed", refresh);
    return () => window.removeEventListener("workpilot:team-changed", refresh);
  }, [refresh]);

  const update = async (person: ApiTeamMember, payload: { role?: TeamRole; status?: "active" | "invited" | "suspended" }) => {
    setBusy(person.id);
    setError(null);
    try {
      const saved = await api.team.update(person.id, payload);
      setPeople((current) => current.map((item) => item.id === saved.id ? saved : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update this person");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (person: ApiTeamMember) => {
    if (!window.confirm(`Remove ${person.name} from this workspace?`)) return;
    setBusy(person.id);
    setError(null);
    try {
      await api.team.remove(person.id);
      setPeople((current) => current.filter((item) => item.id !== person.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove this person");
    } finally {
      setBusy(null);
    }
  };

  const table = (
    <>
      {error && <div className="modal-error" style={{ margin: embedded ? "0 0 1rem" : "1rem" }}>{error}</div>}
      <div className="table-wrap">
        <table className="data-table spacious">
          <thead><tr><th>Person</th><th>Role</th><th>Status</th><th>Last active</th><th /></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={5}><LoaderCircle size={20} className="spin" /> Loading team…</td></tr> : people.length === 0 ? (
              <tr><td colSpan={5} className="empty-state compact">No people in this workspace yet.</td></tr>
            ) : people.map((person, index) => (
              <tr key={person.id}>
                <td>
                  <span className={`avatar ${index % 2 ? "mint" : "lavender"}`}>{person.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span>
                  <span className="person-cell"><strong>{person.name}</strong><small>{person.email}</small></span>
                </td>
                <td>
                  <select className="select-field" value={person.role} disabled={busy === person.id} onChange={(e) => update(person, { role: e.target.value as TeamRole })}>
                    <option value="workflow_admin">Workflow Admin</option><option value="workflow_builder">Workflow Builder</option><option value="approver">Approver</option><option value="operator">Operator</option><option value="viewer">Viewer</option>
                  </select>
                </td>
                <td><StatusPill status={person.status} /></td>
                <td>{person.status === "invited" ? "Not yet" : "Active member"}</td>
                <td>
                  <div style={{ display: "flex", gap: 6 }}>
                    {person.status === "suspended"
                      ? <button className="text-link" disabled={busy === person.id} onClick={() => update(person, { status: "active" })}>Restore</button>
                      : <button className="text-link" disabled={busy === person.id} onClick={() => update(person, { status: "suspended" })}>Suspend</button>}
                    <button className="danger-link" disabled={busy === person.id} onClick={() => remove(person)}>Remove</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );

  if (embedded) return table;

  return (
    <section className="panel">
      {table}
    </section>
  );
}

function Analytics() {
  const [runs, setRuns] = useState<ApiRun[]>([]);
  const [wfs, setWfs] = useState<ApiWorkflow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.runs.list().catch(() => [] as ApiRun[]),
      api.workflows.list().catch(() => [] as ApiWorkflow[]),
    ]).then(([r, w]) => {
      setRuns(r);
      setWfs(w);
    }).finally(() => setLoading(false));
  }, []);

  const completed = runs.filter((r) => r.status === "completed").length;
  const total = runs.length || 1;
  const successRate = ((completed / total) * 100).toFixed(1);
  const totalCost = runs.reduce((sum, r) => sum + r.total_cost, 0);
  const durations = runs.filter((r) => r.finished_at).map((r) => parseApiDate(r.finished_at!).getTime() - parseApiDate(r.started_at).getTime());
  const avgMin = durations.length ? (durations.reduce((a, b) => a + b, 0) / durations.length / 60000).toFixed(0) : "—";
  const timeSaved = totalAutomationHours(runs);
  const chartBars = dailyRunCounts(runs, 16);
  const topWorkflows = workflowTimeSavedRanking(runs, wfs).slice(0, 4);

  return (
    <>
      <section className="analytics-top">
        <article>
          <p>Automation runtime</p>
          <strong>{loading ? "…" : `${timeSaved.toFixed(1)} hrs`}</strong>
          <span>{wfs.length} workflow{wfs.length === 1 ? "" : "s"}</span>
        </article>
        <article>
          <p>Successful completion</p>
          <strong>{loading ? "…" : `${successRate}%`}</strong>
          <span>{completed} of {runs.length} runs</span>
        </article>
        <article>
          <p>Average run duration</p>
          <strong>{loading ? "…" : (avgMin !== "—" ? `${avgMin} min` : "—")}</strong>
          <span>{durations.length} timed runs</span>
        </article>
        <article>
          <p>Total AI cost</p>
          <strong>{loading ? "…" : `$${totalCost.toFixed(4)}`}</strong>
          <span>{runs.length > 0 ? `$${(totalCost / runs.length).toFixed(5)}/run` : "no runs yet"}</span>
        </article>
      </section>
      <section className="analytics-grid">
        <article className="panel">
          <div className="panel-heading">
            <div><p className="section-kicker">Last 30 days</p><h2>Completed runs</h2></div>
            <button className="secondary-button"><CalendarClock size={16} />30 days</button>
          </div>
          <div className="large-chart">
            <div className="chart-lines"><span /><span /><span /><span /></div>
            <div className="area-bars">
              {chartBars.map((height, index) => <i key={index} style={{ height: `${Math.max(height, runs.length > 0 ? 4 : 0)}%` }} />)}
            </div>
          </div>
        </article>
        <article className="panel value-panel">
          <p className="section-kicker">Top value</p>
          <h2>Automation runtime by workflow</h2>
          {topWorkflows.length > 0 ? topWorkflows.map((item) => (
            <div key={item.id}>
              <span><strong>{item.name}</strong><small>{item.hours.toFixed(1)} hrs runtime</small></span>
              <i><b style={{ width: `${Math.max(8, (item.hours / Math.max(topWorkflows[0]?.hours ?? 1, 0.1)) * 100)}%` }} /></i>
            </div>
          )) : (
            <p className="empty-state compact">Run a workflow to see activity here.</p>
          )}
        </article>
      </section>
      <p className="estimate-disclaimer">Runtime totals are measured from completed runs. They reflect automation time, not guaranteed manual time saved.</p>
    </>
  );
}

function Settings() {
  type SettingsTab = "general" | "safety" | "access" | "notifications";

  const tabCopy: Record<SettingsTab, [string, string]> = {
    general: ["Workspace settings", "Name, data region, and how long run history is kept."],
    safety: ["Safety policies", "Approval rules, write permissions, and AI cost limits for every run."],
    access: ["Roles & access", "Manage who can build workflows, approve actions, and operate runs."],
    notifications: ["Notifications", "Alerts when runs fail or when a reviewer decision is needed."],
  };

  const [tab, setTab] = useState<SettingsTab>("general");
  const [name, setName] = useState("");
  const [settings, setSettings] = useState({
    require_approval_for_writes: true,
    max_run_cost_usd: 1,
    data_region: "eu-central-1",
    notify_on_run_failure: true,
    notify_on_approval_needed: true,
    notify_email: "",
    retain_run_days: 90,
  });
  const [allowToolWrites, setAllowToolWrites] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState(false);

  useEffect(() => {
    Promise.all([api.workspace.get(), api.settings.get()])
      .then(([workspace, stored]) => {
        setName(workspace.name);
        setAllowToolWrites(stored.allow_tool_writes);
        setSettings({
          require_approval_for_writes: stored.require_approval_for_writes,
          max_run_cost_usd: stored.max_run_cost_usd,
          data_region: stored.data_region,
          notify_on_run_failure: stored.notify_on_run_failure,
          notify_on_approval_needed: stored.notify_on_approval_needed,
          notify_email: stored.notify_email,
          retain_run_days: stored.retain_run_days,
        });
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load settings"))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (tab === "general") {
        await Promise.all([api.workspace.rename(name.trim()), api.settings.save(settings)]);
      } else {
        await api.settings.save(settings);
      }
      window.dispatchEvent(new Event("workpilot:workspace-changed"));
      setSavedToast(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="empty-state"><LoaderCircle size={24} className="spin" /><p>Loading settings…</p></div>;

  const [heading, subtitle] = tabCopy[tab];
  const showSave = tab !== "access";

  return (
    <div className="settings-layout">
      {savedToast && <Toast message="Settings saved" onDone={() => setSavedToast(false)} />}
      <aside className="settings-nav">
        <button type="button" className={tab === "general" ? "active" : ""} onClick={() => setTab("general")}><Settings2 size={16} />General</button>
        <button type="button" className={tab === "safety" ? "active" : ""} onClick={() => setTab("safety")}><ShieldCheck size={16} />Safety policies</button>
        <button type="button" className={tab === "access" ? "active" : ""} onClick={() => setTab("access")}><Users size={16} />Roles & access</button>
        <button type="button" className={tab === "notifications" ? "active" : ""} onClick={() => setTab("notifications")}><MessageSquare size={16} />Notifications</button>
      </aside>
      <section className="panel settings-panel">
        <header className="settings-section-head">
          <h2>{heading}</h2>
          <p>{subtitle}</p>
        </header>

        {tab === "general" && (
          <div className="settings-section">
            <label className="form-field"><span>Workspace name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Northstar Projects" /></label>
            <label className="form-field"><span>Data region</span><select className="select-field" value={settings.data_region} onChange={(e) => setSettings((current) => ({ ...current, data_region: e.target.value }))}><option value="eu-central-1">Europe (Frankfurt)</option><option value="eu-west-1">Europe (Ireland)</option><option value="us-east-1">United States (Virginia)</option></select></label>
            <label className="form-field"><span>Retain run history (days)</span><input type="number" min={1} max={3650} value={settings.retain_run_days} onChange={(e) => setSettings((current) => ({ ...current, retain_run_days: Number(e.target.value) }))} /></label>
          </div>
        )}

        {tab === "safety" && (
          <div className="settings-section">
            <Toggle label="Require approval for external writes" description="A person must approve before a workflow can modify a connected system." checked={settings.require_approval_for_writes} onChange={(value) => setSettings((current) => ({ ...current, require_approval_for_writes: value }))} />
            <Toggle label="External writes enabled by deployment" description={allowToolWrites ? "The deployment permits approved write actions." : "This deployment is read-only. Workspace settings cannot override that boundary."} checked={allowToolWrites} onChange={() => {}} disabled />
            <label className="form-field"><span>Maximum AI cost per run (USD)</span><input type="number" min={0} max={1000} step={0.05} value={settings.max_run_cost_usd} onChange={(e) => setSettings((current) => ({ ...current, max_run_cost_usd: Number(e.target.value) }))} /></label>
          </div>
        )}

        {tab === "access" && (
          <div className="settings-section settings-access">
            <Team embedded />
          </div>
        )}

        {tab === "notifications" && (
          <div className="settings-section">
            <Toggle label="Notify on run failure" description="Create an alert when a workflow cannot complete." checked={settings.notify_on_run_failure} onChange={(value) => setSettings((current) => ({ ...current, notify_on_run_failure: value }))} />
            <Toggle label="Notify when approval is needed" description="Alert reviewers when a run is waiting for a decision." checked={settings.notify_on_approval_needed} onChange={(value) => setSettings((current) => ({ ...current, notify_on_approval_needed: value }))} />
            <label className="form-field"><span>Notification email</span><input type="email" value={settings.notify_email} onChange={(e) => setSettings((current) => ({ ...current, notify_email: e.target.value }))} placeholder="ops@example.com" /></label>
          </div>
        )}

        {error && <div className="modal-error">{error}</div>}
        {showSave && (
          <button className="primary-button" disabled={saving || (tab === "general" && name.trim().length < 2)} onClick={save}>
            {saving ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}Save settings
          </button>
        )}
      </section>
    </div>
  );
}

function Toggle({ label, description, checked, onChange, disabled = false }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <button className="toggle-row" onClick={() => onChange(!checked)} disabled={disabled}>
      <span><strong>{label}</strong><small>{description}</small></span>
      <i className={checked ? "toggle active" : "toggle"}><b /></i>
    </button>
  );
}

function Help() {
  return (
    <div className="help-grid">
      {[
        ["Build your first workflow", "Learn how to describe a process and review each step."],
        ["Test without changing tools", "See how safe test mode uses sample data and blocks real writes."],
        ["Design a good approval", "Choose the right reviewer, deadline, evidence, and escalation path."],
        ["Understand a run", "Follow step outputs, timing, cost, errors, and the audit history."],
      ].map(([title, body], index) => (
        <article className="panel" key={title}>
          <span>{index + 1}</span>
          <h2>{title}</h2>
          <p>{body}</p>
          <button className="text-link">Read guide <ArrowRight size={15} /></button>
        </article>
      ))}
    </div>
  );
}
