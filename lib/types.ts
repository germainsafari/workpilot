export type WorkflowStatus = "active" | "draft" | "paused";
export type RiskLevel = "low" | "medium" | "high";
export type StepType = "trigger" | "tool" | "ai_task" | "condition" | "wait" | "approval" | "end";

export interface WorkflowStep {
  id: string;
  name: string;
  type: StepType;
  summary: string;
  position: { x: number; y: number };
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
