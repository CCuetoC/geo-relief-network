import "server-only";

import type { PoolClient } from "@neondatabase/serverless";
import { queryRows, withTransaction } from "@/core/server/db";

export interface StoredPrivateMedia {
  id: string;
  ownerId: string;
  contentType: string;
  byteSize: number;
  /** Private database key. Never pass this value to a client or Muse Spark. */
  storageKey: string;
}

export async function insertPrivateMedia(input: {
  id: string;
  ownerId: string;
  storageKey: string;
  contentType: string;
  byteSize: number;
}) {
  await withTransaction((client) => client.query(
    `INSERT INTO grn_private_media (id, owner_id, storage_key, content_type, byte_size)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.id, input.ownerId, input.storageKey, input.contentType, input.byteSize],
  ).then(() => undefined));
}

export async function getOwnedPrivateMedia(ownerId: string, mediaIds: string[]): Promise<StoredPrivateMedia[]> {
  if (mediaIds.length === 0) return [];
  const rows = await queryRows<{
    id: string;
    owner_id: string;
    storage_key: string;
    content_type: string;
    byte_size: number;
  }>(
    `SELECT id, owner_id, storage_key, content_type, byte_size
       FROM grn_private_media
      WHERE owner_id = $1 AND id = ANY($2::uuid[]) AND status = 'AVAILABLE'`,
    [ownerId, mediaIds],
  );
  return rows.map((row) => ({
    id: row.id,
    ownerId: row.owner_id,
    storageKey: row.storage_key,
    contentType: row.content_type,
    byteSize: Number(row.byte_size),
  }));
}

export async function getAttachedManagerMedia(mediaId: string, managerId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(mediaId)) return null;
  const rows = await queryRows<{ storage_key: string; content_type: string; byte_size: number }>(
    `SELECT DISTINCT pm.storage_key, pm.content_type, pm.byte_size
       FROM grn_private_media pm
       JOIN grn_donation_manifest_lines ml ON pm.id = ANY(ml.photo_media_ids)
       JOIN grn_donation_manifests m ON m.id = ml.manifest_id
       JOIN grn_collection_point_managers mgr
         ON mgr.collection_point_id = m.collection_point_id AND mgr.user_id = $2 AND mgr.active
      WHERE pm.id = $1 AND pm.status = 'ATTACHED' AND m.status = 'PENDING'
        AND m.expires_at > transaction_timestamp()`,
    [mediaId, managerId],
  );
  return rows[0] ?? null;
}

export async function markMediaAttached(client: PoolClient, ownerId: string, ids: string[]) {
  if (ids.length === 0) return;
  const result = await client.query(
    `UPDATE grn_private_media
        SET status = 'ATTACHED'
      WHERE owner_id = $1 AND id = ANY($2::uuid[]) AND status = 'AVAILABLE'`,
    [ownerId, ids],
  );
  if (result.rowCount !== ids.length) throw new Error("Una foto ya fue usada o dejó de estar disponible.");
}
