import "server-only";
import { queryRows, withTransaction } from "@/core/server/db";

export async function claimWhatsAppMessage(providerMessageId: string, receivedAt: string) {
  const result = await withTransaction((client) => client.query<{ id: string }>(
    `INSERT INTO grn_channel_inbox_events
       (channel, provider_message_id, received_at, status, lease_until)
     VALUES ('WHATSAPP', $1, $2::timestamptz, 'PROCESSING', transaction_timestamp() + interval '2 minutes')
     ON CONFLICT (provider_message_id) DO UPDATE SET
       status = 'PROCESSING', lease_until = transaction_timestamp() + interval '2 minutes',
       received_at = EXCLUDED.received_at
     WHERE grn_channel_inbox_events.status IN ('RECEIVED', 'FAILED')
        OR (grn_channel_inbox_events.status = 'PROCESSING' AND grn_channel_inbox_events.lease_until <= transaction_timestamp())
     RETURNING id`,
    [providerMessageId, receivedAt],
  ));
  return result.rows[0]?.id ?? null;
}

export async function finishWhatsAppMessage(providerMessageId: string, status: "PROCESSED" | "FAILED", userId?: string) {
  await withTransaction((client) => client.query(
    `UPDATE grn_channel_inbox_events
        SET status = $2, user_id = COALESCE($3, user_id),
            processed_at = CASE WHEN $2 = 'PROCESSED' THEN transaction_timestamp() ELSE processed_at END,
            lease_until = NULL
      WHERE provider_message_id = $1`,
    [providerMessageId, status, userId ?? null],
  ).then(() => undefined));
}

export async function findWhatsAppActorByLookupHash(senderLookupHash: string) {
  const rows = await queryRows<{ user_id: string }>(
    "SELECT user_id FROM grn_whatsapp_links WHERE sender_lookup_hash = $1",
    [senderLookupHash],
  );
  return rows[0]?.user_id ?? null;
}

export async function getOrCreateWhatsAppConversation(userId: string) {
  const result = await withTransaction((client) => client.query<{ conversation_id: string }>(
    `INSERT INTO grn_whatsapp_conversations (user_id, conversation_id)
     VALUES ($1, gen_random_uuid())
     ON CONFLICT (user_id) DO UPDATE SET updated_at = transaction_timestamp()
     RETURNING conversation_id`,
    [userId],
  ));
  return result.rows[0].conversation_id;
}

export async function associateWhatsAppMessageWithUser(inboxId: string, userId: string) {
  await withTransaction((client) => client.query(
    "UPDATE grn_channel_inbox_events SET user_id = $2 WHERE id = $1",
    [inboxId, userId],
  ).then(() => undefined));
}
