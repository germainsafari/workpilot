import type { Metadata } from "next";
import { configuredControlPlaneUrl } from "../../lib/api-base";
import { workflows as demoWorkflows } from "../../lib/demo-data";
import { WorkflowList } from "./WorkflowList";

export const metadata: Metadata = { title: "Workflows" };

export default function WorkflowsPage() {
  const initialWorkflows = configuredControlPlaneUrl() ? [] : demoWorkflows;
  return <div className="page"><WorkflowList initialWorkflows={initialWorkflows} /></div>;
}
