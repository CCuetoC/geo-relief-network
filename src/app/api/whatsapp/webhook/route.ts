import { timingSafeEqual } from "node:crypto";
import { requireServerEnv, serverEnv } from "@/core/server/env";
import { verifyWhatsAppWebhookSignature, whatsappConfigurationPresent } from "@/adapters/server/whatsapp";
import { processWhatsAppWebhook } from "@/adapters/server/whatsapp-webhook";

export const runtime = "nodejs";
export const maxDuration = 60;
const MAX_WEBHOOK_BYTES = 1_000_000;

function matchesSecret(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readBoundedBody(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_WEBHOOK_BYTES) throw new Error("WEBHOOK_BODY_TOO_LARGE");
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_WEBHOOK_BYTES) {
      await reader.cancel();
      throw new Error("WEBHOOK_BODY_TOO_LARGE");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function GET(request: Request): Promise<Response> {
  if (!serverEnv.WHATSAPP_VERIFY_TOKEN) return Response.json({ error: "webhook_not_configured" }, { status: 503 });
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode !== "subscribe" || !token || !challenge || challenge.length > 200 || !matchesSecret(token, requireServerEnv("WHATSAPP_VERIFY_TOKEN"))) {
    return new Response("Forbidden", { status: 403 });
  }
  return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export async function POST(request: Request): Promise<Response> {
  if (!whatsappConfigurationPresent()) return Response.json({ error: "webhook_not_configured" }, { status: 503 });
  let rawBody: Uint8Array;
  try {
    rawBody = await readBoundedBody(request);
  } catch {
    return Response.json({ error: "body_too_large" }, { status: 413 });
  }
  if (!verifyWhatsAppWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }
  try {
    const payload: unknown = JSON.parse(Buffer.from(rawBody).toString("utf8"));
    const results = await processWhatsAppWebhook(payload);
    if (results.some((item) => item.status === "failed")) {
      return Response.json({ error: "message_processing_failed" }, { status: 503 });
    }
    return Response.json({ received: true, processed: results.length });
  } catch {
    return Response.json({ error: "webhook_processing_failed" }, { status: 503 });
  }
}
