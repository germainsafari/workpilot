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
  CircleStop,
  Clock3,
  CloudUpload,
  CornerDownRight,
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
  const [testing, setTesting] = useState(false);
  const [testStep, setTestStep] = useState(-1);
  const [testComplete, setTestComplete] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const stepSequence = useRef(0);

  const onConnect = useCallback((connection: Connection) => {
    setEdges((current) => addEdge({ ...connection, type: "smoothstep" }, current));
    setSaved(false);
  }, [setEdges]);
  const onSelectionChange = useCallback(({ nodes: selectedNodes }: OnSelectionChangeParams) => setSelected((selectedNodes[0] as FlowNode | undefined) ?? null), []);

  useEffect(() => {
    if (!testing) return;
    const timer = window.setInterval(() => {
      setTestStep((current) => {
        if (current >= 4) {
          window.clearInterval(timer);
          setTesting(false);
          setTestComplete(true);
          return 5;
        }
        return current + 1;
      });
    }, 650);
    return () => window.clearInterval(timer);
  }, [testing]);

  const startTest = () => {
    setTestComplete(false);
    setTestStep(0);
    setTesting(true);
  };

  const addStep = (type: StepType) => {
    stepSequence.current += 1;
    const id = `new-step-${stepSequence.current}`;
    setNodes((current) => [...current, { id, position: { x: 900, y: 450 }, className: `flow-node flow-${type}`, data: { label: labelForStep(type), summary: "Select this step to describe what it should do.", stepType: type } }]);
    setSaved(false);
    setAddOpen(false);
  };

  return (
    <div className="workflow-editor-page">
      <header className="editor-header">
        <div className="editor-title-row">
          <Link href="/workflows" className="icon-button" aria-label="Back to workflows"><ArrowLeft size={18} /></Link>
          <div className="editor-title"><span className="editor-symbol"><WorkflowIcon size={18} /></span><div><div><h1>{workflow.name}</h1><StatusPill status={published ? "active" : "draft"} /></div><p>{saved ? "All changes saved" : "Unsaved changes"} · Version 3</p></div></div>
          <div className="editor-actions">
            <button className="icon-button" aria-label="More workflow options"><MoreHorizontal size={19} /></button>
            <button className="secondary-button" onClick={startTest} disabled={testing}><Play size={16} />{testing ? "Testing…" : "Test safely"}</button>
            <button className={published ? "secondary-button publish-button published" : "primary-button publish-button"} onClick={() => setPublished((value) => !value)}>{published ? <Check size={16} /> : <CloudUpload size={16} />}{published ? "Published" : "Publish"}</button>
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
                <button className="primary-button small-button" onClick={() => setAddOpen((value) => !value)}><Plus size={16} />Add step <ChevronDown size={14} /></button>
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
          {selected ? <StepConfiguration node={selected} onClose={() => setSelected(null)} onChange={(label) => { setNodes((current) => current.map((node) => node.id === selected.id ? { ...node, data: { ...node.data, label } } : node)); setSelected((current) => current ? { ...current, data: { ...current.data, label } } : null); setSaved(false); }} /> : <div className="panel-empty"><ListChecks size={28} /><h3>Select a step</h3><p>Choose a step on the canvas to review its purpose and safeguards.</p></div>}
        </aside>
      </div>}

      {tab === "explain" && <Explanation workflow={workflow} />}
      {tab === "activity" && <Activity />}
      {(testing || testComplete) && <TestDrawer workflow={workflow} activeStep={testStep} complete={testComplete} onClose={() => { setTesting(false); setTestComplete(false); }} />}
    </div>
  );
}

function StepConfiguration({ node, onClose, onChange }: { node: FlowNode; onClose: () => void; onChange: (label: string) => void }) {
  return <>
    <div className="config-head"><div className={`config-icon config-${node.data.stepType}`}>{stepIcon(node.data.stepType, 18)}</div><div><small>{labelForStep(node.data.stepType)}</small><h2>{node.data.label}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close step settings"><X size={17} /></button></div>
    <div className="config-body">
      <label className="form-field"><span>Step name</span><input value={node.data.label} onChange={(event) => onChange(event.target.value)} /></label>
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

function Activity() {
  return <div className="activity-page"><div className="activity-summary"><div><CheckCircle2 size={19} /><span><strong>97.6%</strong><small>completion</small></span></div><div><Clock3 size={19} /><span><strong>1m 42s</strong><small>average duration</small></span></div><div><Sparkles size={19} /><span><strong>$1.62</strong><small>cost this month</small></span></div></div><section className="panel"><div className="panel-heading"><div><p className="section-kicker">Execution history</p><h2>Recent runs</h2></div><button className="secondary-button"><History size={16} />Download audit record</button></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Run</th><th>Status</th><th>Started</th><th>Trigger</th><th>Duration</th><th>Cost</th></tr></thead><tbody>{[["#1048", "completed", "Today, 10:24", "Form submission", "1m 48s", "$0.038"], ["#1046", "waiting", "Today, 09:51", "Email received", "32m", "$0.014"], ["#1039", "completed", "Yesterday, 16:18", "Form submission", "1m 31s", "$0.034"]].map((row) => <tr key={row[0]}><td><strong>{row[0]}</strong></td><td><StatusPill status={row[1]} /></td><td>{row[2]}</td><td>{row[3]}</td><td>{row[4]}</td><td>{row[5]}</td></tr>)}</tbody></table></div></section></div>;
}

function TestDrawer({ workflow, activeStep, complete, onClose }: { workflow: WorkflowSummary; activeStep: number; complete: boolean; onClose: () => void }) {
  const steps = workflow.definition.steps.filter((step) => step.id !== "wait").slice(0, 6);
  return <div className="test-drawer" role="dialog" aria-modal="true" aria-label="Safe test run"><div className="test-head"><div><span className="safe-test-icon"><Play size={17} /></span><div><p>Safe test</p><h2>{complete ? "Test completed" : "Running sample brief"}</h2></div></div><button className="icon-button" onClick={onClose} aria-label="Close test"><X size={18} /></button></div><div className="test-banner"><ShieldCheck size={17} /><p><strong>No live tools are changed.</strong> This run uses sample data and records what would happen.</p></div><div className="test-steps">{steps.map((step, index) => { const running = index === activeStep && !complete; const done = complete || index < activeStep; return <div className={running ? "test-step running" : done ? "test-step done" : "test-step"} key={step.id}><span>{running ? <LoaderCircle className="spin" size={16} /> : done ? <Check size={15} /> : index + 1}</span><div><strong>{step.name}</strong><small>{done ? (step.type === "approval" ? "Approval simulated for demo" : "Completed with sample output") : running ? "Checking sample data…" : "Waiting"}</small></div>{done && <b>{index === 1 ? "$0.008" : "0.1s"}</b>}</div>; })}</div><div className="test-footer">{complete ? <><div className="test-result"><CheckCircle2 size={20} /><span><strong>Ready to publish</strong><small>6 steps passed · Estimated production cost $0.038</small></span></div><button className="primary-button" onClick={onClose}>Review result</button></> : <><p><strong>Step {Math.min(activeStep + 1, 6)} of 6</strong><span>Estimated test cost: $0.00</span></p><button className="secondary-button" onClick={onClose}>Stop test</button></>}</div></div>;
}

export function WorkflowEditor({ workflow }: { workflow: WorkflowSummary }) {
  return <ReactFlowProvider><WorkflowEditorInner workflow={workflow} /></ReactFlowProvider>;
}
