// TypeScript twin of the Python NativeExecutor (apps/api/app/executor.py).
// It runs inside the Cloudflare Worker so the D1-backed demo API
// (app/v1/workflows/[id]/runs) can execute a workflow with zero external
// dependencies. Like the Python version it is deterministic and never performs
// live external writes (tool steps default to dry-run).

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
      output = mockOrganizeBrief(context);
      modelUsage = { provider: "deterministic_mock", inputUnits: 0, outputUnits: 0, costUsd: 0 };
    } else if (step.type === "condition") {
      const actual = step.condition?.field === "missing_details" ? ((context.missingDetails as unknown[] | undefined)?.length ?? 0) > 0 : context[step.condition?.field ?? ""];
      output = { matched: actual === step.condition?.equals, actual, expected: step.condition?.equals };
    } else if (step.type === "wait") {
      output = { waitedSeconds: Math.max(0, Math.min(step.durationSeconds ?? 0, 1)), simulated: true };
    } else if (step.type === "tool") {
      output = { prepared: true, operation: step.operation ?? "safe_operation", mode: step.dryRun === false ? "live" : "dry_run", recordsChanged: step.dryRun === false ? 1 : 0 };
      toolUsage = { operation: step.operation ?? "safe_operation", dryRun: step.dryRun !== false, idempotent: true };
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
