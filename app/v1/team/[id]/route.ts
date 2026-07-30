import { z } from "zod";
import { audit, DEMO_USER_ID, ensureDatabase, tenantIdFrom } from "../../../../db/runtime";

type RouteContext = { params: Promise<{ id: string }> };

const updateMember = z.object({
  name: z.string().trim().min(2).max(180).optional(),
  role: z.enum(["workflow_admin", "workflow_builder", "approver", "operator", "viewer"]).optional(),
  status: z.enum(["active", "invited", "suspended"]).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "No changes supplied" });

async function adminCount(db: D1Database, tenantId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM users WHERE tenant_id = ? AND role = 'workflow_admin'")
    .bind(tenantId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = await request.json();
  const parsed = updateMember.safeParse(body);
  if (!parsed.success) {
    return Response.json({ detail: "Invalid update payload" }, { status: 422 });
  }

  const db = await ensureDatabase();
  const tenantId = tenantIdFrom(request);
  const user = await db
    .prepare("SELECT id, email, name, role, status, locale, timezone FROM users WHERE id = ? AND tenant_id = ?")
    .bind(id, tenantId)
    .first<{ id: string; email: string; name: string; role: string; status: string; locale: string; timezone: string }>();
  if (!user) {
    return Response.json({ detail: "Team member not found" }, { status: 404 });
  }

  const nextRole = parsed.data.role ?? user.role;
  const nextStatus = parsed.data.status ?? user.status;
  if (user.role === "workflow_admin" && (nextRole !== "workflow_admin" || nextStatus !== "active")) {
    if ((await adminCount(db, tenantId)) <= 1) {
      return Response.json(
        { detail: `Cannot change ${user.name || user.email}: they are the last workflow_admin in this workspace.` },
        { status: 409 },
      );
    }
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  if (parsed.data.name !== undefined) {
    fields.push("name = ?");
    values.push(parsed.data.name);
  }
  if (parsed.data.role !== undefined) {
    fields.push("role = ?");
    values.push(parsed.data.role);
  }
  if (parsed.data.status !== undefined) {
    fields.push("status = ?");
    values.push(parsed.data.status);
  }

  await db
    .prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`)
    .bind(...values, id, tenantId)
    .run();
  await audit(db, tenantId, "team.updated", "user", id, parsed.data);

  const updated = await db
    .prepare("SELECT id, email, name, role, status, locale, timezone FROM users WHERE id = ?")
    .bind(id)
    .first();
  return Response.json(updated);
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const db = await ensureDatabase();
  const tenantId = tenantIdFrom(_request);
  const user = await db
    .prepare("SELECT id, email, name, role FROM users WHERE id = ? AND tenant_id = ?")
    .bind(id, tenantId)
    .first<{ id: string; email: string; name: string; role: string }>();
  if (!user) {
    return Response.json({ detail: "Team member not found" }, { status: 404 });
  }
  if (id === DEMO_USER_ID) {
    return Response.json(
      { detail: "You cannot remove yourself from the workspace. Ask another admin to do it." },
      { status: 409 },
    );
  }
  if (user.role === "workflow_admin" && (await adminCount(db, tenantId)) <= 1) {
    return Response.json(
      { detail: `Cannot remove ${user.name || user.email}: they are the last workflow_admin in this workspace.` },
      { status: 409 },
    );
  }

  const owned = await db
    .prepare("SELECT COUNT(*) AS count FROM workflows WHERE tenant_id = ? AND owner_id = ?")
    .bind(tenantId, id)
    .first<{ count: number }>();
  if ((owned?.count ?? 0) > 0) {
    return Response.json(
      {
        detail: `${user.name || user.email} still owns ${owned?.count} workflow(s). Reassign them first, or suspend this member instead.`,
      },
      { status: 409 },
    );
  }

  await db.prepare("DELETE FROM users WHERE id = ? AND tenant_id = ?").bind(id, tenantId).run();
  await audit(db, tenantId, "team.removed", "user", id, { email: user.email, role: user.role });
  return new Response(null, { status: 204 });
}
