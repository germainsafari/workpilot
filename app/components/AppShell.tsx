"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Bell,
  Blocks,
  Cable,
  CheckCheck,
  ChevronsUpDown,
  CircleHelp,
  Gauge,
  LogOut,
  Menu,
  PlaySquare,
  Search,
  Settings,
  Users,
  Workflow,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { logout } from "../../lib/api";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

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

const notifications = [
  ["Run completed", "Client brief processor finished in 1m 48s", "8 min ago"],
  ["Approval waiting", "Invoice draft for Cascade Labs needs review", "32 min ago"],
  ["Connection attention", "Slack needs re-authorization by 30 July", "2h ago"],
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [search, setSearch] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const active = (href: string) => href === "/" ? pathname === "/" : pathname.startsWith(href);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
        setUserOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const runSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = search.trim().toLowerCase();
    if (!q) return;
    const match = navigation.find(([label]) => label.toLowerCase().includes(q));
    router.push(match ? (match[1] as string) : `/runs`);
    setSearch("");
  };

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
          <form className="global-search" onSubmit={runSearch}>
            <Search size={17} />
            <input aria-label="Search WorkPilot" placeholder="Search workflows, runs, people…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </form>
          <div className="topbar-actions" ref={menuRef}>
            <span className="demo-badge"><span />Live mode</span>
            <ThemeToggle />
            <div className="menu-anchor">
              <button className="icon-button notification-button" aria-label="Notifications" onClick={() => { setNotifOpen((v) => !v); setUserOpen(false); }}><Bell size={19} /><span /></button>
              {notifOpen && (
                <div className="dropdown-panel notif-panel">
                  <div className="dropdown-head"><strong>Notifications</strong><small>{notifications.length} new</small></div>
                  {notifications.map(([title, body, time]) => (
                    <div className="notif-item" key={title}>
                      <strong>{title}</strong>
                      <p>{body}</p>
                      <small>{time}</small>
                    </div>
                  ))}
                  <Link href="/approvals" className="dropdown-foot" onClick={() => setNotifOpen(false)}>Open approval inbox</Link>
                </div>
              )}
            </div>
            <div className="menu-anchor">
              <button className="user-menu" aria-label="Account menu" onClick={() => { setUserOpen((v) => !v); setNotifOpen(false); }}><span>AM</span><strong>Alex Morgan</strong><ChevronsUpDown size={15} /></button>
              {userOpen && (
                <div className="dropdown-panel user-panel">
                  <div className="dropdown-head"><strong>Alex Morgan</strong><small>alex@northstar.example</small></div>
                  <Link href="/settings" className="dropdown-item" onClick={() => setUserOpen(false)}><Settings size={16} />Settings</Link>
                  <button className="dropdown-item danger" onClick={() => logout()}><LogOut size={16} />Sign out</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}
