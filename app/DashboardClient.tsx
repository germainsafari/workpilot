"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock3, Coins, FileWarning, LoaderCircle, Play, Plus, Sparkles, TimerReset, TrendingUp, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { api, formatDuration, formatRelativeTime, type ApiRun, type ApiWorkflow } from "../lib/api";
import { workflows as demoWorkflows } from "../lib/demo-data";
import { StatusPill } from "./components/StatusPill";

export function DashboardClient() {
  const [runs, setRuns] = useState<ApiRun[]>([]);
  const [workflows, setWorkflows] = useState<ApiWorkflow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.runs.list().catch(() => [] as ApiRun[]),
      api.workflows.list().catch(() => [] as ApiWorkflow[]),
    ]).then(([r, w]) => {
      setRuns(r);
      setWorkflows(w);
    }).finally(() => setLoading(false));
  }, []);

  const activeCount = workflows.filter((w) => w.status === "active").length || demoWorkflows.filter((w) => w.status === "active").length;
  const completedToday = runs.filter((r) => r.status === "completed").length;
  const waitingCount = runs.filter((r) => r.status === "queued" || r.status === "running").length;
  const completionRate = runs.length > 0
    ? ((runs.filter((r) => r.status === "completed").length / runs.length) * 100).toFixed(1)
    : "97.8";
  const totalCost = runs.reduce((sum, r) => sum + r.total_cost, 0);

  const metrics = [
    { label: "Active workflows", value: String(activeCount), delta: `${workflows.length} total`, Icon: TrendingUp, tone: "mint" },
    { label: "Runs today", value: String(runs.length || completedToday), delta: `${completedToday} completed`, Icon: Play, tone: "blue" },
    { label: "In progress", value: String(waitingCount), delta: waitingCount > 0 ? "Currently running" : "All completed", Icon: Clock3, tone: "amber" },
    { label: "Completion rate", value: `${completionRate}%`, delta: `${runs.length} total runs`, Icon: CheckCircle2, tone: "violet" },
  ];

  const recentRuns = runs.slice(0, 4);
  const activeWorkflows = workflows.filter((w) => w.status === "active").slice(0, 3);

  const now = new Date();
  const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 18 ? "Good afternoon" : "Good evening";
  const dateStr = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="page dashboard-page">
      <section className="welcome-row">
        <div>
          <p className="eyebrow">{dateStr}</p>
          <h1>{greeting}.</h1>
          <p className="page-subtitle">Here&apos;s what your team&apos;s processes are doing today.</p>
        </div>
        <Link href="/workflows/new" className="primary-button"><Plus size={18} />Create workflow</Link>
      </section>

      <section className="metrics-grid" aria-label="Today's summary">
        {metrics.map(({ label, value, delta, Icon, tone }) => (
          <article className="metric-card" key={label}>
            <div className={`metric-icon tone-${tone}`}><Icon size={20} /></div>
            <span className="metric-label">{label}</span>
            <strong className="metric-value">{loading ? <LoaderCircle size={20} className="spin" /> : value}</strong>
            <small className={label === "In progress" && waitingCount > 0 ? "warning-text" : "positive-text"}>{delta}</small>
          </article>
        ))}
      </section>

      <section className="dashboard-grid">
        <article className="panel performance-panel">
          <div className="panel-heading">
            <div><span className="section-kicker">All time</span><h2>Operations at a glance</h2></div>
            <Link href="/analytics" className="text-link">View analytics <ArrowRight size={15} /></Link>
          </div>
          <div className="impact-row">
            <div><TimerReset size={18} /><span><strong>{demoWorkflows.reduce((s, w) => s + w.timeSavedHours, 0).toFixed(1)} hrs</strong><small>estimated time saved</small></span></div>
            <div><Coins size={18} /><span><strong>${totalCost.toFixed(4)}</strong><small>AI cost this session</small></span></div>
            <div><Users size={18} /><span><strong>{workflows.length || demoWorkflows.length}</strong><small>workflows total</small></span></div>
          </div>
          <div className="chart-wrap" aria-label="Workflow runs">
            <div className="chart-y-labels"><span>30</span><span>20</span><span>10</span><span>0</span></div>
            <div className="bar-chart">
              {[42, 58, 48, 74, 62, 84, 55, 70, 88, 66, 92, 78, 96, runs.length > 0 ? Math.min(runs.length * 10, 100) : 86].map((height, index) => (
                <span key={index} style={{ height: `${height}%` }} className={index === 13 ? "chart-bar active" : "chart-bar"} />
              ))}
            </div>
          </div>
          <div className="chart-caption"><span>14 days ago</span><span>10 days ago</span><span>5 days ago</span><span>Today</span></div>
        </article>

        <article className="panel attention-panel">
          <div className="panel-heading"><div><span className="section-kicker">Needs attention</span><h2>Exceptions</h2></div></div>
          {runs.filter((r) => r.status === "failed").length > 0 ? (
            runs.filter((r) => r.status === "failed").slice(0, 2).map((r) => (
              <div className="exception-card" key={r.id}>
                <div className="exception-icon"><FileWarning size={20} /></div>
                <div><strong>Run failed</strong><p>{r.error_summary ?? "An error occurred during execution."}</p><span>{r.workflow_id} · {formatRelativeTime(r.started_at)}</span></div>
              </div>
            ))
          ) : (
            <div className="exception-card low">
              <div className="exception-icon"><CheckCircle2 size={20} /></div>
              <div><strong>All clear</strong><p>No failed runs or pending exceptions.</p></div>
            </div>
          )}
          <Link className="secondary-button full-button" href="/approvals">Open approval inbox <ArrowRight size={16} /></Link>
        </article>
      </section>

      <section className="dashboard-grid lower-grid">
        <article className="panel">
          <div className="panel-heading">
            <div><span className="section-kicker">Live activity</span><h2>Recent runs</h2></div>
            <Link href="/runs" className="text-link">See all runs <ArrowRight size={15} /></Link>
          </div>
          {loading ? (
            <div className="empty-state"><LoaderCircle size={20} className="spin" /><p>Loading…</p></div>
          ) : recentRuns.length > 0 ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Workflow</th><th>Status</th><th>Started</th><th>Duration</th><th>AI cost</th></tr></thead>
                <tbody>{recentRuns.map((run) => (
                  <tr key={run.id}>
                    <td><Link href={`/workflows/${run.workflow_id}`}>{run.workflow_id}</Link><small>{run.trigger_type}</small></td>
                    <td><StatusPill status={run.status} /></td>
                    <td>{formatRelativeTime(run.started_at)}</td>
                    <td>{formatDuration(run.started_at, run.finished_at)}</td>
                    <td>${run.total_cost.toFixed(4)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state"><Play size={22} /><p>No runs yet. Open a workflow and click &quot;Test safely&quot; to start.</p></div>
          )}
        </article>

        <article className="panel activity-panel">
          <div className="panel-heading"><div><span className="section-kicker">Your workspace</span><h2>Active workflows</h2></div></div>
          <div className="workflow-mini-grid">
            {(activeWorkflows.length > 0 ? activeWorkflows : demoWorkflows.filter((w) => w.status === "active")).map((w) => (
              <Link href={`/workflows/${w.id}`} className="workflow-mini-card" key={w.id}>
                <span className="mini-icon"><Sparkles size={18} /></span>
                <span><strong>{w.name}</strong><small>{w.department}</small></span>
                <ArrowRight size={16} />
              </Link>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
