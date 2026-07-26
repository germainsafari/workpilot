import type { Metadata } from "next";
import { DashboardClient } from "./DashboardClient";

export const metadata: Metadata = { title: "Dashboard · WorkPilot" };

export default function Home() {
  return <DashboardClient />;
}
