import "server-only";
import type { ConversationState } from "@/domain/types";
import { queryRows, withTransaction } from "@/core/server/db";

export class NeonConversationContextRepository {
  async load(id: string, actorId?: string): Promise<ConversationState | null> {
    const rows = await queryRows<{ state: ConversationState }>(
      `SELECT state
         FROM grn_conversation_contexts
        WHERE id = $1
          AND (actor_id IS NULL OR actor_id IS NOT DISTINCT FROM $2)
          AND expires_at > transaction_timestamp()`,
      [id, actorId ?? null],
    );
    return rows[0]?.state ?? null;
  }

  async save(id: string, channel: "WEB" | "WHATSAPP", state: ConversationState, actorId?: string): Promise<void> {
    await withTransaction(async (client) => {
      await client.query("DELETE FROM grn_conversation_contexts WHERE expires_at <= transaction_timestamp()");
      await client.query(
        "DELETE FROM grn_conversation_contexts WHERE id = $1 AND expires_at <= transaction_timestamp()",
        [id],
      );
      const result = await client.query(
        `INSERT INTO grn_conversation_contexts (id, actor_id, channel, state, expires_at)
         VALUES ($1, $2, $3, $4::jsonb, transaction_timestamp() + interval '24 hours')
         ON CONFLICT (id) DO UPDATE
           SET actor_id = EXCLUDED.actor_id,
               channel = EXCLUDED.channel,
               state = EXCLUDED.state,
               expires_at = EXCLUDED.expires_at,
               updated_at = transaction_timestamp()
         WHERE (grn_conversation_contexts.actor_id IS NULL
            OR grn_conversation_contexts.actor_id IS NOT DISTINCT FROM EXCLUDED.actor_id)
           AND grn_conversation_contexts.expires_at > transaction_timestamp()`,
        [id, actorId ?? null, channel, JSON.stringify(state)],
      );
      if (result.rowCount !== 1) throw new Error("La conversación expiró o pertenece a otra sesión.");
    });
  }

  async delete(id: string, actorId?: string): Promise<void> {
    await withTransaction((client) => client.query(
      "DELETE FROM grn_conversation_contexts WHERE id = $1 AND actor_id IS NOT DISTINCT FROM $2",
      [id, actorId ?? null],
    ).then(() => undefined));
  }
}
