import { z } from "zod";
import { audit, DEMO_USER_ID, ensureDatabase, tenantIdFrom } from "../../../db/runtime";

const inviteMember = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().min(2).max(180),
  role: z.enum(["workflow_admin", "workflow_builder", "approver", "operator", "viewer"]).default("operator"),
});

export async function GET(request: Request) {
  const db = await ensureDatabase();
  const tenantId = tenantIdFrom(request);
  const result = await db
    .prepare(
      "SELECT id, email, name, role, status, locale, timezone FROM users WHERE tenant_id = ? ORDER BY name",
    )
    .bind(tenantId)
    .all();
  return Response.json(result.results);
}

export async function POST(request: Request) {
  const parsed = inviteMember.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ detail: "Invalid invitation payload" }, { status: 422 });
  }

  const db = await ensureDatabase();
  const tenantId = tenantIdFrom(request);
  const existing = await db
    .prepare("SELECT id FROM users WHERE tenant_id = ? AND lower(email) = lower(?)")
    .bind(tenantId, parsed.data.email)
    .first();
  if (existing) {
    return Response.json(
      { detail: `${parsed.data.email} is already a member of this workspace.` },
      { status: 409 },
    );
  }

  const userId = `user-${crypto.randomUUID()}`;
  await db
    .prepare(
      "INSERT INTO users (id, tenant_id, email, name, role, status) VALUES (?, ?, ?, ?, ?, 'invited')",
    )
    .bind(userId, tenantId, parsed.data.email, parsed.data.name, parsed.data.role)
    .run();
  await audit(db, tenantId, "team.invited", "user", userId, { email: parsed.data.email, role: parsed.data.role });

  const created = await db
    .prepare("SELECT id, email, name, role, status, locale, timezone FROM users WHERE id = ?")
    .bind(userId)
    .first();
  return Response.json(created, { status: 201 });
}
