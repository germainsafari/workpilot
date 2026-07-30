import type { Metadata } from "next";
import { LoginPage } from "./LoginPage";

export const metadata: Metadata = { title: "Sign in" };

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  return <LoginPage reason={reason} />;
}
