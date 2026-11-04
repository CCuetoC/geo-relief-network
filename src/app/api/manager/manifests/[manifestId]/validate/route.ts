import { getAuthenticatedActor } from "@/core/server/auth";
import { ManagerOperationError, validateDonationManifest } from "@/services/manager-operations";
import { dispatchWhatsAppOutbox } from "@/adapters/server/whatsapp-outbox-delivery";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ manifestId: string }> }): Promise<Response> {
  const actor = await getAuthenticatedActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "invalid_body" }, { status: 400 }); }
  const lines = body && typeof body === "object" ? (body as Record<string, unknown>).lines : null;
  if (!Array.isArray(lines)) return Response.json({ error: "lines_required" }, { status: 400 });
  try {
    const { manifestId } = await context.params;
    const result = await validateDonationManifest(actor.id, manifestId, lines.map((line) => {
      const item = line && typeof line === "object" ? line as Record<string, unknown> : {};
      return { lineId: String(item.lineId ?? ""), acceptedQuantity: Number(item.acceptedQuantity) };
    }));
    const { notificationOutboxIds = [], ...response } = result;
    await dispatchWhatsAppOutbox({ outboxIds: notificationOutboxIds }).catch(() => []);
    return Response.json(response);
  } catch (error) {
    if (error instanceof ManagerOperationError) return Response.json({ error: "manager_operation_rejected", message: error.message }, { status: error.status });
    return Response.json({ error: "manifest_validation_failed", message: "No se confirmó el ingreso de stock." }, { status: 503 });
  }
}
