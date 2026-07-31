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
  // Aliased: this file already defines a local `Activity` component for the
  // Runs & activity tab.
  Activity as ActivityIcon,
  AlertTriangle,
  ArrowLeft,
  Bot,
  Cable,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleStop,
  Clock3,
  CloudUpload,
  CornerDownRight,
  Database,
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
import {
  api,
  formatDuration,
  formatRelativeTime,
  parseApiDate,
  type ApiAvailableTool,
  type ApiRun,
  type ApiStepRun,
} from "../../../lib/api";
import type { StepType, WorkflowSummary } from "../../../lib/types";
import { StatusPill } from "../../components/StatusPill";
import { editorDefinitionToApi } from "../../../lib/workflow-draft";

/** A run in one of these states will not change again, so polling can stop. */
const TERMINAL_RUN_STATES = new Set(["completed", "failed", "cancelled", "stopped"]);

type FlowData = { label: string; summary: string; stepType: StepType; raw?: Record<string, unknown> };
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
    data: { label: step.name, summary: step.summary, stepType: step.type, raw: step.raw },
    className: `flow-node flow-${step.type}`,
  })), [workflow.definition.steps]);
  const initialEdges = useMemo<Edge[]>(() => workflow.definition.edges.map((edge) => ({
    ...edge,
    animated: edge.source === "approval",
    type: "smoothstep",
    className: "flow-edge",
    // Tokens rather than literals: React Flow passes these straight to SVG
    // fill, so a CSS variable resolves and follows the active theme. Hardcoded
    // greys rendered white edge labels on the dark canvas.
    labelStyle: { fill: "var(--muted)", fontSize: 11, fontWeight: 650 },
    labelBgStyle: { fill: "var(--canvas)", fillOpacity: 1 },
  })), [workflow.definition.edges]);

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selected, setSelected] = useState<FlowNode | null>(initialNodes[1] ?? null);
  const [tab, setTab] = useState<"build" | "explain" | "activity">("build");
  const [saved, setSaved] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [published, setPublished] = useState(workflow.status === "active");
  const [publishing, setPublishing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const stepSequence = useRef(0);

  // Live run state
  const [activeRun, setActiveRun] = useState<ApiRun | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [showTestDrawer, setShowTestDrawer] = useState(false);
  const [activityRefresh, setActivityRefresh] = useState(0);
  // The most recent finished run, used to show each step what it actually did.
  const [latestRun, setLatestRun] = useState<ApiRun | null>(null);

  // Load the last run on open so selecting a node shows real data immediately,
  // without having to press Test first.
  useEffect(() => {
    let cancelled = false;
    api.runs
      .list()
      .then((all) => {
        if (cancelled) return;
        const mine = all
          .filter((r) => r.workflow_id === workflow.id && r.steps.length > 0)
          .sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
        if (mine[0]) setLatestRun(mine[0]);
      })
      .catch(() => {
        /* no history yet — the panel shows its "not run" state */
      });
    return () => { cancelled = true; };
  }, [workflow.id]);

  // Prefer the run in flight; fall back to history.
  const runForSteps = activeRun && activeRun.steps.length > 0 ? activeRun : latestRun;
  const stepRunFor = (stepId: string) =>
    runForSteps?.steps.find((s) => s.step_id === stepId) ?? null;

  const onConnect = useCallback((connection: Connection) => {
    setEdges((cur) => addEdge({ ...connection, type: "smoothstep" }, cur));
    setSaved(false);
  }, [setEdges]);
  const onSelectionChange = useCallback(({ nodes: sel }: OnSelectionChangeParams) => setSelected((sel[0] as FlowNode | undefined) ?? null), []);

  const addStep = (type: StepType) => {
    stepSequence.current += 1;
    const id = `new-step-${stepSequence.current}`;
    // Place near the selected node (or the rightmost node) and wire an edge
    // into it automatically — a step with no edges is invisible progress: it
    // exists in state but looks like nothing happened, and the graph
    // validator on save rejects an unreachable step anyway.
    const anchor = selected ?? nodes[nodes.length - 1];
    const position = anchor
      ? { x: anchor.position.x + 260, y: anchor.position.y }
      : { x: 280, y: 150 };
    setNodes((cur) => [
      ...cur,
      {
        id,
        position,
        className: `flow-node flow-${type}`,
        data: { label: labelForStep(type), summary: "Select this step to describe what it should do.", stepType: type },
      },
    ]);
    if (anchor) {
      setEdges((cur) => [...cur, { id: `e-${anchor.id}-${id}`, source: anchor.id, target: id, type: "smoothstep", className: "flow-edge" }]);
    }
    setSaved(false);
    setAddOpen(false);
  };

  /** Persist the current canvas — steps, edges, and any tool bindings — as a new version. */
  const saveWorkflow = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const definition = editorDefinitionToApi(nodes, edges, workflow.definition.trigger);
      await api.workflows.saveDefinition(workflow.id, definition);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save this workflow.");
    } finally {
      setSaving(false);
    }
  };

  /**
   * Trigger a run and follow it to completion.
   *
   * Runs are queued and executed by a separate worker, so the object returned by
   * `trigger` has status "queued" and zero steps. The previous version stored
   * that and stopped, which is why the drawer and the step panel stayed empty
   * however long you waited — the UI never asked again.
   */
  const startTest = useCallback(async () => {
    setRunError(null);
    setActiveRun(null);
    setShowTestDrawer(true);

    let run: ApiRun;
    try {
      run = await api.runs.trigger(workflow.id, { source: "workpilot_ui_test" });
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Could not start the run.");
      return;
    }
    setActiveRun(run);

    // Poll until the worker finishes. ~90s ceiling: a multi-step workflow that
    // calls a slow third-party API can legitimately take a while.
    for (let attempt = 0; attempt < 60 && !TERMINAL_RUN_STATES.has(run.status); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, attempt < 10 ? 700 : 2000));
      try {
        run = await api.runs.get(run.id);
        setActiveRun(run);
      } catch {
        // A transient fetch failure shouldn't abandon a run that is still going.
      }
    }

    if (!TERMINAL_RUN_STATES.has(run.status)) {
      setRunError(
        `The run is still ${run.status} after 90s. It may still finish — check Runs & activity.`,
      );
    }
    setLatestRun(run);
    setActivityRefresh((value) => value + 1);
  }, [workflow.id]);

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
            <Background gap={24} size={1.2} color="var(--line)" />
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
              <button className="secondary-button small-button" onClick={saveWorkflow} disabled={saved || saving}>
                {saving ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />}
                {saving ? "Saving…" : "Save"}
              </button>
              {saveError && <span style={{ color: "var(--danger)", fontSize: 12, marginLeft: 8 }}>{saveError}</span>}
            </Panel>
          </ReactFlow>
          <div className="canvas-legend"><span><b className="legend-dot reasoning" />AI-assisted</span><span><b className="legend-dot deterministic" />Fixed rule</span><span><b className="legend-dot approval" />Human approval</span></div>
        </div>
        <aside className="configuration-panel">
          {selected ? <StepConfiguration
            node={selected}
            stepRun={stepRunFor(selected.id)}
            runStatus={runForSteps?.status ?? null}
            onClose={() => setSelected(null)}
            onChange={(label) => { setNodes((cur) => cur.map((n) => n.id === selected.id ? { ...n, data: { ...n.data, label } } : n)); setSelected((cur) => cur ? { ...cur, data: { ...cur.data, label } } : null); setSaved(false); }}
            onRawChange={(raw) => { setNodes((cur) => cur.map((n) => n.id === selected.id ? { ...n, data: { ...n.data, raw } } : n)); setSelected((cur) => cur ? { ...cur, data: { ...cur.data, raw } } : null); setSaved(false); }}
          /> : <div className="panel-empty"><ListChecks size={28} /><h3>Select a step</h3><p>Choose a step on the canvas to review its purpose and what it did on the last run.</p></div>}
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

/** Render a value as readable JSON, truncated so a huge payload cannot wedge the panel. */
function formatData(value: unknown, limit = 4000): string {
  if (value === null || value === undefined) return "";
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return text.length > limit ? `${text.slice(0, limit)}\n… truncated` : text;
}

const DATA_BLOCK: React.CSSProperties = {
  margin: 0,
  padding: "9px 10px",
  borderRadius: 8,
  background: "var(--canvas)",
  border: "1px solid var(--line)",
  color: "var(--ink)",
  fontFamily: "var(--font-geist-mono, monospace)",
  fontSize: 10,
  lineHeight: 1.5,
  maxHeight: 260,
  overflow: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

/**
 * What this step produced on the most recent run.
 *
 * This is the part the panel was missing entirely: it described a step's
 * *intent* in static copy but never showed the tool it called, the arguments it
 * sent, the records it got back, or what the model cost.
 */
function StepActivity({ stepRun, runStatus }: { stepRun: ApiStepRun | null; runStatus: string | null }) {
  if (!stepRun) {
    return (
      <div className="config-section">
        <h3><ActivityIcon size={16} />Last run</h3>
        <p>
          {runStatus
            ? "This step did not run in the most recent execution — an earlier branch or failure stopped before it."
            : "This workflow has not run yet. Press Test safely to execute it and see the data each step produces."}
        </p>
      </div>
    );
  }

  const tool = stepRun.tool_usage ?? {};
  const model = stepRun.model_usage ?? {};
  const invoked = tool.invoked === true;
  const failed = stepRun.status !== "completed";

  return (
    <>
      <div className="config-section">
        <h3><ActivityIcon size={16} />What it did on the last run</h3>
        <p style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <StatusPill status={failed ? "Failed" : "Completed"} />
          {typeof tool.duration_ms === "number" && <span>{tool.duration_ms} ms</span>}
          {typeof model.cost_usd === "number" && model.cost_usd > 0 && (
            <span>${Number(model.cost_usd).toFixed(6)}</span>
          )}
        </p>
        {stepRun.error && (
          <p style={{ color: "var(--danger)", marginTop: 6 }}>{stepRun.error}</p>
        )}
      </div>

      {invoked && (
        <div className="config-section">
          <h3><Cable size={16} />Tool call</h3>
          <p>
            Called <strong>{String(tool.tool_name)}</strong> on{" "}
            <strong>{String(tool.connection_name)}</strong>
            {tool.mode ? ` (${String(tool.mode)}-only)` : ""}.
          </p>
          {Boolean(tool.arguments) && Object.keys((tool.arguments ?? {}) as object).length > 0 && (
            <>
              <span className="form-field" style={{ display: "block", marginTop: 8 }}>Arguments sent</span>
              <pre style={DATA_BLOCK}>{formatData(tool.arguments, 900)}</pre>
            </>
          )}
        </div>
      )}

      {tool.invoked === false && tool.reason && (
        <div className="config-section">
          <h3><Cable size={16} />Tool call</h3>
          <p>No tool was called ({String(tool.reason).replace(/_/g, " ")}). Pick a connection and a tool for this step.</p>
        </div>
      )}

      {Object.keys(model).length > 0 && (
        <div className="config-section">
          <h3><Bot size={16} />Model</h3>
          <p>
            {String(model.provider ?? "unknown")}
            {model.model_id ? ` · ${String(model.model_id)}` : ""}
            {typeof model.input_tokens === "number"
              ? ` · ${model.input_tokens} in / ${model.output_tokens ?? 0} out tokens`
              : ""}
          </p>
          {Array.isArray(model.tools_called) && model.tools_called.length > 0 && (
            <p style={{ marginTop: 4 }}>
              Chose to call: <strong>{(model.tools_called as string[]).join(", ")}</strong>
            </p>
          )}
          {model.degraded === true && (
            <p style={{ color: "var(--danger)", marginTop: 4 }}>
              Ran without a real model — credentials are not configured.
            </p>
          )}
        </div>
      )}

      <div className="config-section">
        <h3><Database size={16} />Data it produced</h3>
        <pre style={DATA_BLOCK}>{formatData(stepRun.output_data) || "(no output)"}</pre>
      </div>

      <details className="config-section" style={{ cursor: "pointer" }}>
        <summary style={{ fontSize: 11, fontWeight: 650, color: "var(--muted)" }}>
          Data it received
        </summary>
        <pre style={{ ...DATA_BLOCK, marginTop: 8 }}>
          {formatData(stepRun.input_data) || "(no input)"}
        </pre>
      </details>
    </>
  );
}

/**
 * Bind a `tool`-type step to a real connection + tool.
 *
 * Before this existed, a tool step's connection/tool could only ever be set at
 * creation time (by the NL compiler or a template) — there was no way to look
 * at "Fetch Scoro projects" in the builder and actually point it at Scoro. It
 * would run forever as `not_configured`.
 */
function ToolBinding({ raw, onChange }: { raw: Record<string, unknown>; onChange: (raw: Record<string, unknown>) => void }) {
  const [tools, setTools] = useState<ApiAvailableTool[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.connections.tools()
      .then((t) => { if (!cancelled) setTools(t); })
      .catch((err) => { if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load connections."); });
    return () => { cancelled = true; };
  }, []);

  const connectionId = typeof raw.connection_id === "string" ? raw.connection_id : "";
  const toolName = typeof raw.tool_name === "string" ? raw.tool_name : "";
  const argsText = raw.arguments && typeof raw.arguments === "object"
    ? JSON.stringify(raw.arguments, null, 2)
    : "{}";
  const [argsDraft, setArgsDraft] = useState(argsText);
  const [argsError, setArgsError] = useState<string | null>(null);

  const byConnection = new Map<string, { name: string; tools: ApiAvailableTool[] }>();
  for (const t of tools ?? []) {
    const entry = byConnection.get(t.connection_id) ?? { name: t.connection_name, tools: [] };
    entry.tools.push(t);
    byConnection.set(t.connection_id, entry);
  }
  const selectedTool = (tools ?? []).find((t) => t.connection_id === connectionId && t.tool_name === toolName);

  const applyArgs = () => {
    try {
      const parsed = argsText.trim() ? JSON.parse(argsDraft) : {};
      setArgsError(null);
      onChange({ ...raw, arguments: parsed });
    } catch {
      setArgsError("Not valid JSON — using the last saved value instead.");
    }
  };

  return (
    <div className="config-section">
      <h3><Cable size={16} />Connect to a tool</h3>
      {loadError && <p style={{ color: "var(--danger)" }}>{loadError}</p>}
      {!loadError && tools === null && <p>Loading your connections…</p>}
      {!loadError && tools !== null && tools.length === 0 && (
        <p>No connections yet. Add one on the <strong>Connections</strong> page, then come back here.</p>
      )}
      {!loadError && tools !== null && tools.length > 0 && (
        <>
          <label className="form-field">
            <span>Connection</span>
            <select
              className="select-field"
              value={connectionId}
              onChange={(e) => onChange({ ...raw, connection_id: e.target.value, tool_name: "" })}
            >
              <option value="">Not connected</option>
              {[...byConnection.entries()].map(([id, entry]) => (
                <option key={id} value={id}>{entry.name}</option>
              ))}
            </select>
          </label>
          {connectionId && (
            <label className="form-field">
              <span>Tool</span>
              <select
                className="select-field"
                value={toolName}
                onChange={(e) => onChange({ ...raw, tool_name: e.target.value, mode: "read" })}
              >
                <option value="">Choose a tool…</option>
                {(byConnection.get(connectionId)?.tools ?? []).map((t) => (
                  <option key={t.tool_name} value={t.tool_name} disabled={!t.read_only}>
                    {t.tool_name}{t.read_only ? "" : " (write — blocked, read-only mode)"}
                  </option>
                ))}
              </select>
            </label>
          )}
          {selectedTool && (
            <>
              <p style={{ color: "var(--muted)", fontSize: 11 }}>{selectedTool.description}</p>
              <label className="form-field">
                <span>Arguments (JSON — use {"{{stepId.field}}"} to reference an earlier step)</span>
                <textarea
                  className="select-field"
                  style={{ fontFamily: "monospace", fontSize: 11, minHeight: 80, resize: "vertical" }}
                  value={argsDraft}
                  onChange={(e) => setArgsDraft(e.target.value)}
                  onBlur={applyArgs}
                />
              </label>
              {argsError && <p style={{ color: "var(--danger)", fontSize: 11 }}>{argsError}</p>}
            </>
          )}
        </>
      )}
    </div>
  );
}

function StepConfiguration({ node, stepRun, runStatus, onClose, onChange, onRawChange }: {
  node: FlowNode;
  stepRun: ApiStepRun | null;
  runStatus: string | null;
  onClose: () => void;
  onChange: (label: string) => void;
  onRawChange: (raw: Record<string, unknown>) => void;
}) {
  return <>
    <div className="config-head"><div className={`config-icon config-${node.data.stepType}`}>{stepIcon(node.data.stepType, 18)}</div><div><small>{labelForStep(node.data.stepType)}</small><h2>{node.data.label}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close step settings"><X size={17} /></button></div>
    <div className="config-body">
      <label className="form-field"><span>Step name</span><input value={node.data.label} onChange={(e) => onChange(e.target.value)} /></label>
      <div className="form-field"><span>What happens here</span><p className="read-only-field">{node.data.summary}</p></div>

      <StepActivity stepRun={stepRun} runStatus={runStatus} />

      {node.data.stepType === "tool" && <ToolBinding raw={node.data.raw ?? {}} onChange={onRawChange} />}
      {node.data.stepType === "ai_task" && <div className="config-section"><h3><Bot size={16} />How WorkPilot helps</h3><p>A model reads this step&apos;s input and returns a structured result. It may call read-only tools on your connected systems, and cannot modify any external record.</p><span className="safety-chip"><ShieldCheck size={14} />Structured result required</span></div>}
      {node.data.stepType === "approval" && <><label className="form-field"><span>Who reviews it?</span><button className="select-field">Account manager <ChevronDown size={15} /></button></label><div className="config-section approval-rule"><h3><LockKeyhole size={16} />Approval rule</h3><p>The workflow pauses here. Later actions cannot run until the assigned reviewer approves.</p></div></>}
      <div className="config-section"><h3><AlertTriangle size={16} />If this step fails</h3><p>The run stops and records the error. Nothing further executes.</p></div>
    </div>
    <div className="config-footer"><button className="danger-link">Remove step</button><button className="primary-button" onClick={onClose}>Done</button></div>
  </>;
}

function Explanation({ workflow }: { workflow: WorkflowSummary }) {
  const detail = workflow.explanationDetail;
  if (!detail) {
    return <div className="explanation-page"><div className="explanation-main"><div className="explanation-hero"><span><MessageSquareText size={22} /></span><div><p className="eyebrow">In plain language</p><h2>What this workflow does</h2><p>{workflow.description}</p></div></div></div></div>;
  }
  return (
    <div className="explanation-page">
      <div className="explanation-main">
        <div className="explanation-hero">
          <span><MessageSquareText size={22} /></span>
          <div><p className="eyebrow">In plain language</p><h2>What this workflow does</h2><p>{detail.summary}</p></div>
        </div>
        <div className="explanation-sections">
          <section><span>1</span><div><h3>What starts it</h3><p>{detail.trigger}</p></div></section>
          {detail.steps.map((step, index) => (
            <section key={step.step_id}>
              <span>{index + 2}</span>
              <div><h3>{step.name}</h3><p>{step.detail}</p>{step.binding && <small className="safety-chip"><Cable size={13} />{step.binding}</small>}</div>
            </section>
          ))}
          <section><span>{detail.steps.length + 2}</span><div><h3>When something goes wrong</h3><p>{detail.on_failure}</p></div></section>
        </div>
      </div>
      <aside className="explanation-aside">
        <h3>Safeguards</h3>
        {detail.safeguards.map((safeguard) => <div key={safeguard}><ShieldCheck size={17} /><span><strong>{safeguard}</strong></span></div>)}
        <div><Hand size={17} /><span><strong>Human control</strong><small>{detail.approval}</small></span></div>
        <hr />
        <h3>Observed usage</h3>
        <p className="estimate"><strong>{detail.cost.headline}</strong><small>{detail.cost.caption}</small></p>
        {detail.cost.average_tokens !== null && <p className="estimate"><strong>{detail.cost.average_tokens.toLocaleString()}</strong><small>average tokens per completed run</small></p>}
      </aside>
    </div>
  );
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
        <div className="empty-state"><History size={24} /><h3>No runs yet</h3><p>Click &quot;Test safely&quot; to trigger your first run.</p></div>
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
