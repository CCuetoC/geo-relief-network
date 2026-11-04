import { requireServerEnv, serverEnv } from "@/core/server/env";
import type { ConversationActionOption } from "@/domain/types";
import { normalizeWhatsAppPhone } from "@/core/server/whatsapp-security";
export {
  decryptWhatsAppDestination,
  encryptWhatsAppDestination,
  hashWhatsAppLinkToken,
  hashWhatsAppSender,
  verifyWhatsAppWebhookSignature,
} from "@/core/server/whatsapp-security";
export { configuredWhatsAppBusinessNumber } from "@/core/server/whatsapp-config";

export interface WhatsAppInboundMessage {
  providerMessageId: string;
  senderLookupId: string;
  text?: string;
  mediaIds?: string[];
  receivedAt: string;
}

const graphVersionPattern = /^v\d+\.\d+$/;

function graphBase() {
  const version = requireServerEnv("WHATSAPP_GRAPH_API_VERSION");
  if (!graphVersionPattern.test(version)) throw new Error("WHATSAPP_GRAPH_API_VERSION must look like vNN.N.");
  return `https://graph.facebook.com/${version}`;
}

export interface WhatsAppSentMessage {
  providerMessageId: string;
}

async function graphRequest(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${requireServerEnv("WHATSAPP_ACCESS_TOKEN")}`,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`WhatsApp Graph API returned ${response.status}: ${body}`);
  }
  return response;
}

function shortButtonTitle(option: ConversationActionOption, index: number) {
  const title = option.label.trim();
  return title.length <= 20 ? title : `Confirmar ${index + 1}`;
}

export async function sendWhatsAppText(
  recipientId: string,
  text: string,
  options: ConversationActionOption[] = [],
): Promise<WhatsAppSentMessage> {
  const phoneId = requireServerEnv("WHATSAPP_PHONE_NUMBER_ID");
  const safeText = text.slice(0, 3800);
  const chosen = options.slice(0, 3);
  const payload = chosen.length
    ? {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: normalizeWhatsAppPhone(recipientId),
        type: "interactive",
        interactive: {
          type: "button",
          body: {
            text: `${safeText}\n\n${chosen.map((option, index) => `${index + 1}. ${option.summary}`).join("\n")}`.slice(0, 1024),
          },
          action: {
            buttons: chosen.map((option, index) => ({
              type: "reply",
              reply: { id: option.draftId, title: shortButtonTitle(option, index) },
            })),
          },
        },
      }
    : {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: normalizeWhatsAppPhone(recipientId),
        type: "text",
        text: { preview_url: false, body: safeText },
      };
  const response = await graphRequest(`${graphBase()}/${encodeURIComponent(phoneId)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json() as { messages?: Array<{ id?: string }> };
  const providerMessageId = result.messages?.[0]?.id;
  if (!providerMessageId) throw new Error("WhatsApp did not return a message ID.");
  return { providerMessageId };
}

export async function downloadWhatsAppMedia(mediaId: string, maxBytes: number) {
  if (!/^[A-Za-z0-9_-]{4,200}$/.test(mediaId)) throw new Error("Invalid WhatsApp media ID.");
  const metadataResponse = await graphRequest(`${graphBase()}/${encodeURIComponent(mediaId)}`, { method: "GET" });
  const metadata = await metadataResponse.json() as { url?: string; mime_type?: string; file_size?: number };
  if (!metadata.url || !metadata.mime_type || (metadata.file_size && metadata.file_size > maxBytes)) {
    throw new Error("WhatsApp media metadata is incomplete or exceeds the size limit.");
  }
  const mediaUrl = new URL(metadata.url);
  if (!["lookaside.fbsbx.com", "lookaside.facebook.com", "scontent.whatsapp.net"].includes(mediaUrl.hostname)) {
    throw new Error("WhatsApp returned an unexpected media host.");
  }
  const mediaResponse = await graphRequest(mediaUrl.toString(), { method: "GET" });
  const contentLength = Number(mediaResponse.headers.get("content-length") ?? 0);
  if (contentLength > maxBytes) throw new Error("WhatsApp media exceeds the size limit.");
  const bytes = new Uint8Array(await mediaResponse.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > maxBytes) throw new Error("WhatsApp media is empty or too large.");
  return { bytes, contentType: metadata.mime_type.toLowerCase().split(";")[0].trim() };
}

export function whatsappConfigurationPresent() {
  return Boolean(
    serverEnv.WHATSAPP_ACCESS_TOKEN && serverEnv.WHATSAPP_PHONE_NUMBER_ID &&
    serverEnv.WHATSAPP_APP_SECRET && serverEnv.WHATSAPP_GRAPH_API_VERSION &&
    serverEnv.WHATSAPP_LOOKUP_HMAC_KEY && serverEnv.WHATSAPP_DESTINATION_ENCRYPTION_KEY,
  );
}
