import type { ConversationInput, ConversationOutput } from "@/services/contracts";
import type { WhatsAppInboundMessage } from "@/adapters/server/whatsapp";

/** Converts a verified provider message into the shared conversation contract. */
export interface WhatsAppConversationAdapter {
  toConversationInput(message: WhatsAppInboundMessage): ConversationInput;
  fromConversationOutput(output: ConversationOutput): Promise<void>;
}
