import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginPage } from "./LoginPage";

export const metadata: Metadata = { title: "Sign in · WorkPilot" };

export default function Login() {
  return (
    <Suspense>
      <LoginPage />
    </Suspense>
  );
}
