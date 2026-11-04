import "server-only";
import { queryRows, withTransaction } from "@/core/server/db";

export interface WhatsAppOutboxFilter {
  outboxIds?: string[];
  recipientUserIds?: string[];
  excludeOutboxIds?: string[];
}

export interface ClaimedWhatsAppOutboxRow {
  id: string;
  recipient_user_id: string;
  payload: { text?: string };
  attempt_count: number;
}

export async function claimWhatsAppOutbox(filter: WhatsAppOutboxFilter) {
  const ids = [...new Set(filter.outboxIds ?? [])].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const users = [...new Set(filter.recipientUserIds ?? [])].filter((id) => id.length > 0 && id.length <= 256);
  const excluded = [...new Set(filter.excludeOutboxIds ?? [])].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (ids.length === 0 && users.length === 0) return [];

  return withTransaction(async (client) => {
    const rows = await client.query<ClaimedWhatsAppOutboxRow>(
      `SELECT id, recipient_user_id, payload, attempt_count
         FROM grn_notification_outbox
        WHERE channel = 'WHATSAPP' AND attempt_count < 3
          AND (status IN ('PENDING', 'FAILED') OR (status = 'SENDING' AND lease_until <= transaction_timestamp()))
          AND (($1::uuid[] IS NOT NULL AND id = ANY($1::uuid[]))
            OR ($2::text[] IS NOT NULL AND recipient_user_id = ANY($2::text[])))
          AND ($3::uuid[] IS NULL OR id <> ALL($3::uuid[]))
        ORDER BY created_at, id
        LIMIT 20 FOR UPDATE SKIP LOCKED`,
      [ids.length ? ids : null, users.length ? users : null, excluded.length ? excluded : null],
    );
    for (const row of rows.rows) {
      await client.query(
        `UPDATE grn_notification_outbox
            SET status = 'SENDING', lease_until = transaction_timestamp() + interval '2 minutes',
                updated_at = transaction_timestamp()
          WHERE id = $1`,
        [row.id],
      );
    }
    return rows.rows;
  });
}

export async function hasRecentWhatsAppInbound(userId: string) {
  const rows = await queryRows<{ recent: boolean }>(
    `SELECT COALESCE(MAX(received_at) > transaction_timestamp() - interval '24 hours', false) AS recent
       FROM grn_channel_inbox_events WHERE user_id = $1 AND status = 'PROCESSED'`,
    [userId],
  );
  return rows[0]?.recent === true;
}

export async function getWhatsAppDestinationCiphertext(userId: string) {
  const rows = await queryRows<{
    destination_ciphertext: Buffer; destination_nonce: Buffer; destination_tag: Buffer;
  }>(
    `SELECT destination_ciphertext, destination_nonce, destination_tag
       FROM grn_whatsapp_links WHERE user_id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function recordWhatsAppOutboxAttempt(input: {
  id: string;
  succeeded: boolean;
  providerMessageId?: string;
  errorCode?: string;
}) {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO grn_notification_attempts (outbox_id, succeeded, provider_message_id, error_code)
       VALUES ($1, $2, $3, $4)`,
      [input.id, input.succeeded, input.providerMessageId ?? null, input.errorCode ?? null],
    );
    await client.query(
      `UPDATE grn_notification_outbox
          SET status = $2, attempt_count = attempt_count + 1,
              lease_until = NULL, updated_at = transaction_timestamp()
        WHERE id = $1`,
      [input.id, input.succeeded ? "SENT" : "FAILED"],
    );
  });
}

export interface WebNotificationRow {
  id: string;
  event_type: string;
  payload: { text?: string; reservationId?: string; expiresAt?: string };
  created_at: string;
}

export async function readWebNotifications(userId: string) {
  return queryRows<WebNotificationRow>(
    `SELECT id, event_type, payload, created_at
       FROM grn_notification_outbox
      WHERE recipient_user_id = $1 AND channel = 'WEB' AND status = 'PENDING'
      ORDER BY created_at, id LIMIT 50`,
    [userId],
  );
}

export async function markWebNotificationsRead(userId: string, ids: string[]) {
  if (ids.length === 0) return 0;
  const rows = await queryRows<{ id: string }>(
    `UPDATE grn_notification_outbox SET status = 'SENT', updated_at = transaction_timestamp()
      WHERE recipient_user_id = $1 AND channel = 'WEB' AND status = 'PENDING' AND id = ANY($2::uuid[])
      RETURNING id`,
    [userId, ids],
  );
  return rows.length;
}
