const configuredControlPlane = (process.env.NEXT_PUBLIC_CONTROL_PLANE_URL ?? "").replace(/\/$/, "");

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

/** True when the UI should talk to a FastAPI instance on this machine (not Cloudflare D1 /v1). */
export function isLocalControlPlane(): boolean {
  if (!configuredControlPlane) return typeof window !== "undefined";
  try {
    return isLocalHost(new URL(configuredControlPlane).hostname);
  } catch {
    return false;
  }
}

/** Where browser-side API calls should go. Uses same-origin proxy when cross-origin would fail (HTTPS→HTTP, CORS). */
export function getApiBase(): string {
  if (typeof window === "undefined") {
    return configuredControlPlane || "http://localhost:8000";
  }

  // No remote API configured — use same-origin Worker /v1 routes (D1 demo).
  if (!configuredControlPlane) {
    return "";
  }

  try {
    const target = new URL(configuredControlPlane);
    const here = new URL(window.location.href);

    // Local dev: UI (:3000/:3001) + API (:8000). Call API directly; CORS allows both UI ports.
    if (isLocalHost(target.hostname) && isLocalHost(here.hostname)) {
      return configuredControlPlane;
    }

    const sameOrigin = target.origin === here.origin;
    const mixedContent = here.protocol === "https:" && target.protocol === "http:";
    if (!sameOrigin || mixedContent) {
      return "/api/control-plane";
    }
  } catch {
    return "/api/control-plane";
  }

  return configuredControlPlane;
}

export function describeApiBase(): string {
  const base = getApiBase();
  if (!base) return "same-origin /v1";
  if (base === "/api/control-plane") {
    return configuredControlPlane
      ? `${base} → ${configuredControlPlane}`
      : base;
  }
  return base;
}

export function configuredControlPlaneUrl(): string {
  return configuredControlPlane;
}

/** True when the UI targets a remote FastAPI control plane (not the local D1 demo). */
export function usesLiveControlPlane(): boolean {
  return Boolean(configuredControlPlane);
}
