import type {
  ApiCompileResponse,
  ApiWorkspace,
  ApiWorkspaceSettings,
} from "./api";
import { buildDefinitionFromDescription } from "./workflow-draft";

export const DEMO_WORKSPACE: ApiWorkspace = {
  id: "tenant-northstar",
  name: "Northstar Projects",
  slug: "northstar-projects",
  plan: "demo",
  data_region: "eu-central-1",
  member_count: 5,
  workflow_count: 1,
};

export const DEMO_WORKSPACE_SETTINGS: ApiWorkspaceSettings = {
  allow_tool_writes: false,
  require_approval_for_writes: true,
  max_run_cost_usd: 1,
  data_region: "eu-central-1",
  notify_on_run_failure: true,
  notify_on_approval_needed: true,
  notify_email: "",
  retain_run_days: 90,
};

export function isMissingEndpointError(error: unknown): boolean {
  return error instanceof Error && /API (404|405)/.test(error.message);
}

export function localCompileFallback(description: string): ApiCompileResponse {
  return {
    definition: buildDefinitionFromDescription(description),
    rationale:
      "Prepared a safe local draft because this deployment does not expose the workflow compiler yet.",
    ai_compiled: false,
    compile_error: "Compiler endpoint unavailable on the connected API.",
    bound_tools: [],
    dropped_bindings: [],
    catalog_size: 0,
  };
}
