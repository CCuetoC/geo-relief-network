import { getAuthenticatedActor } from "@/core/server/auth";
import { ManagerOperationError, processManagerQueue } from "@/services/manager-operations";
import { dispatchWhatsAppOutbox } from "@/adapters/server/whatsapp-outbox-delivery";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const actor = await getAuthenticatedActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "invalid_body" }, { status: 400 }); }
  const value = body && typeof body === "object" ? body as Record<string, unknown> : {};
  if (typeof value.pointId !== "string" || typeof value.productId !== "string") {
    return Response.json({ error: "point_and_product_required" }, { status: 400 });
  }
  try {
    const result = await processManagerQueue(actor.id, value.pointId, value.productId);
    const { notificationOutboxIds = [], ...response } = result;
    await dispatchWhatsAppOutbox({ outboxIds: notificationOutboxIds }).catch(() => []);
    return Response.json(response);
  } catch (error) {
    if (error instanceof ManagerOperationError) return Response.json({ error: "queue_process_rejected", message: error.message }, { status: error.status });
    return Response.json({ error: "queue_process_failed" }, { status: 503 });
  }
}
