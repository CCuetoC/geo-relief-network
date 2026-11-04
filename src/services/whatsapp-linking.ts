import "server-only";
import { randomBytes } from "node:crypto";
import { queryRows, withTransaction } from "@/core/server/db";
import { configuredWhatsAppBusinessNumber } from "@/core/server/whatsapp-config";
import { encryptWhatsAppDestination, hashWhatsAppLinkToken, hashWhatsAppSender } from "@/core/server/whatsapp-security";
import type { Locale } from "@/domain/types";
import { translate } from "@/i18n/messages";

export async function createWhatsAppLink(userId: string, consent: boolean, locale: Locale) {
  if (!consent) throw new Error(translate(locale, "chat.whatsAppConsent"));
  const token = randomBytes(24).toString("base64url");
  const tokenHash = hashWhatsAppLinkToken(token);
  const result = await withTransaction((client) => client.query<{ expires_at: string }>(
    `INSERT INTO grn_whatsapp_link_tokens (token_hash, user_id, expires_at, preferred_locale)
     VALUES ($1, $2, transaction_timestamp() + interval '10 minutes', $3)
     RETURNING expires_at`,
    [tokenHash, userId, locale],
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

export async function consumeWhatsAppLinkToken(token: string, senderId: string): Promise<Locale | null> {
  if (!/^[A-Za-z0-9_-]{20,50}$/.test(token)) return null;
  const tokenHash = hashWhatsAppLinkToken(token);
  const senderLookupHash = hashWhatsAppSender(senderId);
  const destination = encryptWhatsAppDestination(senderId);
  return withTransaction(async (client) => {
    const result = await client.query<{ user_id: string; preferred_locale: Locale }>(
      `SELECT user_id, preferred_locale FROM grn_whatsapp_link_tokens
        WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > transaction_timestamp()
        FOR UPDATE`,
      [tokenHash],
    );
    const userId = result.rows[0]?.user_id;
    if (!userId) {
      const alreadyLinked = await client.query<{ preferred_locale: Locale }>(
        `SELECT l.preferred_locale FROM grn_whatsapp_link_tokens t
          JOIN grn_whatsapp_links l ON l.user_id = t.user_id
         WHERE t.token_hash = $1 AND t.consumed_at IS NOT NULL
           AND l.sender_lookup_hash = $2`,
        [tokenHash, senderLookupHash],
      );
      return alreadyLinked.rows[0]?.preferred_locale ?? null;
    }
    const locale = result.rows[0].preferred_locale;
    await client.query(
      `INSERT INTO grn_whatsapp_links
         (user_id, sender_lookup_hash, destination_ciphertext, destination_nonce, destination_tag, consented_at, preferred_locale)
       VALUES ($1, $2, $3, $4, $5, transaction_timestamp(), $6)
       ON CONFLICT (user_id) DO UPDATE SET
         sender_lookup_hash = EXCLUDED.sender_lookup_hash,
         destination_ciphertext = EXCLUDED.destination_ciphertext,
         destination_nonce = EXCLUDED.destination_nonce,
         destination_tag = EXCLUDED.destination_tag,
         preferred_locale = EXCLUDED.preferred_locale,
         consented_at = EXCLUDED.consented_at,
         created_at = transaction_timestamp()`,
      [userId, senderLookupHash, destination.ciphertext, destination.nonce, destination.tag, locale],
    );
    await client.query(
      "UPDATE grn_whatsapp_link_tokens SET consumed_at = transaction_timestamp() WHERE token_hash = $1",
      [tokenHash],
    );
    return locale;
  });
}

export async function getWhatsAppLocale(userId: string): Promise<Locale> {
  const rows = await queryRows<{ preferred_locale: Locale }>(
    `SELECT preferred_locale FROM grn_whatsapp_links WHERE user_id = $1`,
    [userId],
  );
  return rows[0]?.preferred_locale ?? "en";
}

export async function updateWhatsAppLocale(userId: string, locale: Locale) {
  await withTransaction((client) => client.query(
    `UPDATE grn_whatsapp_links SET preferred_locale = $2 WHERE user_id = $1`,
    [userId, locale],
  ).then(() => undefined));
}
