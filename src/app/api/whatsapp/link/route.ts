import { getAuthenticatedActor } from "@/core/server/auth";
import { createWhatsAppLink, hasLinkedWhatsApp, unlinkWhatsApp } from "@/services/whatsapp-linking";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const actor = await getAuthenticatedActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    return Response.json({ linked: await hasLinkedWhatsApp(actor.id) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "whatsapp_status_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request): Promise<Response> {
  const actor = await getAuthenticatedActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const consent = Boolean(body && typeof body === "object" && (body as Record<string, unknown>).consent === true);
  try {
    return Response.json(await createWhatsAppLink(actor.id, consent), { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo generar el enlace de WhatsApp.";
    return Response.json({ error: "whatsapp_link_unavailable", message }, { status: 400 });
  }
}

export async function DELETE(): Promise<Response> {
  const actor = await getAuthenticatedActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    await unlinkWhatsApp(actor.id);
    return Response.json({ unlinked: true });
  } catch {
    return Response.json({ error: "whatsapp_unlink_failed" }, { status: 503 });
  }
}
