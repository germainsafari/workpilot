"use client";

import Link from "next/link";
import { ArrowRight, Filter, LoaderCircle, MoreHorizontal, Plus, Search, ShieldCheck, TimerReset, Workflow as WorkflowIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type ApiRun, type ApiWorkflow } from "../../lib/api";
import type { WorkflowSummary } from "../../lib/types";
import { apiWorkflowToSummary } from "../../lib/workflow-mapper";
import { enrichWorkflowSummaries } from "../../lib/workflow-stats";
import { StatusPill } from "../components/StatusPill";

export function WorkflowList({ initialWorkflows }: { initialWorkflows: WorkflowSummary[] }) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>(initialWorkflows);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [liveCount, setLiveCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const loadWorkflows = useCallback(() => {
    setLoading(true);
    return Promise.all([
      api.workflows.list(),
      api.runs.list().catch(() => [] as ApiRun[]),
    ])
      .then(([liveList, runs]) => {
        setLiveCount(liveList.length);
        const summaries = enrichWorkflowSummaries(
          liveList.map((live: ApiWorkflow) => apiWorkflowToSummary(live)),
          runs,
        );
        setWorkflows(summaries.sort((a, b) => {
          if (a.status === "draft" && b.status !== "draft") return -1;
          if (b.status === "draft" && a.status !== "draft") return 1;
          return a.name.localeCompare(b.name);
        }));
      })
      .catch(() => {
        if (initialWorkflows.length > 0) setWorkflows(initialWorkflows);
      })
      .finally(() => setLoading(false));
  }, [initialWorkflows]);

  useEffect(() => {
    loadWorkflows();
    const refresh = () => loadWorkflows();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refresh();
    });
    return () => window.removeEventListener("focus", refresh);
  }, [loadWorkflows]);

  const filtered = useMemo(() => workflows.filter((w) => {
    const matchesQuery = `${w.name} ${w.description} ${w.department}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === "all" || w.status === filter;
    return matchesQuery && matchesFilter;
  }), [filter, workflows, query]);

  const activeCount = workflows.filter((w) => w.status === "active").length;
  const totalHours = workflows.reduce((sum, w) => sum + w.timeSavedHours, 0);

  return (
    <>
      <section className="page-heading-row">
        <div>
          <p className="eyebrow">Process library</p>
          <h1>Workflows</h1>
          <p className="page-subtitle">Build, review, and monitor the processes your team has delegated.</p>
        </div>
        <Link href="/workflows/new" className="primary-button"><Plus size={18} />Create workflow</Link>
      </section>
      <section className="summary-strip">
        <div><WorkflowIcon size={19} /><span><strong>{loading ? "…" : liveCount ?? workflows.length}</strong><small>Total workflows</small></span></div>
        <div><ShieldCheck size={19} /><span><strong>{loading ? "…" : activeCount}</strong><small>Active</small></span></div>
        <div><TimerReset size={19} /><span><strong>{loading ? "…" : `${totalHours.toFixed(1)} hrs`}</strong><small>Automation runtime</small></span></div>
      </section>
      <section className="list-toolbar">
        <div className="filter-tabs" role="tablist" aria-label="Workflow status">
          {["all", "active", "draft", "paused"].map((item) => (
            <button key={item} onClick={() => setFilter(item)} className={filter === item ? "active" : ""}>
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </div>
        <div className="toolbar-actions">
          <label className="table-search">
            <Search size={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search workflows" aria-label="Search workflows" />
          </label>
          <button className="icon-text-button"><Filter size={16} />Filter</button>
        </div>
      </section>
      <section className="workflow-list" aria-live="polite">
        {loading && workflows.length === 0 ? (
          <div className="empty-state"><LoaderCircle size={24} className="spin" /><p>Loading workflows…</p></div>
        ) : filtered.map((workflow) => (
          <article className="workflow-row" key={workflow.id}>
            <Link href={`/workflows/${workflow.id}`} className="workflow-row-main">
              <span className={`workflow-symbol risk-${workflow.riskLevel}`}><WorkflowIcon size={20} /></span>
              <span className="workflow-copy">
                <strong>{workflow.name}</strong>
                <small>{workflow.description}</small>
                <span><b>{workflow.department}</b> · Owned by {workflow.owner}</span>
              </span>
            </Link>
            <div className="workflow-row-status">
              <StatusPill status={workflow.status} />
              <span className={`risk-label risk-${workflow.riskLevel}`}>{workflow.riskLevel} risk</span>
            </div>
            <div className="workflow-stat"><strong>{workflow.runsThisMonth}</strong><small>runs this month</small></div>
            <div className="workflow-stat"><strong>{workflow.successRate ? `${workflow.successRate}%` : "—"}</strong><small>completion</small></div>
            <div className="workflow-stat last-run"><strong>{workflow.lastRun}</strong><small>last run</small></div>
            <Link href={`/workflows/${workflow.id}`} className="row-arrow" aria-label={`Open ${workflow.name}`}><ArrowRight size={17} /></Link>
            <button className="icon-button" aria-label={`More actions for ${workflow.name}`}><MoreHorizontal size={18} /></button>
          </article>
        ))}
        {!loading && filtered.length === 0 && (
          <div className="empty-state"><Search size={24} /><h3>No workflows found</h3><p>Try a different name or status.</p></div>
        )}
      </section>
    </>
  );
}
