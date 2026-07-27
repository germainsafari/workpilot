import type { ApiRun } from "./api";
import { formatRelativeTime, parseApiDate } from "./api";
import type { WorkflowSummary } from "./types";

export interface WorkflowRunStats {
  runsThisMonth: number;
  successRate: number;
  timeSavedHours: number;
  lastRun: string;
}

const EMPTY_STATS: WorkflowRunStats = {
  runsThisMonth: 0,
  successRate: 0,
  timeSavedHours: 0,
  lastRun: "Not run yet",
};

export function runsForWorkflow(runs: ApiRun[], workflowId: string): ApiRun[] {
  return runs.filter((run) => run.workflow_id === workflowId);
}

export function computeWorkflowRunStats(runs: ApiRun[]): WorkflowRunStats {
  if (runs.length === 0) return EMPTY_STATS;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const runsThisMonth = runs.filter((run) => parseApiDate(run.started_at) >= monthStart).length;
  const completed = runs.filter((run) => run.status === "completed").length;
  const successRate = Math.round((completed / runs.length) * 1000) / 10;

  const durationMs = runs
    .filter((run) => run.finished_at)
    .map((run) => parseApiDate(run.finished_at!).getTime() - parseApiDate(run.started_at).getTime());
  const timeSavedHours = durationMs.length
    ? Math.round((durationMs.reduce((sum, ms) => sum + ms, 0) / 3_600_000) * 10) / 10
    : 0;

  const latest = runs.reduce((a, b) =>
    parseApiDate(a.started_at) > parseApiDate(b.started_at) ? a : b,
  );

  return {
    runsThisMonth,
    successRate,
    timeSavedHours,
    lastRun: formatRelativeTime(latest.started_at),
  };
}

export function enrichWorkflowSummaries(
  workflows: WorkflowSummary[],
  runs: ApiRun[],
): WorkflowSummary[] {
  return workflows.map((workflow) => ({
    ...workflow,
    ...computeWorkflowRunStats(runsForWorkflow(runs, workflow.id)),
  }));
}

export function runsToday(runs: ApiRun[]): ApiRun[] {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return runs.filter((run) => parseApiDate(run.started_at) >= start);
}

export function dailyRunCounts(runs: ApiRun[], days = 14): number[] {
  const counts = Array.from({ length: days }, () => 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const run of runs) {
    const day = parseApiDate(run.started_at);
    day.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((today.getTime() - day.getTime()) / 86_400_000);
    if (diffDays >= 0 && diffDays < days) {
      counts[days - 1 - diffDays] += 1;
    }
  }

  const peak = Math.max(...counts, 1);
  return counts.map((count) => Math.round((count / peak) * 100));
}

export function totalAutomationHours(runs: ApiRun[]): number {
  const completed = runs.filter((run) => run.status === "completed" && run.finished_at);
  if (completed.length === 0) return 0;
  const totalMs = completed.reduce(
    (sum, run) => sum + parseApiDate(run.finished_at!).getTime() - parseApiDate(run.started_at).getTime(),
    0,
  );
  return Math.round((totalMs / 3_600_000) * 10) / 10;
}

export function workflowTimeSavedRanking(
  runs: ApiRun[],
  workflows: Array<{ id: string; name: string }>,
): Array<{ id: string; name: string; hours: number }> {
  return workflows
    .map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      hours: computeWorkflowRunStats(runsForWorkflow(runs, workflow.id)).timeSavedHours,
    }))
    .filter((item) => item.hours > 0)
    .sort((a, b) => b.hours - a.hours);
}
