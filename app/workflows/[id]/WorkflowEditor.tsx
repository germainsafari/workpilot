"use client";

import {
  addEdge,
  Background,
  Connection,
  Controls,
  Edge,
  MiniMap,
  Node,
  OnSelectionChangeParams,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  CircleStop,
  Clock3,
  CloudUpload,
  CornerDownRight,
  Gauge,
  GitBranch,
  Hand,
  History,
  ListChecks,
  LoaderCircle,
  LockKeyhole,
  MessageSquareText,
  MoreHorizontal,
  Play,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Timer,
  Undo2,
  Workflow as WorkflowIcon,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, formatDuration, formatRelativeTime, parseApiDate, type ApiRun } from "../../../lib/api";
import type { StepType, WorkflowSummary } from "../../../lib/types";
import { StatusPill } from "../../components/StatusPill";

type FlowData = { label: string; summary: string; stepType: StepType };
type FlowNode = Node<FlowData>;

const stepIcon = (type: StepType, size = 16) => {
  if (type === "trigger") return <Zap size={size} />;
  if (type === "tool") return <CornerDownRight size={size} />;
  if (type === "ai_task") return <Sparkles size={size} />;
  if (type === "condition") return <GitBranch size={size} />;
  if (type === "wait") return <Timer size={size} />;
  if (type === "approval") return <Hand size={size} />;
  return <CircleStop size={size} />;
};

const labelForStep = (type: StepType) => ({ trigger: "Starting event", tool: "Business action", ai_task: "AI-assisted step", condition: "Decision", wait: "Wait", approval: "Human approval", end: "Finish" })[type];

function WorkflowEditorInner({ workflow }: { workflow: WorkflowSummary }) {
  const initialNodes = useMemo<FlowNode[]>(() => workflow.definition.steps.map((step) => ({
    id: step.id,
    type: "default",
    position: step.position,
    data: { label: step.name, summary: step.summary, stepType: step.type },
    className: `flow-node flow-${step.type}`,
  })), [workflow.definition.steps]);
  const initialEdges = useMemo<Edge[]>(() => workflow.definition.edges.map((edge) => ({
    ...edge,
    animated: edge.source === "approval",
    type: "smoothstep",
    className: "flow-edge",
    labelStyle: { fill: "#5f655f", fontSize: 11, fontWeight: 650 },
    labelBgStyle: { fill: "#f6f7f3", fillOpacity: 1 },
  })), [workflow.definition.edges]);

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selected, setSelected] = useState<FlowNode | null>(initialNodes[1] ?? null);
  const [tab, setTab] = useState<"build" | "explain" | "activity">("build");
  const [saved, setSaved] = useState(true);
  const [published, setPublished] = useState(workflow.status === "active");
  const [publishing, setPublishing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const stepSequence = useRef(0);

  // Live run state
  const [activeRun, setActiveRun] = useState<ApiRun | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [showTestDrawer, setShowTestDrawer] = useState(false);
  const [activityRefresh, setActivityRefresh] = useState(0);

  const onConnect = useCallback((connection: Connection) => {
    setEdges((cur) => addEdge({ ...connection, type: "smoothstep" }, cur));
    setSaved(false);
  }, [setEdges]);
  const onSelectionChange = useCallback(({ nodes: sel }: OnSelectionChangeParams) => setSelected((sel[0] as FlowNode | undefined) ?? null), []);

  const addStep = (type: StepType) => {
    stepSequence.current += 1;
    const id = `new-step-${stepSequence.current}`;
    setNodes((cur) => [...cur, { id, position: { x: 900, y: 450 }, className: `flow-node flow-${type}`, data: { label: labelForStep(type), summary: "Select this step to describe what it should do.", stepType: type } }]);
    setSaved(false);
    setAddOpen(false);
  };

  const startTest = async () => {
    setRunError(null);
    setActiveRun(null);
    setShowTestDrawer(true);
    try {
      const run = await api.runs.trigger(workflow.id, { source: "workpilot_ui_test" });
      setActiveRun(run);
      setActivityRefresh((value) => value + 1);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Run failed");
    }
  };

  const handlePublish = async () => {
    setPublishing(true);
    try {
      const next = published ? "draft" : "active";
      await api.workflows.updateStatus(workflow.id, next);
      setPublished(!published);
    } catch {
      // keep UI state unchanged on error
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="workflow-editor-page">
      <header className="editor-header">
        <div className="editor-title-row">
          <Link href="/workflows" className="icon-button" aria-label="Back to workflows"><ArrowLeft size={18} /></Link>
          <div className="editor-title">
            <span className="editor-symbol"><WorkflowIcon size={18} /></span>
            <div>
              <div><h1>{workflow.name}</h1><StatusPill status={published ? "active" : "draft"} /></div>
              <p>{saved ? "All changes saved" : "Unsaved changes"} · {workflow.department}</p>
            </div>
          </div>
          <div className="editor-actions">
            <button className="icon-button" aria-label="More workflow options"><MoreHorizontal size={19} /></button>
            <button className="secondary-button" onClick={startTest}><Play size={16} />Test safely</button>
            <button className={published ? "secondary-button publish-button published" : "primary-button publish-button"} onClick={handlePublish} disabled={publishing}>
              {publishing ? <LoaderCircle size={16} className="spin" /> : published ? <Check size={16} /> : <CloudUpload size={16} />}
              {published ? "Published" : "Publish"}
            </button>
          </div>
        </div>
        <div className="editor-tabs" role="tablist">
          <button className={tab === "build" ? "active" : ""} onClick={() => setTab("build")}><WorkflowIcon size={16} />Build</button>
          <button className={tab === "explain" ? "active" : ""} onClick={() => setTab("explain")}><MessageSquareText size={16} />Plain-language explanation</button>
          <button className={tab === "activity" ? "active" : ""} onClick={() => setTab("activity")}><History size={16} />Runs & activity</button>
        </div>
      </header>

      {tab === "build" && <div className="editor-workspace">
        <div className="canvas-wrap">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={(changes) => { onNodesChange(changes); setSaved(false); }}
            onEdgesChange={(changes) => { onEdgesChange(changes); setSaved(false); }}
            onConnect={onConnect}
            onSelectionChange={onSelectionChange}
            fitView
            fitViewOptions={{ padding: 0.18 }}
            minZoom={0.35}
            maxZoom={1.6}
            deleteKeyCode={["Backspace", "Delete"]}
            aria-label="Visual workflow builder"
          >
            <Background gap={24} size={1.2} color="#d9ddd6" />
            <Controls position="bottom-left" showInteractive={false} />
            <MiniMap position="bottom-right" pannable zoomable nodeColor={(node) => node.data?.stepType === "approval" ? "#f3a955" : node.data?.stepType === "ai_task" ? "#a687f5" : "#9ed6b4"} />
            <Panel position="top-left" className="canvas-toolbar">
              <div className="add-step-wrap">
                <button className="primary-button small-button" onClick={() => setAddOpen((v) => !v)}><Plus size={16} />Add step <ChevronDown size={14} /></button>
                {addOpen && <div className="add-step-menu">{(["ai_task", "tool", "condition", "approval", "wait", "end"] as StepType[]).map((type) => <button key={type} onClick={() => addStep(type)}>{stepIcon(type)}<span><strong>{labelForStep(type)}</strong><small>{type === "ai_task" ? "Summarize, classify, or prepare" : type === "tool" ? "Prepare a task or message" : type === "approval" ? "Pause for a person" : "Control the flow"}</small></span></button>)}</div>}
              </div>
              <span className="toolbar-separator" />
              <button className="icon-button" aria-label="Undo"><Undo2 size={17} /></button>
              <button className="icon-button" aria-label="Redo"><RotateCcw size={17} /></button>
              <button className="secondary-button small-button" onClick={() => setSaved(true)} disabled={saved}><Save size={15} />Save</button>
            </Panel>
          </ReactFlow>
          <div className="canvas-legend"><span><b className="legend-dot reasoning" />AI-assisted</span><span><b className="legend-dot deterministic" />Fixed rule</span><span><b className="legend-dot approval" />Human approval</span></div>
        </div>
        <aside className="configuration-panel">
          {selected ? <StepConfiguration node={selected} onClose={() => setSelected(null)} onChange={(label) => { setNodes((cur) => cur.map((n) => n.id === selected.id ? { ...n, data: { ...n.data, label } } : n)); setSelected((cur) => cur ? { ...cur, data: { ...cur.data, label } } : null); setSaved(false); }} /> : <div className="panel-empty"><ListChecks size={28} /><h3>Select a step</h3><p>Choose a step on the canvas to review its purpose and safeguards.</p></div>}
        </aside>
      </div>}

      {tab === "explain" && <Explanation workflow={workflow} />}
      {tab === "activity" && <Activity workflowId={workflow.id} refreshKey={activityRefresh} />}

      {showTestDrawer && (
        <LiveTestDrawer
          workflowId={workflow.id}
          run={activeRun}
          error={runError}
          onClose={() => { setShowTestDrawer(false); setActiveRun(null); setRunError(null); }}
          onRerun={startTest}
        />
      )}
    </div>
  );
}

function StepConfiguration({ node, onClose, onChange }: { node: FlowNode; onClose: () => void; onChange: (label: string) => void }) {
  return <>
    <div className="config-head"><div className={`config-icon config-${node.data.stepType}`}>{stepIcon(node.data.stepType, 18)}</div><div><small>{labelForStep(node.data.stepType)}</small><h2>{node.data.label}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close step settings"><X size={17} /></button></div>
    <div className="config-body">
      <label className="form-field"><span>Step name</span><input value={node.data.label} onChange={(e) => onChange(e.target.value)} /></label>
      <div className="form-field"><span>What happens here</span><p className="read-only-field">{node.data.summary}</p></div>
      {node.data.stepType === "ai_task" && <div className="config-section"><h3><Bot size={16} />How WorkPilot helps</h3><p>It organizes the brief into a fixed structure and returns a concise summary. It cannot send messages or change external records.</p><span className="safety-chip"><ShieldCheck size={14} />Structured result required</span></div>}
      {node.data.stepType === "approval" && <><label className="form-field"><span>Who reviews it?</span><button className="select-field">Account manager <ChevronDown size={15} /></button></label><div className="config-section approval-rule"><h3><LockKeyhole size={16} />Approval rule</h3><p>The workflow pauses here. Later actions cannot run until the assigned reviewer approves.</p></div></>}
      <div className="config-section"><h3><AlertTriangle size={16} />If this step fails</h3><p>Retry once, then pause the run and notify the workflow owner.</p></div>
    </div>
    <div className="config-footer"><button className="danger-link">Remove step</button><button className="primary-button" onClick={onClose}>Done</button></div>
  </>;
}

function Explanation({ workflow }: { workflow: WorkflowSummary }) {
  return <div className="explanation-page"><div className="explanation-main"><div className="explanation-hero"><span><MessageSquareText size={22} /></span><div><p className="eyebrow">In plain language</p><h2>What this workflow does</h2><p>{workflow.description} Every action stays in safe test mode until a person approves publication.</p></div></div><div className="explanation-sections"><section><span>1</span><div><h3>What starts it</h3><p>A new client brief arrives through the connected form. WorkPilot records who submitted it and when.</p></div></section><section><span>2</span><div><h3>What it reads and prepares</h3><p>It reads only the submitted brief, then organizes deliverables, markets, dates, languages, and constraints.</p></div></section><section><span>3</span><div><h3>Where a person stays in control</h3><p>The account manager must review the standardized brief before any project tasks can be prepared.</p></div></section><section><span>4</span><div><h3>When something goes wrong</h3><p>The run retries once. If the issue remains, it pauses and tells the workflow owner without repeating completed actions.</p></div></section></div></div><aside className="explanation-aside"><h3>Safeguards</h3><div><ShieldCheck size={17} /><span><strong>No live writes in tests</strong><small>Connected tools are never changed during a safe test.</small></span></div><div><Hand size={17} /><span><strong>Human approval required</strong><small>Project tasks wait for an account manager.</small></span></div><div><LockKeyhole size={17} /><span><strong>Limited data access</strong><small>Only client brief fields are available to this workflow.</small></span></div><hr /><h3>Estimated usage</h3><p className="estimate"><strong>$1.60–$2.10</strong><small>per 100 completed briefs</small></p><p className="estimate"><strong>24 minutes</strong><small>estimated manual time saved per brief</small></p></aside></div>;
}

function Activity({ workflowId, refreshKey }: { workflowId: string; refreshKey: number }) {
  const [runs, setRuns] = useState<ApiRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.runs.list().then((all) => {
      setRuns(all.filter((r) => r.workflow_id === workflowId));
    }).catch(() => setRuns([])).finally(() => setLoading(false));
  }, [workflowId, refreshKey]);

  const completed = runs.filter((r) => r.status === "completed").length;
  const totalCost = runs.reduce((sum, r) => sum + r.total_cost, 0);
  const durations = runs.filter((r) => r.finished_at).map((r) => parseApiDate(r.finished_at!).getTime() - parseApiDate(r.started_at).getTime());
  const avgMs = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const avgLabel = avgMs >= 60_000
    ? `${Math.floor(avgMs / 60_000)}m ${Math.round((avgMs % 60_000) / 1000)}s`
    : avgMs >= 1000
      ? `${(avgMs / 1000).toFixed(1)}s`
      : avgMs > 0
        ? `${Math.round(avgMs)}ms`
        : "—";
  const lastRun = runs.length > 0
    ? formatRelativeTime(runs.reduce((a, b) => parseApiDate(a.started_at) > parseApiDate(b.started_at) ? a : b).started_at)
    : "Not run yet";

  return <div className="activity-page">
    <div className="activity-summary">
      <div><CheckCircle2 size={19} /><span><strong>{completed}/{runs.length}</strong><small>completed</small></span></div>
      <div><Clock3 size={19} /><span><strong>{avgLabel}</strong><small>avg duration</small></span></div>
      <div><Gauge size={19} /><span><strong>${totalCost.toFixed(4)}</strong><small>total AI cost</small></span></div>
      <div><History size={19} /><span><strong>{lastRun}</strong><small>last run</small></span></div>
    </div>
    <section className="panel">
      <div className="panel-heading"><div><p className="section-kicker">Execution history</p><h2>Recent runs</h2></div></div>
      {loading ? (
        <div className="empty-state"><LoaderCircle size={24} className="spin" /><p>Loading runs…</p></div>
      ) : runs.length === 0 ? (
        <div className="empty-state"><History size={24} /><h3>No runs yet</h3><p>Click "Test safely" to trigger your first run.</p></div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Run</th><th>Status</th><th>Started</th><th>Trigger</th><th>Steps</th><th>Duration</th><th>AI cost</th></tr></thead>
            <tbody>{runs.map((run) => (
              <tr key={run.id}>
                <td><strong>#{run.id.slice(-8)}</strong></td>
                <td><StatusPill status={run.status} /></td>
                <td>{formatRelativeTime(run.started_at)}</td>
                <td>{run.trigger_type}</td>
                <td>{run.steps.length} steps</td>
                <td>{formatDuration(run.started_at, run.finished_at)}</td>
                <td>${run.total_cost.toFixed(4)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  </div>;
}

function LiveTestDrawer({
  workflowId, run, error, onClose, onRerun,
}: {
  workflowId: string;
  run: ApiRun | null;
  error: string | null;
  onClose: () => void;
  onRerun: () => void;
}) {
  const waiting = !run && !error;
  const steps = run?.steps ?? [];
  const aiStep = steps.find((s) => s.model_usage && Object.keys(s.model_usage).length > 0);
  const aiProvider = aiStep ? String(aiStep.model_usage.provider ?? "—") : "—";
  const aiCost = aiStep ? Number(aiStep.model_usage.cost_usd ?? 0) : 0;

  return (
    <div className="test-drawer" role="dialog" aria-modal="true" aria-label="Live test run">
      <div className="test-head">
        <div>
          <span className="safe-test-icon"><Play size={17} /></span>
          <div>
            <p>Live test · {workflowId}</p>
            <h2>{waiting ? "Running…" : error ? "Run failed" : run?.status === "completed" ? "Test completed" : `Status: ${run?.status}`}</h2>
          </div>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </div>

      <div className="test-banner">
        <ShieldCheck size={17} />
        <p><strong>Real execution on Bedrock.</strong> This calls the live API and runs your workflow steps with AI.</p>
      </div>

      {waiting && (
        <div className="empty-state" style={{ padding: "2rem" }}>
          <LoaderCircle size={28} className="spin" />
          <p>Waiting for run to complete…</p>
        </div>
      )}

      {error && (
        <div className="empty-state" style={{ padding: "2rem" }}>
          <AlertTriangle size={28} />
          <h3>Error</h3>
          <p>{error}</p>
          <button className="secondary-button" onClick={onRerun}>Try again</button>
        </div>
      )}

      {run && !error && (
        <>
          <div className="test-steps">
            {steps.map((step, index) => {
              const done = step.status === "completed";
              const usage = step.model_usage ?? {};
              const provider = usage.provider ? String(usage.provider) : null;
              return (
                <div className={done ? "test-step done" : "test-step"} key={step.id}>
                  <span>{done ? <Check size={15} /> : index + 1}</span>
                  <div>
                    <strong>{step.step_id}</strong>
                    <small>
                      {provider ? `${provider} · ` : ""}{formatDuration(step.started_at, step.finished_at)}
                    </small>
                  </div>
                  {provider && <b>${Number(usage.cost_usd ?? 0).toFixed(5)}</b>}
                </div>
              );
            })}
          </div>
          <div className="test-footer">
            {run.status === "completed" ? (
              <>
                <div className="test-result">
                  <CheckCircle2 size={20} />
                  <span>
                    <strong>Completed · {steps.length} steps</strong>
                    <small>
                      AI: {aiProvider} · cost ${aiCost.toFixed(5)} · {formatDuration(run.started_at, run.finished_at)}
                    </small>
                  </span>
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button className="secondary-button" onClick={onRerun}><Play size={15} />Run again</button>
                  <button className="primary-button" onClick={onClose}>Done</button>
                </div>
              </>
            ) : (
              <>
                <p><strong>Status: {run.status}</strong></p>
                <button className="secondary-button" onClick={onClose}>Close</button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function WorkflowEditor({ workflow }: { workflow: WorkflowSummary }) {
  return <ReactFlowProvider><WorkflowEditorInner workflow={workflow} /></ReactFlowProvider>;
}
