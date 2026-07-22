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
  Mail,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";
import { recentRuns, templateCards, workflows } from "../../lib/demo-data";
import { StatusPill } from "../components/StatusPill";

const titles: Record<string, [string, string, string]> = {
  templates: ["Template library", "Start with a proven process", "Explore ready-made workflows designed for common business operations."],
  runs: ["Execution history", "Runs", "Follow each workflow from its starting event to a completed outcome."],
  approvals: ["Human decisions", "Approval inbox", "Review sensitive actions and keep important decisions with the right person."],
  connections: ["Business tools", "Connections", "Choose which apps WorkPilot may use and exactly what each workflow can do."],
  team: ["Workspace access", "Team", "Manage people, roles, and decision responsibilities across your workspace."],
  analytics: ["Measured outcomes", "Analytics", "Understand adoption, reliability, estimated time saved, and operating cost."],
  settings: ["Workspace controls", "Settings", "Set defaults for safety, notifications, language, and local preferences."],
  help: ["Guidance", "Help centre", "Learn how to build safe, understandable workflows for your team."],
};

export function SectionPage({ section }: { section: string }) {
  const copy = titles[section] ?? titles.help;
  return <div className="page section-page"><section className="page-heading-row"><div><p className="eyebrow">{copy[0]}</p><h1>{copy[1]}</h1><p className="page-subtitle">{copy[2]}</p></div>{["templates", "connections", "team"].includes(section) && <button className="primary-button"><Plus size={18} />{section === "templates" ? "Create workflow" : section === "connections" ? "Add connection" : "Invite person"}</button>}</section>{section === "templates" ? <Templates /> : section === "runs" ? <Runs /> : section === "approvals" ? <Approvals /> : section === "connections" ? <Connections /> : section === "team" ? <Team /> : section === "analytics" ? <Analytics /> : section === "settings" ? <Settings /> : <Help />}</div>;
}

function Templates() {
  return <><div className="category-chips"><button className="active">All templates</button>{["Project operations", "Meetings", "Marketing", "Finance", "HR", "Compliance"].map((item) => <button key={item}>{item}</button>)}</div><div className="template-catalog">{templateCards.map(([name, category, summary], index) => <article key={name}><span className={`template-art template-art-${index + 1}`}><LayoutTemplate size={24} /></span><div><small>{category}</small><h2>{name}</h2><p>{summary}</p><ul><li><Check size={14} />Includes human review</li><li><ShieldCheck size={14} />Safe test data included</li></ul><Link href={`/workflows/${workflows[index]?.id ?? "wf-client-brief"}`} className="secondary-button">Preview template <ArrowRight size={16} /></Link></div></article>)}</div></>;
}

function Runs() {
  return <><section className="run-metrics"><div><span className="metric-icon tone-mint"><CheckCircle2 size={20} /></span><div><strong>137</strong><small>completed this month</small></div></div><div><span className="metric-icon tone-amber"><Clock3 size={20} /></span><div><strong>3</strong><small>waiting for a person</small></div></div><div><span className="metric-icon tone-blue"><Gauge size={20} /></span><div><strong>1m 54s</strong><small>average duration</small></div></div><div><span className="metric-icon tone-violet"><CircleDollarSign size={20} /></span><div><strong>$18.42</strong><small>cost this month</small></div></div></section><section className="panel"><div className="list-toolbar embedded"><label className="table-search"><Search size={16} /><input placeholder="Search by workflow or run" /></label><button className="icon-text-button"><Filter size={16} />Filter</button></div><div className="table-wrap"><table className="data-table spacious"><thead><tr><th>Run</th><th>Workflow</th><th>Status</th><th>Started</th><th>Progress</th><th>Duration</th><th>Cost</th><th /></tr></thead><tbody>{recentRuns.map((run) => <tr key={run.id}><td><strong>#{run.id.split("-")[1]}</strong></td><td><Link href={`/workflows/${run.workflowId}`}>{run.workflowName}</Link><small>{run.trigger}</small></td><td><StatusPill status={run.status} /></td><td>{run.startedAt}</td><td><span className="step-progress"><i style={{ width: `${run.stepsCompleted / run.stepsTotal * 100}%` }} /></span><small>{run.stepsCompleted}/{run.stepsTotal} steps</small></td><td>{run.duration}</td><td>${run.cost.toFixed(3)}</td><td><button className="icon-button"><MoreHorizontal size={17} /></button></td></tr>)}</tbody></table></div></section></>;
}

function Approvals() {
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const approvals = [
    { id: "ap-1", workflow: "Client brief processor", title: "Approve the standardized brief", subject: "Northstar Foods · Spring launch", risk: "medium", due: "Due in 3h", owner: "Maya Chen", summary: "WorkPilot found all required fields and prepared 12 delivery tasks. Review the dates and markets before tasks are created." },
    { id: "ap-2", workflow: "Invoice preparation", title: "Review invoice draft", subject: "Cascade Labs · INV-2026-071", risk: "high", due: "Due today at 16:00", owner: "Noah Williams", summary: "The draft includes 164 approved hours and €820 in expenses. Two weekend entries are above the standard rate." },
    { id: "ap-3", workflow: "Meeting to action", title: "Confirm meeting actions", subject: "Quarterly account review", risk: "low", due: "Due tomorrow", owner: "Alex Morgan", summary: "Seven actions were identified. Two have dates but no owner, so WorkPilot will not create them yet." },
  ];
  return <div className="approval-layout"><div className="approval-list"><div className="approval-filter"><button className="active">Assigned to me <span>3</span></button><button>Team queue <span>5</span></button><button>Decided</button></div>{approvals.map((approval) => <article key={approval.id} className="approval-card">{decisions[approval.id] ? <div className="decision-state"><span><Check size={20} /></span><div><h2>{decisions[approval.id]}</h2><p>The decision was recorded in the audit history.</p></div></div> : <><div className="approval-card-head"><div><small>{approval.workflow}</small><h2>{approval.title}</h2><p>{approval.subject}</p></div><span className={`risk-label risk-${approval.risk}`}>{approval.risk} risk</span></div><p className="approval-summary">{approval.summary}</p><div className="approval-meta"><span><Clock3 size={15} />{approval.due}</span><span><Users size={15} />Requested by {approval.owner}</span></div><div className="approval-actions"><button className="primary-button" onClick={() => setDecisions((current) => ({ ...current, [approval.id]: "Approved" }))}><Check size={16} />Approve</button><button className="secondary-button" onClick={() => setDecisions((current) => ({ ...current, [approval.id]: "Changes requested" }))}>Request changes</button><button className="icon-button" onClick={() => setDecisions((current) => ({ ...current, [approval.id]: "Rejected" }))} aria-label="Reject"><X size={17} /></button></div></>}</article>)}</div><aside className="approval-guide"><ShieldCheck size={23} /><h2>You stay in control</h2><p>Approvals are recorded with the exact data, recommendation, and safeguards shown at decision time.</p><ul><li><Check size={14} />One decision is accepted once</li><li><Check size={14} />Rejected work never continues</li><li><Check size={14} />Every decision is traceable</li></ul></aside></div>;
}

function Connections() {
  const apps = [["Google Drive", "Connected", FolderOpen, "Read approved brief folders"], ["Gmail", "Connected", Mail, "Read incoming briefs; sending disabled"], ["Slack", "Needs attention", MessageSquare, "Re-authorize by 30 July"], ["Microsoft Teams", "Available", MessageSquare, "Not connected"], ["Notion", "Available", FileText, "Not connected"], ["Scoro", "Available", Cloud, "Not connected"]] as const;
  return <><div className="connection-note"><ShieldCheck size={18} /><p><strong>Connections are permission-scoped.</strong> Each workflow receives only the operations it needs. Credentials are never shown to workflow steps.</p></div><div className="connection-grid">{apps.map(([name, status, Icon, scope]) => <article key={name}><span className="connection-icon"><Icon size={23} /></span><div><h2>{name}</h2><StatusPill status={status} /><p>{scope}</p></div><button className={status === "Connected" ? "secondary-button" : "primary-button"}>{status === "Connected" ? "Manage" : status === "Needs attention" ? "Fix connection" : "Connect"}</button></article>)}</div></>;
}

function Team() {
  const people = [["AM", "Alex Morgan", "alex@northstar.example", "Workflow Admin", "Active"], ["MC", "Maya Chen", "maya@northstar.example", "Approver", "Active"], ["PS", "Priya Shah", "priya@northstar.example", "Workflow Builder", "Active"], ["ER", "Elena Rossi", "elena@northstar.example", "Operator", "Invited"]];
  return <section className="panel"><div className="table-wrap"><table className="data-table spacious"><thead><tr><th>Person</th><th>Role</th><th>Status</th><th>Last active</th><th /></tr></thead><tbody>{people.map((person, index) => <tr key={person[2]}><td><span className={`avatar ${index % 2 ? "mint" : "lavender"}`}>{person[0]}</span><span className="person-cell"><strong>{person[1]}</strong><small>{person[2]}</small></span></td><td>{person[3]}</td><td><StatusPill status={person[4]} /></td><td>{index === 3 ? "Not yet" : `${index * 12 + 4} min ago`}</td><td><button className="icon-button"><MoreHorizontal size={17} /></button></td></tr>)}</tbody></table></div></section>;
}

function Analytics() {
  return <><section className="analytics-top"><article><p>Estimated time saved</p><strong>64.4 hrs</strong><span>+18% vs last month</span></article><article><p>Successful completion</p><strong>97.8%</strong><span>+2.4% vs last month</span></article><article><p>Average approval wait</p><strong>38 min</strong><span>12 min faster</span></article><article><p>Operating cost</p><strong>$18.42</strong><span>$0.11 per run</span></article></section><section className="analytics-grid"><article className="panel"><div className="panel-heading"><div><p className="section-kicker">Last 30 days</p><h2>Completed runs</h2></div><button className="secondary-button"><CalendarClock size={16} />30 days</button></div><div className="large-chart"><div className="chart-lines"><span /><span /><span /><span /></div><div className="area-bars">{[38, 52, 48, 63, 58, 73, 67, 78, 71, 86, 82, 92, 88, 96, 91, 98].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div></div></article><article className="panel value-panel"><p className="section-kicker">Top value</p><h2>Time saved by workflow</h2>{workflows.slice(0, 4).map((workflow) => <div key={workflow.id}><span><strong>{workflow.name}</strong><small>{workflow.timeSavedHours} estimated hrs</small></span><i><b style={{ width: `${Math.max(8, workflow.timeSavedHours / 24.2 * 100)}%` }} /></i></div>)}</article></section><p className="estimate-disclaimer">Time-saved figures are estimates based on team-provided manual baselines. They are labelled and never treated as guaranteed savings.</p></>;
}

function Settings() {
  const [safe, setSafe] = useState(true); const [notify, setNotify] = useState(true);
  return <div className="settings-layout"><aside className="settings-nav"><button className="active"><Settings2 size={16} />General</button><button><ShieldCheck size={16} />Safety policies</button><button><Users size={16} />Roles & access</button><button><MessageSquare size={16} />Notifications</button></aside><section className="panel settings-panel"><div><h2>Workspace settings</h2><p>These defaults apply to Northstar Projects.</p></div><label className="form-field"><span>Workspace name</span><input defaultValue="Northstar Projects" /></label><label className="form-field"><span>Default time zone</span><button className="select-field">Europe/Warsaw</button></label><hr /><h3>Safety defaults</h3><Toggle label="Use safe test mode first" description="New workflows simulate external writes until someone explicitly enables them." checked={safe} onChange={setSafe} /><Toggle label="Notify owners about exceptions" description="Send an in-product notification when a run pauses or fails." checked={notify} onChange={setNotify} /><button className="primary-button">Save settings</button></section></div>;
}

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) { return <button className="toggle-row" onClick={() => onChange(!checked)}><span><strong>{label}</strong><small>{description}</small></span><i className={checked ? "toggle active" : "toggle"}><b /></i></button>; }

function Help() { return <div className="help-grid">{[["Build your first workflow", "Learn how to describe a process and review each step."], ["Test without changing tools", "See how safe test mode uses sample data and blocks real writes."], ["Design a good approval", "Choose the right reviewer, deadline, evidence, and escalation path."], ["Understand a run", "Follow step outputs, timing, cost, errors, and the audit history."]].map(([title, body], index) => <article className="panel" key={title}><span>{index + 1}</span><h2>{title}</h2><p>{body}</p><button className="text-link">Read guide <ArrowRight size={15} /></button></article>)}</div>; }
