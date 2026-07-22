export async function GET() {
  return Response.json({ status: "ok", service: "workpilot-demo", version: "0.1.0" });
}
