import { type ApiRun, type ApiWorkflow, type ApiWorkflowDetail } from "./api";
import { apiDetailToEditorDefinition } from "./workflow-draft";
import type { WorkflowSummary } from "./types";
import { computeWorkflowRunStats, type WorkflowRunStats } from "./workflow-stats";

const DEFAULT_STATS: WorkflowRunStats = {
  runsThisMonth: 0,
  successRate: 0,
  timeSavedHours: 0,
  lastRun: "Not run yet",
};

export function apiDetailToSummary(detail: ApiWorkflowDetail, runs: ApiRun[] = []): WorkflowSummary {
  const { steps, edges } = apiDetailToEditorDefinition(detail);
  const workflowRuns = runs.filter((run) => run.workflow_id === detail.id);
  const stats = workflowRuns.length > 0 ? computeWorkflowRunStats(workflowRuns) : DEFAULT_STATS;
  return {
    id: detail.id,
    name: detail.name,
    description: detail.description,
    department: detail.department,
    owner: detail.owner_id,
    status: detail.status as WorkflowSummary["status"],
    riskLevel: detail.risk_level as WorkflowSummary["riskLevel"],
    trigger: detail.definition.trigger.label,
    ...stats,
    definition: {
      apiVersion: "workpilot.io/v1",
      kind: "Workflow",
      trigger: detail.definition.trigger,
      steps,
      edges,
    },
  };
}

export function apiWorkflowToSummary(live: ApiWorkflow, runs: ApiRun[] = []): WorkflowSummary {
  const workflowRuns = runs.filter((run) => run.workflow_id === live.id);
  const stats = workflowRuns.length > 0 ? computeWorkflowRunStats(workflowRuns) : DEFAULT_STATS;
  return {
    id: live.id,
    name: live.name,
    description: live.description,
    department: live.department,
    owner: live.owner_id,
    status: live.status as WorkflowSummary["status"],
    riskLevel: live.risk_level as WorkflowSummary["riskLevel"],
    trigger: "Manual",
    ...stats,
    definition: {
      apiVersion: "workpilot.io/v1",
      kind: "Workflow",
      trigger: { type: "manual", label: "Manual start" },
      steps: [],
      edges: [],
    },
  };
}
