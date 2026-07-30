/**
 * Node/Docker compatibility shim for the optional D1 demo routes.
 *
 * Docker is configured for the live FastAPI control plane, so these bindings
 * must never be used there. Exporting an empty environment lets the production
 * server load its complete route manifest without importing Cloudflare's
 * non-Node `cloudflare:workers` module. If a D1-only route is called by mistake,
 * db/runtime.ts still fails explicitly with "DB is unavailable".
 */
export const env: Record<string, never> = {};
