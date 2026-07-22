"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bell,
  Blocks,
  Cable,
  CheckCheck,
  ChevronsUpDown,
  CircleHelp,
  Gauge,
  Menu,
  PlaySquare,
  Search,
  Settings,
  Users,
  Workflow,
  X,
} from "lucide-react";
import { useState } from "react";
import { Logo } from "./Logo";

const navigation = [
  ["Home", "/", Gauge],
  ["Workflows", "/workflows", Workflow],
  ["Templates", "/templates", Blocks],
  ["Runs", "/runs", PlaySquare],
  ["Approvals", "/approvals", CheckCheck],
  ["Connections", "/connections", Cable],
  ["Team", "/team", Users],
  ["Analytics", "/analytics", BarChart3],
  ["Settings", "/settings", Settings],
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <div className="app-frame">
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="sidebar-head">
          <Link href="/" onClick={() => setOpen(false)}><Logo /></Link>
          <button className="icon-button sidebar-close" onClick={() => setOpen(false)} aria-label="Close navigation"><X size={18} /></button>
        </div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {navigation.map(([label, href, Icon]) => (
            <Link key={label} href={href} className={active(href) ? "nav-link active" : "nav-link"} onClick={() => setOpen(false)}>
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
              {label === "Approvals" && <span className="nav-count">3</span>}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <Link href="/help" className="nav-link"><CircleHelp size={18} /><span>Help centre</span></Link>
          <button className="workspace-switcher">
            <span className="workspace-avatar">NP</span>
            <span><strong>Northstar Projects</strong><small>Demo workspace</small></span>
            <ChevronsUpDown size={15} />
          </button>
        </div>
      </aside>
      {open && <button className="sidebar-backdrop" onClick={() => setOpen(false)} aria-label="Close navigation" />}
      <div className="app-content">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setOpen(true)} aria-label="Open navigation"><Menu size={20} /></button>
          <div className="global-search"><Search size={17} /><input aria-label="Search WorkPilot" placeholder="Search workflows, runs, people…" /></div>
          <div className="topbar-actions">
            <span className="demo-badge"><span />Demo mode</span>
            <button className="icon-button notification-button" aria-label="Notifications"><Bell size={19} /><span /></button>
            <button className="user-menu" aria-label="Open account menu"><span>AM</span><strong>Alex Morgan</strong><ChevronsUpDown size={15} /></button>
          </div>
        </header>
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}
