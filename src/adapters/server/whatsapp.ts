export interface WhatsAppInboundMessage {
  providerMessageId: string;
  senderLookupId: string;
  text?: string;
  mediaIds?: string[];
  receivedAt: string;
}

export interface WhatsAppSendResult {
  providerMessageId: string;
}

/** Port only: webhook verification, sends, retries, and persistence are not implemented. */
export interface WhatsAppAdapter {
  sendText(recipientId: string, text: string): Promise<WhatsAppSendResult>;
}
