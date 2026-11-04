import { getAuthenticatedActor } from "@/core/server/auth";
import { ManagerOperationError, recordPhysicalPickup } from "@/services/manager-operations";
import { dispatchWhatsAppOutbox } from "@/adapters/server/whatsapp-outbox-delivery";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ reservationId: string }> }): Promise<Response> {
  const actor = await getAuthenticatedActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "invalid_body" }, { status: 400 }); }
  const pickupCode = body && typeof body === "object" ? (body as Record<string, unknown>).pickupCode : undefined;
  if (typeof pickupCode !== "string") return Response.json({ error: "pickup_code_required" }, { status: 400 });
  try {
    const { reservationId } = await context.params;
    const result = await recordPhysicalPickup(actor.id, reservationId, pickupCode);
    const { notificationOutboxIds = [], ...response } = result;
    await dispatchWhatsAppOutbox({ outboxIds: notificationOutboxIds }).catch(() => []);
    return Response.json(response);
  } catch (error) {
    if (error instanceof ManagerOperationError) return Response.json({ error: "pickup_rejected", message: error.message }, { status: error.status });
    return Response.json({ error: "pickup_confirmation_failed", message: "No se descontó inventario." }, { status: 503 });
  }
}
