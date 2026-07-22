import type { Metadata } from "next";
import { NewWorkflow } from "./NewWorkflow";

export const metadata: Metadata = { title: "Create workflow" };

export default function NewWorkflowPage() {
  return <div className="page"><NewWorkflow /></div>;
}
