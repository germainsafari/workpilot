// Offline demo executor for the D1-backed Worker API
// (app/v1/workflows/[id]/runs). It has NO tool execution and NO model: it exists
// only so the UI can be demonstrated with zero external dependencies.
//
// IMPORTANT — this is not the real executor. Tool calls against connected
// systems, encrypted credentials, MCP, and the read-only write policy all live
// in the FastAPI service (apps/api/app/executor.py + tool_invoker.py). To run
// actual workflows, point the UI at that service with
// NEXT_PUBLIC_CONTROL_PLANE_URL; when that variable is unset the UI falls back
// to these same-origin routes and nothing real can execute.
//
// Every output below is explicitly labelled `simulated: true` so a caller cannot
// mistake it for a real result. A previous version reported
// `mode: "live", recordsChanged: 1` for a tool step while performing no work at
// all, which made this path actively misleading.

export type ExecutableStep = {
  id: string;
  name: string;
  type: "ai_task" | "tool" | "condition" | "wait" | "end";
  operation?: string;
  dryRun?: boolean;
  durationSeconds?: number;
  condition?: { field: string; equals: unknown };
};

export type StepExecution = {
  stepId: string;
  status: "completed" | "skipped";
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  modelUsage: Record<string, unknown>;
  toolUsage: Record<string, unknown>;
};

function mockOrganizeBrief(input: Record<string, unknown>): Record<string, unknown> {
  const client = typeof input.client === "string" ? input.client : "Sample client";
  const deadline = typeof input.deadline === "string" ? input.deadline : null;
  return {
    client,
    projectType: typeof input.projectType === "string" ? input.projectType : "Campaign delivery",
    deliverables: Array.isArray(input.deliverables) ? input.deliverables : ["Campaign concept", "Launch assets"],
    deadline,
    markets: Array.isArray(input.markets) ? input.markets : ["Poland", "Germany"],
    missingDetails: deadline ? [] : ["deadline"],
    reasoningSummary: deadline ? "The sample brief includes all required delivery fields." : "A delivery date is required before project tasks can be prepared.",
  };
}

export async function executeNativeWorkflow(steps: ExecutableStep[], initialInput: Record<string, unknown>): Promise<StepExecution[]> {
  const executions: StepExecution[] = [];
  let context = { ...initialInput };

  for (const step of steps) {
    let output: Record<string, unknown> = {};
    let modelUsage: Record<string, unknown> = {};
    let toolUsage: Record<string, unknown> = {};
    let status: StepExecution["status"] = "completed";

    if (step.type === "ai_task") {
      output = {
        ...mockOrganizeBrief(context),
        simulated: true,
        warning: "Demo output. No model was called — this deployment has no AI backend configured.",
      };
      modelUsage = { provider: "deterministic_mock", inputUnits: 0, outputUnits: 0, costUsd: 0, degraded: true };
    } else if (step.type === "condition") {
      const actual = step.condition?.field === "missing_details" ? ((context.missingDetails as unknown[] | undefined)?.length ?? 0) > 0 : context[step.condition?.field ?? ""];
      output = { matched: actual === step.condition?.equals, actual, expected: step.condition?.equals };
    } else if (step.type === "wait") {
      output = { waitedSeconds: Math.max(0, Math.min(step.durationSeconds ?? 0, 1)), simulated: true };
    } else if (step.type === "tool") {
      // No tool was called. Say so — do not claim a live write or a changed
      // record, because nothing here can reach an external system.
      output = {
        status: "not_executed",
        operation: step.operation ?? "unknown",
        simulated: true,
        recordsChanged: 0,
        message:
          "This deployment cannot call external tools. Connect the FastAPI control plane " +
          "(NEXT_PUBLIC_CONTROL_PLANE_URL) to run this step against a real system.",
      };
      toolUsage = { invoked: false, reason: "d1_demo_executor_has_no_tool_support" };
    } else if (step.type === "end") {
      output = { outcome: "completed" };
    } else {
      status = "skipped";
    }

    executions.push({ stepId: step.id, status, input: context, output, modelUsage, toolUsage });
    context = { ...context, ...output };
  }

  return executions;
}
