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
  FileText,
  Filter,
  FolderOpen,
  Gauge,
  LayoutTemplate,
  LoaderCircle,
  Mail,
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
import { useEffect, useState } from "react";
import { api, formatDuration, formatRelativeTime, type ApiRun, type ApiWorkflow } from "../../lib/api";
import { templateCards, workflows } from "../../lib/demo-data";
import { ConnectModal, type SavedConnection } from "../components/ConnectModal";
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
  const [role, setRole] = useState("Operator");
  const [sent, setSent] = useState(false);

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
            <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>{email} was invited as {role}. They&apos;ll get an email to join Northstar Projects.</p>
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
            <span>Email address</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
          </label>
          <label className="form-field">
            <span>Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value)} className="select-field">
              {["Workflow Admin", "Approver", "Workflow Builder", "Operator"].map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
        </div>
        <div className="modal-footer">
          <button className="secondary-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" onClick={() => setSent(true)} disabled={!email.includes("@")}>
            <Plus size={15} />Send invite
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
              <Link href={`/workflows/${workflows[index]?.id ?? "wf-client-brief"}`} className="secondary-button">
                Preview template <ArrowRight size={16} />
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
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [openRun, setOpenRun] = useState<ApiRun | null>(null);

  useEffect(() => {
    api.runs.list().then(setRuns).catch(() => setRuns([])).finally(() => setLoading(false));
  }, []);

  const filtered = runs.filter((r) =>
    (statusFilter === "all" || r.status === statusFilter) &&
    (r.workflow_id.toLowerCase().includes(query.toLowerCase()) ||
    r.id.toLowerCase().includes(query.toLowerCase()) ||
    r.trigger_type.toLowerCase().includes(query.toLowerCase()))
  );

  const completed = runs.filter((r) => r.status === "completed").length;
  const waiting = runs.filter((r) => r.status === "running" || r.status === "queued").length;
  const totalCost = runs.reduce((sum, r) => sum + r.total_cost, 0);
  const durations = runs.filter((r) => r.finished_at).map((r) => new Date(r.finished_at!).getTime() - new Date(r.started_at).getTime());
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
                    <td><Link href={`/workflows/${run.workflow_id}`} onClick={(e) => e.stopPropagation()}>{run.workflow_id}</Link><small>{run.trigger_type}</small></td>
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

  useEffect(() => {
    api.runs.list()
      .then((runs) => setWaitingRuns(runs.filter((r) => r.status === "queued" || r.status === "running")))
      .catch(() => {});
  }, []);

  const staticApprovals = [
    { id: "ap-1", workflow: "Client brief processor", title: "Approve the standardized brief", subject: "Northstar Foods · Spring launch", risk: "medium", due: "Due in 3h", owner: "Maya Chen", summary: "WorkPilot found all required fields and prepared 12 delivery tasks. Review the dates and markets before tasks are created." },
    { id: "ap-2", workflow: "Invoice preparation", title: "Review invoice draft", subject: "Cascade Labs · INV-2026-071", risk: "high", due: "Due today at 16:00", owner: "Noah Williams", summary: "The draft includes 164 approved hours and €820 in expenses. Two weekend entries are above the standard rate." },
    { id: "ap-3", workflow: "Meeting to action", title: "Confirm meeting actions", subject: "Quarterly account review", risk: "low", due: "Due tomorrow", owner: "Alex Morgan", summary: "Seven actions were identified. Two have dates but no owner, so WorkPilot will not create them yet." },
  ];

  const liveApprovals = waitingRuns.map((run) => ({
    id: run.id,
    workflow: run.workflow_id,
    title: `Review run output`,
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
          <button>Team queue <span>5</span></button>
          <button>Decided</button>
        </div>
        {allApprovals.map((approval) => (
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
  const [modal, setModal] = useState<{ type: "app" | "mcp"; name?: string; url?: string } | null>(null);
  const [saved, setSaved] = useState<SavedConnection[]>([]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("wp-connections") ?? "[]") as SavedConnection[];
      setSaved(stored);
    } catch { /* ignore */ }
  }, []);

  const handleSave = (conn: SavedConnection) => setSaved((cur) => [...cur, conn]);

  const removeConnection = (id: string) => {
    const updated = saved.filter((c) => c.id !== id);
    setSaved(updated);
    localStorage.setItem("wp-connections", JSON.stringify(updated));
  };

  const staticApps = [
    { name: "Google Drive", status: "Connected", Icon: FolderOpen, scope: "Read approved brief folders" },
    { name: "Gmail", status: "Connected", Icon: Mail, scope: "Read incoming briefs; sending disabled" },
    { name: "Slack", status: "Needs attention", Icon: MessageSquare, scope: "Re-authorize by 30 July" },
    { name: "Microsoft Teams", status: "Available", Icon: MessageSquare, scope: "Not connected" },
    { name: "Notion", status: "Available", Icon: FileText, scope: "Not connected" },
    { name: "Scoro", status: "Available", Icon: Cloud, scope: "Not connected" },
  ];

  const builtInMcp = [
    { name: "WorkPilot Demo MCP", url: "http://localhost:9000/mcp", description: "Local demo server — run apps/mcp-server/server.py to start", tools: ["get_weather", "summarise_text", "list_tasks"] },
    { name: "Filesystem MCP", url: "npx @modelcontextprotocol/server-filesystem", description: "Read & write local files within approved directories", tools: ["read_file", "write_file", "list_directory"] },
    { name: "Brave Search MCP", url: "npx @modelcontextprotocol/server-brave-search", description: "Live web search (requires Brave API key)", tools: ["brave_web_search"] },
  ];

  const savedMcp = saved.filter((c) => c.type === "mcp");

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
        <p><strong>Connections are permission-scoped.</strong> Each workflow receives only the operations it needs. Credentials are never shown to workflow steps.</p>
      </div>

      <h2 style={{ margin: "1.5rem 0 0.75rem", fontSize: "1rem", fontWeight: 650 }}>Business apps</h2>
      <div className="connection-grid">
        {staticApps.map(({ name, status, Icon, scope }) => (
          <article key={name}>
            <span className="connection-icon"><Icon size={23} /></span>
            <div>
              <h2>{name}</h2>
              <StatusPill status={status} />
              <p>{scope}</p>
            </div>
            <button
              className={status === "Connected" ? "secondary-button" : "primary-button"}
              onClick={() => setModal({ type: "app", name, url: "" })}
            >
              {status === "Connected" ? "Manage" : status === "Needs attention" ? "Fix connection" : "Connect"}
            </button>
          </article>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "2rem 0 0.25rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 650 }}>MCP servers</h2>
        <button className="primary-button" style={{ fontSize: "0.82rem" }} onClick={() => setModal({ type: "mcp" })}>
          <Plus size={15} />Add MCP server
        </button>
      </div>
      <p style={{ color: "var(--muted)", fontSize: "0.875rem", marginBottom: "1rem" }}>
        Model Context Protocol servers expose tools your AI agents can call. Any HTTP MCP-compatible server can be added here.
      </p>

      {savedMcp.length > 0 && (
        <div className="connection-grid" style={{ marginBottom: "1rem" }}>
          {savedMcp.map((conn) => (
            <article key={conn.id} style={{ borderColor: "var(--lime-dark)", background: "var(--mint)" }}>
              <span className="connection-icon" style={{ background: "#d0f5de" }}><Server size={23} /></span>
              <div>
                <h2>{conn.name}</h2>
                <StatusPill status="Connected" />
                <p style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "var(--muted)", marginTop: "0.25rem" }}>{conn.url}</p>
                {conn.tools && (
                  <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
                    {conn.tools.map((t) => (
                      <span key={t} style={{ fontSize: "0.7rem", padding: "0.125rem 0.5rem", background: "#c0f0cc", borderRadius: "99px", display: "inline-flex", alignItems: "center", gap: 3 }}><Zap size={10} />{t}</span>
                    ))}
                  </div>
                )}
              </div>
              <button className="secondary-button" onClick={() => removeConnection(conn.id)}>Remove</button>
            </article>
          ))}
        </div>
      )}

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

function Team() {
  const people = [
    ["AM", "Alex Morgan", "alex@northstar.example", "Workflow Admin", "Active"],
    ["MC", "Maya Chen", "maya@northstar.example", "Approver", "Active"],
    ["PS", "Priya Shah", "priya@northstar.example", "Workflow Builder", "Active"],
    ["ER", "Elena Rossi", "elena@northstar.example", "Operator", "Invited"],
  ];
  return (
    <section className="panel">
      <div className="table-wrap">
        <table className="data-table spacious">
          <thead><tr><th>Person</th><th>Role</th><th>Status</th><th>Last active</th><th /></tr></thead>
          <tbody>
            {people.map((person, index) => (
              <tr key={person[2]}>
                <td>
                  <span className={`avatar ${index % 2 ? "mint" : "lavender"}`}>{person[0]}</span>
                  <span className="person-cell"><strong>{person[1]}</strong><small>{person[2]}</small></span>
                </td>
                <td>{person[3]}</td>
                <td><StatusPill status={person[4]} /></td>
                <td>{index === 3 ? "Not yet" : `${index * 12 + 4} min ago`}</td>
                <td><button className="icon-button"><MoreHorizontal size={17} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
  const durations = runs.filter((r) => r.finished_at).map((r) => new Date(r.finished_at!).getTime() - new Date(r.started_at).getTime());
  const avgMin = durations.length ? (durations.reduce((a, b) => a + b, 0) / durations.length / 60000).toFixed(0) : "—";
  const timeSaved = wfs.length > 0 ? wfs.length * 12.8 : 64.4;

  const chartBars = runs.length > 0
    ? Array.from({ length: 16 }, (_, i) => Math.min(100, 30 + i * 4 + Math.floor(runs.length * 2)))
    : [38, 52, 48, 63, 58, 73, 67, 78, 71, 86, 82, 92, 88, 96, 91, 98];

  return (
    <>
      <section className="analytics-top">
        <article>
          <p>Estimated time saved</p>
          <strong>{loading ? "…" : `${timeSaved.toFixed(1)} hrs`}</strong>
          <span>{wfs.length > 0 ? `${wfs.length} workflows active` : "based on baselines"}</span>
        </article>
        <article>
          <p>Successful completion</p>
          <strong>{loading ? "…" : `${runs.length > 0 ? successRate : "97.8"}%`}</strong>
          <span>{completed} of {runs.length || "—"} runs</span>
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
              {chartBars.map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}
            </div>
          </div>
        </article>
        <article className="panel value-panel">
          <p className="section-kicker">Top value</p>
          <h2>Time saved by workflow</h2>
          {(wfs.length > 0 ? wfs.slice(0, 4).map((w) => ({ name: w.name, hours: 12.8 })) : workflows.slice(0, 4).map((w) => ({ name: w.name, hours: w.timeSavedHours }))).map((item) => (
            <div key={item.name}>
              <span><strong>{item.name}</strong><small>{item.hours.toFixed(1)} estimated hrs</small></span>
              <i><b style={{ width: `${Math.max(8, item.hours / 24.2 * 100)}%` }} /></i>
            </div>
          ))}
        </article>
      </section>
      <p className="estimate-disclaimer">Time-saved figures are estimates based on team-provided manual baselines. They are labelled and never treated as guaranteed savings.</p>
    </>
  );
}

function Settings() {
  const [safe, setSafe] = useState(true);
  const [notify, setNotify] = useState(true);
  const [name, setName] = useState("Northstar Projects");
  const [savedToast, setSavedToast] = useState(false);
  return (
    <div className="settings-layout">
      {savedToast && <Toast message="Settings saved" onDone={() => setSavedToast(false)} />}
      <aside className="settings-nav">
        <button className="active"><Settings2 size={16} />General</button>
        <button><ShieldCheck size={16} />Safety policies</button>
        <button><Users size={16} />Roles & access</button>
        <button><MessageSquare size={16} />Notifications</button>
      </aside>
      <section className="panel settings-panel">
        <div><h2>Workspace settings</h2><p>These defaults apply to {name}.</p></div>
        <label className="form-field"><span>Workspace name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="form-field"><span>Default time zone</span><button className="select-field">Europe/Warsaw</button></label>
        <hr />
        <h3>Safety defaults</h3>
        <Toggle label="Use safe test mode first" description="New workflows simulate external writes until someone explicitly enables them." checked={safe} onChange={setSafe} />
        <Toggle label="Notify owners about exceptions" description="Send an in-product notification when a run pauses or fails." checked={notify} onChange={setNotify} />
        <button className="primary-button" onClick={() => setSavedToast(true)}>Save settings</button>
      </section>
    </div>
  );
}

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button className="toggle-row" onClick={() => onChange(!checked)}>
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
