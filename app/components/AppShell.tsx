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
import { useCallback, useEffect, useRef, useState } from "react";
import { api, getSessionUser, logout, type ApiRun, type ApiWorkflow } from "../../lib/api";
import { configuredControlPlaneUrl } from "../../lib/api-base";
import { notificationsFromRuns, pendingApprovalCount, type AppNotification } from "../../lib/notifications";
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

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [approvalCount, setApprovalCount] = useState(0);
  const [sessionUser, setSessionUser] = useState(() => getSessionUser());
  const menuRef = useRef<HTMLDivElement>(null);
  const active = (href: string) => href === "/" ? pathname === "/" : pathname.startsWith(href);

  const refreshShellData = useCallback(() => {
    setSessionUser(getSessionUser());
    if (!configuredControlPlaneUrl()) return;
    Promise.all([
      api.runs.list().catch(() => [] as ApiRun[]),
      api.workflows.list().catch(() => [] as ApiWorkflow[]),
    ]).then(([runs, workflows]) => {
      setNotifications(notificationsFromRuns(runs, workflows));
      setApprovalCount(pendingApprovalCount(runs));
    });
  }, []);

  useEffect(() => {
    if (pathname === "/login") return;
    refreshShellData();
    const onFocus = () => refreshShellData();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refreshShellData();
    });
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshShellData, pathname]);

  useEffect(() => {
    if (pathname === "/login") return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
        setUserOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [pathname]);

  if (pathname === "/login") {
    return <>{children}</>;
  }

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
              {label === "Approvals" && approvalCount > 0 && <span className="nav-count">{approvalCount}</span>}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <Link href="/help" className="nav-link"><CircleHelp size={18} /><span>Help centre</span></Link>
          <button className="workspace-switcher">
            <span className="workspace-avatar">NP</span>
            <span><strong>Northstar Projects</strong><small>{configuredControlPlaneUrl() ? "Live workspace" : "Demo workspace"}</small></span>
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
                  <div className="dropdown-head"><strong>Notifications</strong><small>{notifications.length > 0 ? `${notifications.length} recent` : "Up to date"}</small></div>
                  {notifications.length > 0 ? notifications.map(({ id, title, body, time, href }) => (
                    href ? (
                      <Link href={href} className="notif-item" key={id} onClick={() => setNotifOpen(false)}>
                        <strong>{title}</strong>
                        <p>{body}</p>
                        <small>{time}</small>
                      </Link>
                    ) : (
                      <div className="notif-item" key={id}>
                        <strong>{title}</strong>
                        <p>{body}</p>
                        <small>{time}</small>
                      </div>
                    )
                  )) : (
                    <div className="notif-item">
                      <strong>All clear</strong>
                      <p>Run a workflow to see activity here.</p>
                    </div>
                  )}
                  <Link href="/approvals" className="dropdown-foot" onClick={() => setNotifOpen(false)}>Open approval inbox</Link>
                </div>
              )}
            </div>
            <div className="menu-anchor">
              <button className="user-menu" aria-label="Account menu" onClick={() => { setUserOpen((v) => !v); setNotifOpen(false); }}><span>{sessionUser?.initials ?? "WP"}</span><strong>{sessionUser?.name ?? "WorkPilot user"}</strong><ChevronsUpDown size={15} /></button>
              {userOpen && (
                <div className="dropdown-panel user-panel">
                  <div className="dropdown-head"><strong>{sessionUser?.name ?? "WorkPilot user"}</strong><small>{sessionUser?.email ?? "Not signed in"}</small></div>
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
