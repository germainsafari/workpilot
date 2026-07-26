"use client";

import Link from "next/link";
import { ArrowRight, Filter, MoreHorizontal, Plus, Search, ShieldCheck, TimerReset, Workflow as WorkflowIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, formatRelativeTime, type ApiWorkflow } from "../../lib/api";
import type { WorkflowSummary } from "../../lib/types";
import { StatusPill } from "../components/StatusPill";

function mergeApiWorkflow(demo: WorkflowSummary, live: ApiWorkflow): WorkflowSummary {
  return {
    ...demo,
    name: live.name,
    description: live.description,
    department: live.department,
    status: live.status as WorkflowSummary["status"],
    riskLevel: live.risk_level as WorkflowSummary["riskLevel"],
    lastRun: formatRelativeTime(live.updated_at),
  };
}

function apiOnlyWorkflow(live: ApiWorkflow): WorkflowSummary {
  return {
    id: live.id,
    name: live.name,
    description: live.description,
    department: live.department,
    owner: live.owner_id,
    status: live.status as WorkflowSummary["status"],
    riskLevel: live.risk_level as WorkflowSummary["riskLevel"],
    trigger: "Manual",
    runsThisMonth: 0,
    successRate: 0,
    timeSavedHours: 0,
    lastRun: formatRelativeTime(live.updated_at),
    definition: {
      apiVersion: "workpilot.io/v1",
      kind: "Workflow",
      trigger: { type: "manual", label: "Manual start" },
      steps: [],
      edges: [],
    },
  };
}

export function WorkflowList({ initialWorkflows }: { initialWorkflows: WorkflowSummary[] }) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>(initialWorkflows);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [liveCount, setLiveCount] = useState<number | null>(null);

  useEffect(() => {
    api.workflows.list().then((liveList) => {
      setLiveCount(liveList.length);
      setWorkflows(() => {
        const demoById = new Map(initialWorkflows.map((w) => [w.id, w]));
        const merged: WorkflowSummary[] = liveList.map((live) => {
          const demo = demoById.get(live.id);
          return demo ? mergeApiWorkflow(demo, live) : apiOnlyWorkflow(live);
        });
        return merged;
      });
    }).catch(() => {/* keep demo data on network error */});
  }, [initialWorkflows]);

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
        <div><WorkflowIcon size={19} /><span><strong>{liveCount ?? workflows.length}</strong><small>Total workflows</small></span></div>
        <div><ShieldCheck size={19} /><span><strong>{activeCount} active</strong><small>Running with safeguards</small></span></div>
        <div><TimerReset size={19} /><span><strong>{totalHours.toFixed(1)} hrs</strong><small>Estimated time saved</small></span></div>
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
        {filtered.map((workflow) => (
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
        {filtered.length === 0 && (
          <div className="empty-state"><Search size={24} /><h3>No workflows found</h3><p>Try a different name or status.</p></div>
        )}
      </section>
    </>
  );
}
