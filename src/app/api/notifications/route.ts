import { getAuthenticatedActor } from "@/core/server/auth";
import { acknowledgeWebNotifications, listWebNotifications } from "@/services/notifications";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const actor = await getAuthenticatedActor();
  if (!actor) return Response.json({ notifications: [] });
  try {
    const notifications = await listWebNotifications(actor.id);
    return Response.json({ notifications });
  } catch {
    return Response.json({ error: "notifications_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request): Promise<Response> {
  const actor = await getAuthenticatedActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "invalid_body" }, { status: 400 }); }
  const rawIds = body && typeof body === "object" ? (body as Record<string, unknown>).ids : null;
  if (!Array.isArray(rawIds) || rawIds.length > 50 || rawIds.some((id) => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))) {
    return Response.json({ error: "invalid_notification_ids" }, { status: 400 });
  }
  const count = await acknowledgeWebNotifications(actor.id, rawIds as string[]);
  return Response.json({ acknowledged: count });
}
