import type { Metadata } from "next";
import { workflows } from "../../lib/demo-data";
import { WorkflowList } from "./WorkflowList";

export const metadata: Metadata = { title: "Workflows" };

export default function WorkflowsPage() {
  return <div className="page"><WorkflowList initialWorkflows={workflows} /></div>;
}
