"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "wp-theme";

function applyTheme(theme: Theme) {
  const resolved = theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
  document.documentElement.setAttribute("data-theme", resolved);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) ?? "system") as Theme;
    setTheme(stored);
    applyTheme(stored);

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystem = () => {
      if ((localStorage.getItem(STORAGE_KEY) ?? "system") === "system") applyTheme("system");
    };
    mq.addEventListener("change", onSystem);
    return () => mq.removeEventListener("change", onSystem);
  }, []);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  const pick = (t: Theme) => {
    setTheme(t);
    localStorage.setItem(STORAGE_KEY, t);
    applyTheme(t);
    setOpen(false);
  };

  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        className="icon-button"
        aria-label="Change theme"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <Icon size={18} />
      </button>
      {open && (
        <div className="theme-menu" role="menu">
          {(["light", "system", "dark"] as Theme[]).map(t => (
            <button
              key={t}
              role="menuitem"
              className={`theme-option${theme === t ? " active" : ""}`}
              onClick={() => pick(t)}
            >
              {t === "light" ? <Sun size={14} /> : t === "dark" ? <Moon size={14} /> : <Monitor size={14} />}
              <span>{t.charAt(0).toUpperCase() + t.slice(1)}</span>
              {theme === t && <span className="theme-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
