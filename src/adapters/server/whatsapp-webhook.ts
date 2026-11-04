import "server-only";
import { downloadWhatsAppMedia, sendWhatsAppText } from "@/adapters/server/whatsapp";
import { hashWhatsAppSender } from "@/core/server/whatsapp-security";
import { storePrivatePhoto } from "@/adapters/server/private-media";
import { handleWhatsAppConversation } from "@/adapters/server/whatsapp-chat";
import { dispatchWhatsAppOutbox } from "@/adapters/server/whatsapp-outbox-delivery";
import {
  associateWhatsAppMessageWithUser,
  claimWhatsAppMessage,
  findWhatsAppActorByLookupHash,
  finishWhatsAppMessage,
  getOrCreateWhatsAppConversation,
} from "@/repositories/whatsapp-inbox-repository";
import { consumeWhatsAppLinkToken } from "@/services/whatsapp-linking";

interface InboundMessage {
  id: string;
  from: string;
  timestamp: string;
  type?: string;
  text?: { body?: string };
  interactive?: { button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string } };
  image?: { id?: string; mime_type?: string; caption?: string };
  audio?: { id?: string; mime_type?: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function extractMessages(payload: unknown): InboundMessage[] {
  if (!isRecord(payload) || !Array.isArray(payload.entry)) return [];
  const messages: InboundMessage[] = [];
  for (const entry of payload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value) || !Array.isArray(change.value.messages)) continue;
      for (const message of change.value.messages) {
        if (!isRecord(message) || typeof message.id !== "string" || typeof message.from !== "string") continue;
        messages.push(message as unknown as InboundMessage);
      }
    }
  }
  return messages.slice(0, 20);
}

function messageParts(message: InboundMessage) {
  const text = message.text?.body?.slice(0, 6000) ?? message.image?.caption?.slice(0, 6000) ?? "";
  const reply = message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id;
  const match = text.match(/^\s*VINCULAR\s+([A-Za-z0-9_-]{20,50})\s*$/i);
  return { text, confirmationDraftId: reply, linkToken: match?.[1] };
}

async function processMessage(message: InboundMessage, inboxId: string) {
  const parts = messageParts(message);
  if (parts.linkToken) {
    const linked = await consumeWhatsAppLinkToken(parts.linkToken, message.from);
    await sendWhatsAppText(
      message.from,
      linked
        ? "WhatsApp quedó vinculado. Ya puedes usar este chat para solicitar ayuda, preparar donaciones y recibir avisos." 
        : "El código de vinculación venció o ya fue usado. Inicia sesión en la web y genera un enlace nuevo.",
    );
    await finishWhatsAppMessage(message.id, "PROCESSED");
    return;
  }

  const actorId = await findWhatsAppActorByLookupHash(hashWhatsAppSender(message.from));
  if (!actorId) {
    await sendWhatsAppText(message.from, "Para proteger tus solicitudes, primero vincula este número desde la web con tu cuenta Google. Abre /chat e inicia la vinculación.");
    await finishWhatsAppMessage(message.id, "PROCESSED");
    return;
  }
  await associateWhatsAppMessageWithUser(inboxId, actorId);

  const conversationId = await getOrCreateWhatsAppConversation(actorId);
  let audio: { base64: string; format: "wav" | "mp3" } | undefined;
  let text = parts.text;
  let photoMediaIds: string[] = [];

  if (message.type === "image" && message.image?.id) {
    const media = await downloadWhatsAppMedia(message.image.id, 5 * 1024 * 1024);
    if (!["image/jpeg", "image/png", "image/webp"].includes(media.contentType)) {
      throw new Error("WHATSAPP_IMAGE_TYPE_UNSUPPORTED");
    }
    const saved = await storePrivatePhoto({ ownerId: actorId, bytes: media.bytes, claimedContentType: media.contentType });
    photoMediaIds = [saved.id];
  }

  if (message.type === "audio" && message.audio?.id) {
    const media = await downloadWhatsAppMedia(message.audio.id, 8 * 1024 * 1024);
    if (media.contentType === "audio/mpeg") {
      audio = { base64: Buffer.from(media.bytes).toString("base64"), format: "mp3" };
    } else if (media.contentType === "audio/wav" || media.contentType === "audio/x-wav") {
      audio = { base64: Buffer.from(media.bytes).toString("base64"), format: "wav" };
    } else {
      await sendWhatsAppText(message.from, "Recibí el audio, pero Muse Spark en este flujo acepta MP3 o WAV. Envíame el mensaje por texto para continuar.");
      await finishWhatsAppMessage(message.id, "PROCESSED", actorId);
      return;
    }
  }

  const output = await handleWhatsAppConversation({
    conversationId,
    channel: "WHATSAPP",
    actorId,
    text,
    audio,
    photoMediaIds,
    confirmationDraftId: parts.confirmationDraftId,
  });
  await sendWhatsAppText(message.from, output.text, output.actionOptions);
  await finishWhatsAppMessage(message.id, "PROCESSED", actorId);
  await dispatchWhatsAppOutbox({ recipientUserIds: [actorId] }).catch(() => []);
}

export async function processWhatsAppWebhook(payload: unknown) {
  const messages = extractMessages(payload);
  const outcomes: Array<{ providerMessageId: string; status: "processed" | "duplicate" | "failed" }> = [];
  for (const message of messages) {
    const rawSeconds = Number(message.timestamp);
    const receivedAt = Number.isFinite(rawSeconds) && rawSeconds > 0
      ? new Date(rawSeconds * 1000).toISOString()
      : new Date().toISOString();
    const inboxId = await claimWhatsAppMessage(message.id, receivedAt);
    if (!inboxId) {
      outcomes.push({ providerMessageId: message.id, status: "duplicate" });
      continue;
    }
    try {
      await processMessage(message, inboxId);
      outcomes.push({ providerMessageId: message.id, status: "processed" });
    } catch {
      await finishWhatsAppMessage(message.id, "FAILED").catch(() => undefined);
      outcomes.push({ providerMessageId: message.id, status: "failed" });
    }
  }
  return outcomes;
}

