import { randomUUID } from "node:crypto";
import { getAuthenticatedActor } from "@/core/server/auth";
import { webChatAdapter } from "@/adapters/server/web-chat";
import type { ConversationInput, GeoCoordinates } from "@/domain/types";
import { DEFAULT_LOCALE, parseLocale } from "@/i18n/locale";
import { translate } from "@/i18n/messages";

export const runtime = "nodejs";
export const maxDuration = 60;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_AUDIO_BYTES + 256 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isCoordinates(value: unknown): value is GeoCoordinates {
  if (!value || typeof value !== "object") return false;
  const point = value as Record<string, unknown>;
  return typeof point.latitude === "number" && typeof point.longitude === "number" &&
    Number.isFinite(point.latitude) && Number.isFinite(point.longitude) &&
    Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180;
}

async function boundedRequest(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_REQUEST_BYTES) throw new Error("body_too_large");
  if (!request.body) return new Request(request.url, { method: request.method, headers: request.headers });
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new Error("body_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new Request(request.url, { method: request.method, headers: request.headers, body: bytes });
}

export async function POST(request: Request): Promise<Response> {
  let locale = parseLocale(new URL(request.url).searchParams.get("locale")) ?? DEFAULT_LOCALE;
  try {
    const actor = await getAuthenticatedActor();
    const bounded = await boundedRequest(request);
    const contentType = bounded.headers.get("content-type") ?? "";
    let body: Partial<ConversationInput> = {};

    if (contentType.includes("multipart/form-data")) {
      const form = await bounded.formData();
      locale = parseLocale(form.get("locale")) ?? locale;
      const audio = form.get("audio");
      const geo = form.get("location");
      const photosRaw = form.get("photoMediaIds");
      let location: GeoCoordinates | undefined;
      let photoMediaIds: string[] = [];
      if (typeof geo === "string") {
        try {
          const parsed: unknown = JSON.parse(geo);
          if (isCoordinates(parsed)) location = parsed;
        } catch { /* Ignore malformed optional location. */ }
      }
      if (typeof photosRaw === "string") {
        try {
          const parsed: unknown = JSON.parse(photosRaw);
          if (Array.isArray(parsed)) photoMediaIds = parsed.filter((id): id is string => typeof id === "string" && uuidPattern.test(id)).slice(0, 20);
        } catch { /* The user can send text and reattach photos. */ }
      }
      if (!(audio instanceof File) || audio.size > MAX_AUDIO_BYTES) {
        return Response.json({ error: "audio_required_or_too_large" }, { status: 413 });
      }
      let format: "wav" | "mp3";
      if (audio.type === "audio/wav" || audio.type === "audio/x-wav") format = "wav";
      else if (audio.type === "audio/mpeg" || audio.type === "audio/mp3") format = "mp3";
      else return Response.json({ error: "unsupported_audio_format", message: translate(locale, "api.audioFormat") }, { status: 415 });
      body = {
        conversationId: String(form.get("conversationId") ?? randomUUID()),
        channel: "WEB",
        locale,
        actorId: actor?.id,
        text: String(form.get("text") ?? ""),
        audio: { base64: Buffer.from(await audio.arrayBuffer()).toString("base64"), format },
        location,
        photoMediaIds,
        confirmationDraftId: String(form.get("confirmationDraftId") ?? "") || undefined,
      };
    } else {
      const parsed: unknown = await bounded.json();
      if (!parsed || typeof parsed !== "object") return Response.json({ error: "invalid_body" }, { status: 400 });
      const value = parsed as Record<string, unknown>;
      locale = parseLocale(value.locale) ?? locale;
      body = {
        conversationId: typeof value.conversationId === "string" ? value.conversationId : randomUUID(),
        channel: "WEB",
        locale,
        actorId: actor?.id,
        text: typeof value.text === "string" ? value.text.slice(0, 6000) : undefined,
        location: isCoordinates(value.location) ? value.location : undefined,
        photoMediaIds: Array.isArray(value.photoMediaIds) ? value.photoMediaIds.filter((id): id is string => typeof id === "string" && uuidPattern.test(id)).slice(0, 20) : [],
        confirmationDraftId: typeof value.confirmationDraftId === "string" ? value.confirmationDraftId : undefined,
      };
    }

    const output = await webChatAdapter.handle(body as ConversationInput);
    return Response.json(output, { status: output.phase === "ERROR" ? 400 : 200 });
  } catch (error) {
    if (error instanceof Error && error.message === "body_too_large") return Response.json({ error: "body_too_large" }, { status: 413 });
    return Response.json({ error: "conversation_unavailable", message: translate(locale, "api.chatError") }, { status: 503 });
  }
}
