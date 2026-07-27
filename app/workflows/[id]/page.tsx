import type { Metadata } from "next";
import { workflows } from "../../../lib/demo-data";
import { configuredControlPlaneUrl } from "../../../lib/api-base";
import { WorkflowDetailLoader } from "./WorkflowDetailLoader";

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const workflow = workflows.find((item) => item.id === id);
  return { title: workflow?.name ?? "Workflow" };
}

export default async function WorkflowDetailPage({ params }: PageProps) {
  const { id } = await params;
  const fallback = configuredControlPlaneUrl()
    ? undefined
    : workflows.find((item) => item.id === id);
  return (
    <div className="page">
      <WorkflowDetailLoader id={id} fallback={fallback} />
    </div>
  );
}
