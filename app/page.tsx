import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock3, Coins, FileWarning, Play, Plus, Sparkles, TimerReset, TrendingUp, Users } from "lucide-react";
import { recentRuns, workflows } from "../lib/demo-data";
import { StatusPill } from "./components/StatusPill";

const metrics = [
  { label: "Active workflows", value: "3", delta: "+1 this month", Icon: TrendingUp, tone: "mint" },
  { label: "Runs today", value: "18", delta: "16 completed", Icon: Play, tone: "blue" },
  { label: "Waiting for approval", value: "3", delta: "Oldest: 32 min", Icon: Clock3, tone: "amber" },
  { label: "Completion rate", value: "97.8%", delta: "+2.4% vs last month", Icon: CheckCircle2, tone: "violet" },
];

export default function Home() {
  return (
    <div className="page dashboard-page">
      <section className="welcome-row">
        <div>
          <p className="eyebrow">Wednesday, 22 July</p>
          <h1>Good morning, Alex.</h1>
          <p className="page-subtitle">Here’s what your team’s processes are doing today.</p>
        </div>
        <Link href="/workflows/new" className="primary-button"><Plus size={18} />Create workflow</Link>
      </section>

      <section className="metrics-grid" aria-label="Today’s summary">
        {metrics.map(({ label, value, delta, Icon, tone }) => (
          <article className="metric-card" key={label}>
            <div className={`metric-icon tone-${tone}`}><Icon size={20} /></div>
            <span className="metric-label">{label}</span>
            <strong className="metric-value">{value}</strong>
            <small className={label === "Waiting for approval" ? "warning-text" : "positive-text"}>{delta}</small>
          </article>
        ))}
      </section>

      <section className="dashboard-grid">
        <article className="panel performance-panel">
          <div className="panel-heading"><div><span className="section-kicker">Last 14 days</span><h2>Operations at a glance</h2></div><Link href="/analytics" className="text-link">View analytics <ArrowRight size={15} /></Link></div>
          <div className="impact-row">
            <div><TimerReset size={18} /><span><strong>64.4 hrs</strong><small>estimated time saved</small></span></div>
            <div><Coins size={18} /><span><strong>$18.42</strong><small>process cost this month</small></span></div>
            <div><Users size={18} /><span><strong>8 people</strong><small>actively using WorkPilot</small></span></div>
          </div>
          <div className="chart-wrap" aria-label="Workflow runs over the last 14 days">
            <div className="chart-y-labels"><span>30</span><span>20</span><span>10</span><span>0</span></div>
            <div className="bar-chart">
              {[42, 58, 48, 74, 62, 84, 55, 70, 88, 66, 92, 78, 96, 86].map((height, index) => <span key={index} style={{ height: `${height}%` }} className={index === 13 ? "chart-bar active" : "chart-bar"} />)}
            </div>
          </div>
          <div className="chart-caption"><span>9 Jul</span><span>13 Jul</span><span>17 Jul</span><span>Today</span></div>
        </article>

        <article className="panel attention-panel">
          <div className="panel-heading"><div><span className="section-kicker">Needs attention</span><h2>Exceptions</h2></div><span className="count-bubble">2</span></div>
          <div className="exception-card">
            <div className="exception-icon"><FileWarning size={20} /></div>
            <div><strong>Clarification needed</strong><p>Client brief processor is waiting for a project deadline.</p><span>Run #1046 · 32 min ago</span></div>
          </div>
          <div className="exception-card low">
            <div className="exception-icon"><Clock3 size={20} /></div>
            <div><strong>Review due today</strong><p>Invoice draft for Cascade Labs needs finance approval.</p><span>Due at 16:00</span></div>
          </div>
          <Link className="secondary-button full-button" href="/approvals">Open approval inbox <ArrowRight size={16} /></Link>
        </article>
      </section>

      <section className="dashboard-grid lower-grid">
        <article className="panel">
          <div className="panel-heading"><div><span className="section-kicker">Live activity</span><h2>Recent runs</h2></div><Link href="/runs" className="text-link">See all runs <ArrowRight size={15} /></Link></div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Workflow</th><th>Status</th><th>Started</th><th>Duration</th><th>Cost</th></tr></thead>
              <tbody>{recentRuns.slice(0, 4).map((run) => <tr key={run.id}><td><Link href={`/workflows/${run.workflowId}`}>{run.workflowName}</Link><small>{run.trigger}</small></td><td><StatusPill status={run.status} /></td><td>{run.startedAt}</td><td>{run.duration}</td><td>${run.cost.toFixed(3)}</td></tr>)}</tbody>
            </table>
          </div>
        </article>
        <article className="panel activity-panel">
          <div className="panel-heading"><div><span className="section-kicker">Your workspace</span><h2>Team activity</h2></div></div>
          <div className="activity-list">
            <div><span className="avatar lavender">PS</span><p><strong>Priya</strong> published <b>Weekly project health</b><small>18 minutes ago</small></p></div>
            <div><span className="avatar mint">MC</span><p><strong>Maya</strong> approved a client brief<small>41 minutes ago</small></p></div>
            <div><span className="avatar peach">ER</span><p><strong>Elena</strong> paused <b>Creative asset review</b><small>Yesterday at 16:42</small></p></div>
          </div>
        </article>
      </section>

      <section className="panel quick-workflows">
        <div className="panel-heading"><div><span className="section-kicker">Your core processes</span><h2>Active workflows</h2></div><Link href="/workflows" className="text-link">Manage workflows <ArrowRight size={15} /></Link></div>
        <div className="workflow-mini-grid">{workflows.filter((workflow) => workflow.status === "active").map((workflow) => <Link href={`/workflows/${workflow.id}`} className="workflow-mini-card" key={workflow.id}><span className="mini-icon"><Sparkles size={18} /></span><span><strong>{workflow.name}</strong><small>{workflow.trigger} · {workflow.lastRun}</small></span><ArrowRight size={16} /></Link>)}</div>
      </section>
    </div>
  );
}
