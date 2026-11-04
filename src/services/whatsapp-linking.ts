import "server-only";
import { randomBytes } from "node:crypto";
import { queryRows, withTransaction } from "@/core/server/db";
import { configuredWhatsAppBusinessNumber } from "@/core/server/whatsapp-config";
import { encryptWhatsAppDestination, hashWhatsAppLinkToken, hashWhatsAppSender } from "@/core/server/whatsapp-security";

export async function createWhatsAppLink(userId: string, consent: boolean) {
  if (!consent) throw new Error("Se requiere consentimiento para recibir notificaciones por WhatsApp.");
  const token = randomBytes(24).toString("base64url");
  const tokenHash = hashWhatsAppLinkToken(token);
  const result = await withTransaction((client) => client.query<{ expires_at: string }>(
    `INSERT INTO grn_whatsapp_link_tokens (token_hash, user_id, expires_at)
     VALUES ($1, $2, transaction_timestamp() + interval '10 minutes')
     RETURNING expires_at`,
    [tokenHash, userId],
  ));
  const number = configuredWhatsAppBusinessNumber();
  const text = encodeURIComponent(`VINCULAR ${token}`);
  return {
    url: `https://wa.me/${number}?text=${text}`,
    expiresAt: result.rows[0].expires_at,
  };
}

export async function hasLinkedWhatsApp(userId: string) {
  const rows = await queryRows<{ linked: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM grn_whatsapp_links WHERE user_id = $1) AS linked`,
    [userId],
  );
  return rows[0]?.linked === true;
}

export async function unlinkWhatsApp(userId: string) {
  await withTransaction((client) => client.query(
    "DELETE FROM grn_whatsapp_links WHERE user_id = $1",
    [userId],
  ).then(() => undefined));
}

export async function consumeWhatsAppLinkToken(token: string, senderId: string) {
  if (!/^[A-Za-z0-9_-]{20,50}$/.test(token)) return false;
  const tokenHash = hashWhatsAppLinkToken(token);
  const senderLookupHash = hashWhatsAppSender(senderId);
  const destination = encryptWhatsAppDestination(senderId);
  return withTransaction(async (client) => {
    const result = await client.query<{ user_id: string }>(
      `SELECT user_id FROM grn_whatsapp_link_tokens
        WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > transaction_timestamp()
        FOR UPDATE`,
      [tokenHash],
    );
    const userId = result.rows[0]?.user_id;
    if (!userId) {
      const alreadyLinked = await client.query(
        `SELECT 1 FROM grn_whatsapp_link_tokens t
          JOIN grn_whatsapp_links l ON l.user_id = t.user_id
         WHERE t.token_hash = $1 AND t.consumed_at IS NOT NULL
           AND l.sender_lookup_hash = $2`,
        [tokenHash, senderLookupHash],
      );
      return alreadyLinked.rows.length > 0;
    }
    await client.query(
      `INSERT INTO grn_whatsapp_links
         (user_id, sender_lookup_hash, destination_ciphertext, destination_nonce, destination_tag, consented_at)
       VALUES ($1, $2, $3, $4, $5, transaction_timestamp())
       ON CONFLICT (user_id) DO UPDATE SET
         sender_lookup_hash = EXCLUDED.sender_lookup_hash,
         destination_ciphertext = EXCLUDED.destination_ciphertext,
         destination_nonce = EXCLUDED.destination_nonce,
         destination_tag = EXCLUDED.destination_tag,
         consented_at = EXCLUDED.consented_at,
         created_at = transaction_timestamp()`,
      [userId, senderLookupHash, destination.ciphertext, destination.nonce, destination.tag],
    );
    await client.query(
      "UPDATE grn_whatsapp_link_tokens SET consumed_at = transaction_timestamp() WHERE token_hash = $1",
      [tokenHash],
    );
    return true;
  });
}
