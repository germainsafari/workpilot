import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { workflows } from "../../../lib/demo-data";
import { WorkflowEditor } from "./WorkflowEditor";

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const workflow = workflows.find((item) => item.id === id);
  return { title: workflow?.name ?? "Workflow" };
}

export default async function WorkflowDetailPage({ params }: PageProps) {
  const { id } = await params;
  const workflow = workflows.find((item) => item.id === id);
  if (!workflow) notFound();
  return <WorkflowEditor workflow={workflow} />;
}
