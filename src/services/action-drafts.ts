import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { withTransaction } from "@/core/server/db";

export type DraftActionType = "AID_REQUEST" | "DONATION_MANIFEST" | "WAITLIST_CONFIRMATION";
export interface StoredActionDraft<T = unknown> {
  id: string;
  actorId: string;
  conversationId: string;
  actionType: DraftActionType;
  idempotencyKey: string;
  payload: T;
  preview: unknown;
  expiresAt: string;
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createActionDraft(input: {
  actorId: string;
  conversationId: string;
  actionType: DraftActionType;
  idempotencyKey: string;
  payload: unknown;
  preview: unknown;
}): Promise<{ draftId: string; expiresAt: string }> {
  const draftId = randomBytes(32).toString("base64url");
  const hash = tokenHash(draftId);
  const result = await withTransaction((client) => client.query<{ id: string; expires_at: string }>(
    `INSERT INTO grn_action_drafts
       (token_hash, actor_id, conversation_id, action_type, idempotency_key, payload, preview, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, transaction_timestamp() + interval '30 minutes')
     RETURNING id, expires_at`,
    [hash, input.actorId, input.conversationId, input.actionType, input.idempotencyKey, JSON.stringify(input.payload), JSON.stringify(input.preview)],
  ));
  return { draftId, expiresAt: result.rows[0].expires_at };
}

export async function getActionDraft(token: string, actorId: string): Promise<StoredActionDraft | null> {
  const result = await withTransaction((client) => client.query<{
    id: string;
    actor_id: string;
    conversation_id: string;
    action_type: DraftActionType;
    idempotency_key: string;
    payload: unknown;
    preview: unknown;
    expires_at: string;
  }>(
    `SELECT id, actor_id, conversation_id, action_type, idempotency_key, payload, preview, expires_at
       FROM grn_action_drafts
      WHERE token_hash = $1 AND actor_id = $2 AND status = 'PENDING'
        AND expires_at > transaction_timestamp()`,
    [tokenHash(token), actorId],
  ));
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    actorId: row.actor_id,
    conversationId: row.conversation_id,
    actionType: row.action_type,
    idempotencyKey: row.idempotency_key,
    payload: row.payload,
    preview: row.preview,
    expiresAt: row.expires_at,
  };
}

export async function markActionDraftStale(token: string, actorId: string): Promise<void> {
  await withTransaction((client) => client.query(
    `UPDATE grn_action_drafts SET status = 'STALE'
      WHERE token_hash = $1 AND actor_id = $2 AND status = 'PENDING'`,
    [tokenHash(token), actorId],
  ).then(() => undefined));
}

export async function cancelPendingActionDrafts(conversationId: string, actorId: string): Promise<void> {
  await withTransaction((client) => client.query(
    `UPDATE grn_action_drafts SET status = 'CANCELLED'
      WHERE conversation_id = $1 AND actor_id = $2 AND status = 'PENDING'`,
    [conversationId, actorId],
  ).then(() => undefined));
}

export { tokenHash as hashActionDraftToken };
