import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SectionPage } from "./SectionPage";

const sections = new Set(["templates", "runs", "approvals", "connections", "team", "analytics", "settings", "help"]);
const labels: Record<string, string> = { templates: "Templates", runs: "Runs", approvals: "Approvals", connections: "Connections", team: "Team", analytics: "Analytics", settings: "Settings", help: "Help centre" };

type PageProps = { params: Promise<{ section: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { section } = await params;
  return { title: labels[section] ?? "WorkPilot" };
}

export default async function GenericSectionPage({ params }: PageProps) {
  const { section } = await params;
  if (!sections.has(section)) notFound();
  return <SectionPage section={section} />;
}
