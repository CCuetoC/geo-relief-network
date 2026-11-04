import "server-only";
import { sendWhatsAppText } from "@/adapters/server/whatsapp";
import { decryptWhatsAppDestination } from "@/core/server/whatsapp-security";
import {
  claimWhatsAppOutbox,
  getWhatsAppDestinationCiphertext,
  hasRecentWhatsAppInbound,
  recordWhatsAppOutboxAttempt,
  type WhatsAppOutboxFilter,
} from "@/repositories/notification-outbox-repository";

export async function dispatchWhatsAppOutbox(filter: WhatsAppOutboxFilter) {
  const results: Array<{ id: string; sent: boolean; reason?: string }> = [];
  const attemptedIds: string[] = [];
  const batchLimit = filter.outboxIds?.length ? Math.min(20, Math.ceil(filter.outboxIds.length / 20)) : 1;

  for (let batch = 0; batch < batchLimit; batch += 1) {
    const claimed = await claimWhatsAppOutbox({ ...filter, excludeOutboxIds: attemptedIds });
    if (claimed.length === 0) break;
    for (const item of claimed) {
      attemptedIds.push(item.id);
      let succeeded = false;
      let providerMessageId: string | undefined;
      let errorCode: string | undefined;
      try {
        if (!await hasRecentWhatsAppInbound(item.recipient_user_id)) throw new Error("WHATSAPP_WINDOW_EXPIRED");
        const encrypted = await getWhatsAppDestinationCiphertext(item.recipient_user_id);
        if (!encrypted) throw new Error("WHATSAPP_DESTINATION_NOT_LINKED");
        const recipient = decryptWhatsAppDestination({
          ciphertext: encrypted.destination_ciphertext,
          nonce: encrypted.destination_nonce,
          tag: encrypted.destination_tag,
        });
        const message = typeof item.payload?.text === "string"
          ? item.payload.text
          : "Tienes una actualización de Geo Relief Network. Abre el chat web para revisarla.";
        const sent = await sendWhatsAppText(recipient, message);
        providerMessageId = sent.providerMessageId;
        succeeded = true;
      } catch (error) {
        errorCode = error instanceof Error ? error.message.slice(0, 300) : "WHATSAPP_SEND_FAILED";
      }
      await recordWhatsAppOutboxAttempt({ id: item.id, succeeded, providerMessageId, errorCode });
      results.push({ id: item.id, sent: succeeded, reason: errorCode });
    }
  }
  return results;
}
