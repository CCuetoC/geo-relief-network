import type { ConversationInput, ConversationOutput } from "@/domain/types";
import "server-only";
import { conversationService } from "@/core/server/application";
import { dispatchWhatsAppOutbox } from "@/adapters/server/whatsapp-outbox-delivery";

/** Converts a verified provider message into the shared conversation contract. */
/** WhatsApp transport supplies verified identity/media; this adapter calls the same use case as web. */
export async function handleWhatsAppConversation(input: ConversationInput): Promise<ConversationOutput> {
  const output = await conversationService.respond({ ...input, channel: "WHATSAPP" });
  const { notificationOutboxIds = [], ...publicOutput } = output;
  if (notificationOutboxIds.length) {
    await dispatchWhatsAppOutbox({ outboxIds: notificationOutboxIds }).catch(() => []);
  }
  return publicOutput;
}
