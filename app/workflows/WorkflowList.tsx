"use client";

import Link from "next/link";
import { ArrowRight, Filter, MoreHorizontal, Plus, Search, ShieldCheck, TimerReset, Workflow as WorkflowIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { WorkflowSummary } from "../../lib/types";
import { StatusPill } from "../components/StatusPill";

export function WorkflowList({ initialWorkflows }: { initialWorkflows: WorkflowSummary[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const filtered = useMemo(() => initialWorkflows.filter((workflow) => {
    const matchesQuery = `${workflow.name} ${workflow.description} ${workflow.department}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === "all" || workflow.status === filter;
    return matchesQuery && matchesFilter;
  }), [filter, initialWorkflows, query]);

  return (
    <>
      <section className="page-heading-row">
        <div><p className="eyebrow">Process library</p><h1>Workflows</h1><p className="page-subtitle">Build, review, and monitor the processes your team has delegated.</p></div>
        <Link href="/workflows/new" className="primary-button"><Plus size={18} />Create workflow</Link>
      </section>
      <section className="summary-strip">
        <div><WorkflowIcon size={19} /><span><strong>5</strong><small>Total workflows</small></span></div>
        <div><ShieldCheck size={19} /><span><strong>3 active</strong><small>Running with safeguards</small></span></div>
        <div><TimerReset size={19} /><span><strong>64.4 hrs</strong><small>Estimated time saved</small></span></div>
      </section>
      <section className="list-toolbar">
        <div className="filter-tabs" role="tablist" aria-label="Workflow status">
          {["all", "active", "draft", "paused"].map((item) => <button key={item} onClick={() => setFilter(item)} className={filter === item ? "active" : ""}>{item[0].toUpperCase() + item.slice(1)}</button>)}
        </div>
        <div className="toolbar-actions">
          <label className="table-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search workflows" aria-label="Search workflows" /></label>
          <button className="icon-text-button"><Filter size={16} />Filter</button>
        </div>
      </section>
      <section className="workflow-list" aria-live="polite">
        {filtered.map((workflow) => (
          <article className="workflow-row" key={workflow.id}>
            <Link href={`/workflows/${workflow.id}`} className="workflow-row-main">
              <span className={`workflow-symbol risk-${workflow.riskLevel}`}><WorkflowIcon size={20} /></span>
              <span className="workflow-copy"><strong>{workflow.name}</strong><small>{workflow.description}</small><span><b>{workflow.department}</b> · Owned by {workflow.owner}</span></span>
            </Link>
            <div className="workflow-row-status"><StatusPill status={workflow.status} /><span className={`risk-label risk-${workflow.riskLevel}`}>{workflow.riskLevel} risk</span></div>
            <div className="workflow-stat"><strong>{workflow.runsThisMonth}</strong><small>runs this month</small></div>
            <div className="workflow-stat"><strong>{workflow.successRate ? `${workflow.successRate}%` : "—"}</strong><small>completion</small></div>
            <div className="workflow-stat last-run"><strong>{workflow.lastRun}</strong><small>last run</small></div>
            <Link href={`/workflows/${workflow.id}`} className="row-arrow" aria-label={`Open ${workflow.name}`}><ArrowRight size={17} /></Link>
            <button className="icon-button" aria-label={`More actions for ${workflow.name}`}><MoreHorizontal size={18} /></button>
          </article>
        ))}
        {filtered.length === 0 && <div className="empty-state"><Search size={24} /><h3>No workflows found</h3><p>Try a different name or status.</p></div>}
      </section>
    </>
  );
}
