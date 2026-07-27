const UPSTREAM = (process.env.NEXT_PUBLIC_CONTROL_PLANE_URL ?? "").replace(/\/$/, "");

const FORWARD_HEADERS = new Set([
  "authorization",
  "content-type",
  "x-workpilot-tenant-id",
  "x-workpilot-user-id",
  "x-request-id",
]);

async function proxy(request: Request, path: string[]): Promise<Response> {
  if (!UPSTREAM) {
    return Response.json(
      { detail: "NEXT_PUBLIC_CONTROL_PLANE_URL is not configured for the control-plane proxy." },
      { status: 503 },
    );
  }

  const incoming = new URL(request.url);
  const upstreamPath = path.join("/");
  const target = new URL(`${UPSTREAM}/${upstreamPath}${incoming.search}`);

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (FORWARD_HEADERS.has(lower) || lower.startsWith("x-workpilot-")) {
      headers.set(key, value);
    }
  });

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.text();
  }

  try {
    const upstream = await fetch(target, init);
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete("set-cookie");
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch {
    return Response.json(
      { detail: `Could not reach the control plane at ${UPSTREAM}.` },
      { status: 502 },
    );
  }
}

type RouteContext = { params: Promise<{ path: string[] }> };

async function handle(request: Request, context: RouteContext) {
  const { path } = await context.params;
  return proxy(request, path);
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
