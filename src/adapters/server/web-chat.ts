import type { ConversationInput, ConversationOutput } from "@/domain/types";
import "server-only";
import { conversationService } from "@/core/server/application";
import { dispatchWhatsAppOutbox } from "@/adapters/server/whatsapp-outbox-delivery";

/** Web channel boundary; it delegates to the shared conversation service. */
export interface WebChatAdapter {
  handle(input: ConversationInput): Promise<ConversationOutput>;
}

export const webChatAdapter: WebChatAdapter = {
  async handle(input) {
    const output = await conversationService.respond({ ...input, channel: "WEB" });
    const { notificationOutboxIds = [], ...publicOutput } = output;
    if (notificationOutboxIds.length) {
      await dispatchWhatsAppOutbox({ outboxIds: notificationOutboxIds }).catch(() => []);
    }
    return publicOutput;
  },
};
