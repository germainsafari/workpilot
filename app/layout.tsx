import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { AppShell } from "./components/AppShell";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  const description = "Describe a process, connect your tools, approve the plan, and let WorkPilot operate it safely.";
  return {
    metadataBase: base,
    title: {
      default: "WorkPilot — AI operations, under your control",
      template: "%s · WorkPilot",
    },
    description,
    openGraph: {
      type: "website",
      title: "WorkPilot — AI operations, under your control",
      description,
      images: [{ url: new URL("/og.png", base).toString(), width: 1734, height: 907, alt: "WorkPilot workflow with a human approval checkpoint" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "WorkPilot — AI operations, under your control",
      description,
      images: [new URL("/og.png", base).toString()],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
