import type { ConversationInput, ConversationOutput } from "@/services/contracts";

/** Web channel boundary; actual conversation orchestration is deferred. */
export interface WebChatAdapter {
  handle(input: ConversationInput): Promise<ConversationOutput>;
}
