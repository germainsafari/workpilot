import { formatDuration, formatRelativeTime, runWorkflowLabel, type ApiRun, type ApiWorkflow } from "./api";

export type AppNotification = {
  id: string;
  title: string;
  body: string;
  time: string;
  href?: string;
};

/** Build notification items from recent runs (API returns newest first). */
export function notificationsFromRuns(runs: ApiRun[], workflows: ApiWorkflow[]): AppNotification[] {
  const items: AppNotification[] = [];

  for (const run of runs) {
    const name = runWorkflowLabel(run, workflows);
    if (run.status === "completed") {
      items.push({
        id: run.id,
        title: "Run completed",
        body: `${name} finished in ${formatDuration(run.started_at, run.finished_at)}`,
        time: formatRelativeTime(run.started_at),
        href: `/workflows/${run.workflow_id}`,
      });
    } else if (run.status === "failed") {
      items.push({
        id: run.id,
        title: "Run failed",
        body: run.error_summary ?? `${name} encountered an error`,
        time: formatRelativeTime(run.started_at),
        href: "/runs",
      });
    } else if (run.status === "running" || run.status === "queued") {
      items.push({
        id: run.id,
        title: "Run in progress",
        body: `${name} is still running`,
        time: formatRelativeTime(run.started_at),
        href: `/workflows/${run.workflow_id}`,
      });
    }
    if (items.length >= 5) break;
  }

  return items;
}

export function pendingApprovalCount(runs: ApiRun[]): number {
  return runs.filter((run) => run.status === "queued" || run.status === "running").length;
}
