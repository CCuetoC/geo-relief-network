import { getAuthenticatedActor } from "@/core/server/auth";
import { createWhatsAppLink, hasLinkedWhatsApp, unlinkWhatsApp } from "@/services/whatsapp-linking";
import { parseLocale } from "@/i18n/locale";
import { translate } from "@/i18n/messages";

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
  const locale = parseLocale(body && typeof body === "object" ? (body as Record<string, unknown>).locale : undefined) ?? "en";
  try {
    return Response.json(await createWhatsAppLink(actor.id, consent, locale), { status: 201 });
  } catch (error) {
    const message = translate(locale, "chat.linkError");
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
