import type { ApiWorkflowDetail } from "./api";

export interface CanonicalDefinition {
  apiVersion: "workpilot.io/v1";
  kind: "Workflow";
  trigger: { type: string; label: string };
  steps: Array<Record<string, unknown>>;
  edges: Array<{ from: string; to: string; label?: string }>;
}

export function deriveWorkflowName(description: string): string {
  const first = description.trim().split(/[.!?\n]/)[0]?.trim() ?? "New workflow";
  const name = first.length <= 80 ? first : `${first.slice(0, 77)}…`;
  // API accepts up to 180 characters; keep a safety margin after ellipsis handling.
  return name.length <= 180 ? name : `${name.slice(0, 177)}…`;
}

export function buildDefinitionFromDescription(description: string): CanonicalDefinition {
  const lower = description.toLowerCase();

  if (lower.includes("scoro") || (lower.includes("project") && lower.includes("review"))) {
    return {
      apiVersion: "workpilot.io/v1",
      kind: "Workflow",
      trigger: { type: "manual", label: "Run Scoro project review" },
      steps: [
        {
          id: "fetchProjects",
          name: "Fetch Scoro projects",
          type: "tool",
          operation: "prepare_tasks",
          dry_run: true,
        },
        {
          id: "summarize",
          name: "Summarize and flag risks",
          type: "ai_task",
          task: "summarize",
        },
        {
          id: "finish",
          name: "Review complete",
          type: "end",
          outcome: "completed",
        },
      ],
      edges: [
        { from: "fetchProjects", to: "summarize" },
        { from: "summarize", to: "finish" },
      ],
    };
  }

  if (lower.includes("weather")) {
    const wantsNotification =
      lower.includes("notif") || lower.includes("alert") || lower.includes("send me");
    const steps: CanonicalDefinition["steps"] = [
      {
        id: "checkWeather",
        name: "Check the weather",
        type: "tool",
        operation: "prepare_tasks",
        dry_run: true,
      },
      {
        id: "summarize",
        name: "Summarize conditions",
        type: "ai_task",
        task: "summarize",
      },
    ];
    const edges: CanonicalDefinition["edges"] = [{ from: "checkWeather", to: "summarize" }];
    if (wantsNotification) {
      steps.push({
        id: "notify",
        name: "Send notification",
        type: "tool",
        operation: "prepare_message",
        dry_run: true,
      });
      edges.push({ from: "summarize", to: "notify" });
    }
    steps.push({
      id: "finish",
      name: wantsNotification ? "Notification prepared" : "Weather summary ready",
      type: "end",
      outcome: "completed",
    });
    edges.push({ from: wantsNotification ? "notify" : "summarize", to: "finish" });

    return {
      apiVersion: "workpilot.io/v1",
      kind: "Workflow",
      trigger: { type: "schedule", label: "Scheduled weather check" },
      steps,
      edges,
    };
  }

  if (lower.includes("notif") || lower.includes("alert") || lower.includes("send me")) {
    return {
      apiVersion: "workpilot.io/v1",
      kind: "Workflow",
      trigger: { type: "manual", label: "Manual start" },
      steps: [
        {
          id: "prepare",
          name: "Prepare the update",
          type: "ai_task",
          task: "prepare",
        },
        {
          id: "notify",
          name: "Send notification",
          type: "tool",
          operation: "prepare_message",
          dry_run: true,
        },
        {
          id: "finish",
          name: "Notification prepared",
          type: "end",
          outcome: "completed",
        },
      ],
      edges: [
        { from: "prepare", to: "notify" },
        { from: "notify", to: "finish" },
      ],
    };
  }

  return {
    apiVersion: "workpilot.io/v1",
    kind: "Workflow",
    trigger: { type: "manual", label: "Manual start" },
    steps: [
      {
        id: "process",
        name: "Process the request",
        type: "ai_task",
        task: "prepare",
      },
      {
        id: "finish",
        name: "Complete",
        type: "end",
        outcome: "completed",
      },
    ],
    edges: [{ from: "process", to: "finish" }],
  };
}

export function blankDefinition(): CanonicalDefinition {
  return {
    apiVersion: "workpilot.io/v1",
    kind: "Workflow",
    trigger: { type: "manual", label: "Manual start" },
    steps: [{ id: "finish", name: "Finish", type: "end", outcome: "completed" }],
    edges: [],
  };
}

export function templateDefinition(templateName: string): CanonicalDefinition {
  const key = templateName.toLowerCase();
  if (key.includes("meeting")) {
    return buildDefinitionFromDescription("Summarize meeting transcript and prepare follow-up actions");
  }
  if (key.includes("invoice") || key.includes("finance")) {
    return {
      apiVersion: "workpilot.io/v1",
      kind: "Workflow",
      trigger: { type: "schedule", label: "Billing cycle ends" },
      steps: [
        { id: "collect", name: "Collect billable items", type: "tool", operation: "prepare_tasks", dry_run: true },
        { id: "review", name: "Prepare finance review", type: "ai_task", task: "prepare" },
        { id: "finish", name: "Draft ready", type: "end", outcome: "needs_review" },
      ],
      edges: [
        { from: "collect", to: "review" },
        { from: "review", to: "finish" },
      ],
    };
  }
  return buildDefinitionFromDescription(templateName);
}

export function preparedSummary(definition: CanonicalDefinition): { starts: string; work: string; safeguard: string } {
  const hasAi = definition.steps.some((s) => s.type === "ai_task");
  const hasTool = definition.steps.some((s) => s.type === "tool");
  return {
    starts: definition.trigger.label,
    work: hasTool && hasAi
      ? "Fetch data, then analyze"
      : hasAi
        ? "AI-assisted processing"
        : "Business actions",
    safeguard: "Safe test mode — no live writes",
  };
}

export function countBusinessSteps(definition: CanonicalDefinition): number {
  return definition.steps.filter((s) => s.type !== "end").length;
}

/** Map API workflow detail to editor-ready shape (positions + trigger node). */
export function apiDetailToEditorDefinition(detail: ApiWorkflowDetail) {
  const steps = detail.definition.steps;
  const uiSteps = [
    {
      id: "trigger",
      name: detail.definition.trigger.label,
      type: "trigger" as const,
      summary: `Starts when: ${detail.definition.trigger.label}`,
      position: { x: 30, y: 150 },
    },
    ...steps.map((step, index) => ({
      id: step.id,
      name: step.name,
      type: (step.type === "end" ? "end" : step.type) as "tool" | "ai_task" | "condition" | "wait" | "end",
      summary:
        step.type === "ai_task"
          ? "AI-assisted step — runs in safe test mode."
          : step.type === "tool"
            ? "Calls a connected tool in safe test mode."
            : step.type === "condition"
              ? "Branches the workflow based on a rule."
              : step.type === "wait"
                ? "Pauses until a condition is met."
                : "Workflow complete.",
      position: { x: 280 + index * 260, y: 150 },
      // Preserve everything the backend sent (connection_id, tool_name,
      // arguments, task, mode, …) so a later save doesn't erase it.
      raw: step,
    })),
  ];

  const edges = [
    ...(steps.length > 0 ? [{ id: "e-trigger", source: "trigger", target: steps[0].id }] : []),
    ...detail.definition.edges.map((edge, index) => ({
      id: `e${index + 1}`,
      source: edge.from,
      target: edge.to,
      label: edge.label ?? undefined,
    })),
  ];

  return { steps: uiSteps, edges };
}

/** Minimal, schema-valid defaults for a step type with no prior canonical data. */
function defaultRawStep(type: string): Record<string, unknown> {
  switch (type) {
    case "tool":
      // connection_id/tool_name deliberately absent: the executor reports
      // "not_configured" for an unbound tool step rather than faking success,
      // so an unbound step is safe to save and run.
      return { type: "tool", operation: "fetch_records", mode: "read", dry_run: true };
    case "ai_task":
      return { type: "ai_task", task: "extract" };
    case "condition":
      return { type: "condition", field: "status", operator: "equals", value: null };
    case "wait":
      return { type: "wait", duration_seconds: 0 };
    case "end":
      return { type: "end", outcome: "completed" };
    default:
      // "approval" is a builder-only concept the backend schema has no type
      // for (only ai_task | tool | condition | wait | end exist) — save it as
      // a wait step, the closest real analog to "pause here".
      return { type: "wait", duration_seconds: 0 };
  }
}

export interface EditorFlowNode {
  id: string;
  data: { label: string; summary: string; stepType: string; raw?: Record<string, unknown> };
}

export interface EditorFlowEdge {
  source: string;
  target: string;
  // React Flow's own Edge.label is ReactNode | null; only a plain string is
  // ever meaningful here, so anything else is treated as "no label".
  label?: unknown;
}

/**
 * Reverse of {@link apiDetailToEditorDefinition}: turn what the builder has on
 * screen back into the canonical shape `PUT /v1/workflows/{id}/definition`
 * expects. Drops the synthetic "trigger" node the editor overlays for display
 * — the canonical schema has no step for it — and rewires any edge that
 * pointed at it onto the first real step instead.
 */
export function editorDefinitionToApi(
  nodes: EditorFlowNode[],
  edges: EditorFlowEdge[],
  trigger: { type: string; label: string },
): CanonicalDefinition {
  const realNodes = nodes.filter((n) => n.id !== "trigger");
  const firstRealId = realNodes[0]?.id;

  const steps = realNodes.map((n) => {
    const base = n.data.raw ? { ...n.data.raw } : defaultRawStep(n.data.stepType);
    return { ...base, id: n.id, name: n.data.label };
  });

  const seen = new Set<string>();
  const outEdges: Array<{ from: string; to: string; label?: string }> = [];
  for (const e of edges) {
    const from = e.source === "trigger" ? firstRealId : e.source;
    const to = e.target === "trigger" ? firstRealId : e.target;
    if (!from || !to || from === to) continue;
    const key = `${from}->${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = typeof e.label === "string" ? e.label : undefined;
    outEdges.push(label ? { from, to, label } : { from, to });
  }

  return {
    apiVersion: "workpilot.io/v1",
    kind: "Workflow",
    trigger,
    steps,
    edges: outEdges,
  };
}
