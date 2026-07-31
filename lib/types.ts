// Presentation-layer types for the UI. These describe the richer shape the
// React components render (including canvas x/y positions and marketing-style
// metrics), which is a superset of what the backend API returns. The mapping
// from the API's canonical shape to these types lives in WorkflowList.tsx.

export type WorkflowStatus = "active" | "draft" | "paused";
export type RiskLevel = "low" | "medium" | "high";
export type StepType = "trigger" | "tool" | "ai_task" | "condition" | "wait" | "approval" | "end";

export interface WorkflowStep {
  id: string;
  name: string;
  type: StepType;
  summary: string;
  position: { x: number; y: number };
  /**
   * Every field the backend's canonical step carries beyond id/name/type —
   * `operation`, `connection_id`, `tool_name`, `arguments`, `mode`, `task`,
   * `output_schema`, condition/wait/end fields. The editor used to discard all
   * of this on read, so saving a workflow back would have silently erased any
   * tool binding a step already had. Passed straight through, untyped, because
   * the canonical shape is a discriminated union owned by the backend.
   */
  raw?: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface WorkflowDefinition {
  apiVersion: "workpilot.io/v1";
  kind: "Workflow";
  trigger: { type: string; label: string };
  steps: WorkflowStep[];
  edges: WorkflowEdge[];
}

export interface WorkflowSummary {
  id: string;
  name: string;
  description: string;
  department: string;
  owner: string;
  status: WorkflowStatus;
  riskLevel: RiskLevel;
  trigger: string;
  runsThisMonth: number;
  successRate: number;
  timeSavedHours: number;
  lastRun: string;
  definition: WorkflowDefinition;
  explanationDetail?: import("./api").ApiWorkflowExplanation;
}

export interface RunRecord {
  id: string;
  workflowId: string;
  workflowName: string;
  status: "completed" | "running" | "waiting" | "failed";
  startedAt: string;
  duration: string;
  trigger: string;
  cost: number;
  stepsCompleted: number;
  stepsTotal: number;
}
