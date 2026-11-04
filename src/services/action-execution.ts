import { randomBytes, randomInt } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import type { DonationManifest } from "@/domain/types";
import "server-only";
import { withTransaction } from "@/core/server/db";
import { fitsOnHandCapacity, isAdvisoryDeliveryTimeValid } from "@/domain/inventory-policy";
import { hashActionDraftToken } from "@/services/action-drafts";
import { markMediaAttached } from "@/repositories/private-media-repository";
import { lockInventoryControls, readAvailableStock, readInventorySnapshots } from "@/repositories/inventory-repository";
import { reconcileAndAdvanceQueue } from "@/services/queue-service";

export interface AidDraftPayload {
  channel: "WEB" | "WHATSAPP";
  pointId: string;
  zone: string;
  mobility: "NEARBY_ONLY" | "CAN_TRAVEL";
  availabilityWindow: { start: string; end: string };
  items: Array<{
    productId: string;
    productName: string;
    requestedQuantity: number;
    reserveQuantity: number;
    expectedAvailable: number;
  }>;
}

export interface ManifestDraftPayload {
  channel: "WEB" | "WHATSAPP";
  pointId: string;
  zone: string;
  estimatedDeliveryAt: string;
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
    photoMediaIds: string[];
  }>;
}

export interface WaitlistConfirmationDraftPayload {
  reservationId: string;
  availabilityWindow: { start: string; end: string };
}

export type ActionExecutionResult = { notificationOutboxIds?: string[] } & (
  | { status: "NOT_FOUND" | "EXPIRED" | "ALREADY_USED" }
  | { status: "STALE"; actionType: "AID_REQUEST" | "DONATION_MANIFEST" | "WAITLIST_CONFIRMATION"; payload: AidDraftPayload | ManifestDraftPayload | WaitlistConfirmationDraftPayload }
  | { status: "COMPLETED"; actionType: "AID_REQUEST"; requestId: string; reservations: Array<{ productName: string; quantity: number; pickupCode: string }>; waiting: Array<{ productName: string; quantity: number }> }
  | { status: "COMPLETED"; actionType: "DONATION_MANIFEST"; manifestId: string; code: string }
  | { status: "COMPLETED"; actionType: "WAITLIST_CONFIRMATION"; quantity: number; productName: string; pickupCode: string }
);

function validTime(value: string | undefined): number | null {
  if (!value || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hours, mins] = value.split(":").map(Number);
  return hours * 60 + mins;
}

async function pointHours(client: PoolClient, pointId: string) {
  const result = await client.query<{
    active: boolean;
    timezone: string;
    same_day_cutoff_minutes: number;
    intake_capacity: number;
    pickup_capacity: number;
    opens_at: string | null;
    closes_at: string | null;
    local_time: string;
    closes_at_instant: string | null;
  }>(
    `SELECT cp.active, cp.timezone, cp.same_day_cutoff_minutes,
            cp.intake_capacity, cp.pickup_capacity,
            h.opens_at::text AS opens_at, h.closes_at::text AS closes_at,
            (transaction_timestamp() AT TIME ZONE cp.timezone)::time::text AS local_time,
            CASE WHEN h.closes_at IS NULL THEN NULL ELSE
              (((transaction_timestamp() AT TIME ZONE cp.timezone)::date + h.closes_at) AT TIME ZONE cp.timezone)::text
            END AS closes_at_instant
       FROM grn_collection_points cp
       LEFT JOIN grn_collection_point_hours h
         ON h.collection_point_id = cp.id
        AND h.weekday = EXTRACT(DOW FROM transaction_timestamp() AT TIME ZONE cp.timezone)::int
      WHERE cp.id = $1
      FOR UPDATE OF cp`,
    [pointId],
  );
  return result.rows[0] ?? null;
}

function isTodayWindowValid(point: NonNullable<Awaited<ReturnType<typeof pointHours>>>, window: { start: string; end: string }) {
  const now = validTime(point.local_time.slice(0, 5));
  const open = validTime(point.opens_at?.slice(0, 5));
  const close = validTime(point.closes_at?.slice(0, 5));
  const start = validTime(window.start);
  const end = validTime(window.end);
  return Boolean(
    point.active && now !== null && open !== null && close !== null && start !== null && end !== null &&
    now < close - Number(point.same_day_cutoff_minutes) &&
    start >= now && start >= open && end > start && end <= close,
  );
}

async function replayAidRequest(client: PoolClient, actorId: string, idempotencyKey: string) {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM grn_aid_requests WHERE requester_id = $1 AND idempotency_key = $2`,
    [actorId, idempotencyKey],
  );
  const requestId = existing.rows[0]?.id;
  if (!requestId) return null;

  const [reservationRows, waitingRows] = await Promise.all([
    client.query<{ product_name: string; quantity: number; pickup_code: string }>(
      `SELECT p.name AS product_name, r.quantity, r.pickup_code
         FROM grn_reservation_commitments r
         JOIN grn_aid_request_items i ON i.id = r.request_item_id
         JOIN grn_products p ON p.id = i.product_id
        WHERE i.request_id = $1 AND r.status = 'ACTIVE'
          AND r.expires_at > transaction_timestamp()
        ORDER BY r.created_at, r.id`,
      [requestId],
    ),
    client.query<{ product_name: string; quantity: number }>(
      `SELECT p.name AS product_name, SUM(i.waiting_quantity)::int AS quantity
         FROM grn_aid_request_items i
         JOIN grn_products p ON p.id = i.product_id
        WHERE i.request_id = $1 AND i.waiting_quantity > 0
        GROUP BY p.name ORDER BY p.name`,
      [requestId],
    ),
  ]);
  await client.query(
    `UPDATE grn_action_drafts SET status = 'CONSUMED', consumed_at = transaction_timestamp()
      WHERE actor_id = $1 AND idempotency_key = $2 AND status = 'PENDING'`,
    [actorId, idempotencyKey],
  );
  return {
    status: "COMPLETED" as const,
    actionType: "AID_REQUEST" as const,
    requestId,
    reservations: reservationRows.rows.map((row) => ({
      productName: row.product_name,
      quantity: Number(row.quantity),
      pickupCode: row.pickup_code,
    })),
    waiting: waitingRows.rows.map((row) => ({ productName: row.product_name, quantity: Number(row.quantity) })),
  };
}

async function replayDonationManifest(client: PoolClient, actorId: string, idempotencyKey: string) {
  const existing = await client.query<{ id: string; code: string }>(
    `SELECT id, code FROM grn_donation_manifests WHERE donor_id = $1 AND idempotency_key = $2`,
    [actorId, idempotencyKey],
  );
  const manifest = existing.rows[0];
  if (!manifest) return null;
  await client.query(
    `UPDATE grn_action_drafts SET status = 'CONSUMED', consumed_at = transaction_timestamp()
      WHERE actor_id = $1 AND idempotency_key = $2 AND status = 'PENDING'`,
    [actorId, idempotencyKey],
  );
  return { status: "COMPLETED" as const, actionType: "DONATION_MANIFEST" as const, manifestId: manifest.id, code: manifest.code };
}

async function executeAidRequest(
  client: PoolClient,
  input: { actorId: string; conversationId: string; idempotencyKey: string; payload: AidDraftPayload },
): Promise<Extract<ActionExecutionResult, { status: "COMPLETED" | "STALE" }>> {
  const replay = await replayAidRequest(client, input.actorId, input.idempotencyKey);
  if (replay) return replay;

  const point = await pointHours(client, input.payload.pointId);
  const replayAfterPointLock = await replayAidRequest(client, input.actorId, input.idempotencyKey);
  if (replayAfterPointLock) return replayAfterPointLock;
  if (!point || !isTodayWindowValid(point, input.payload.availabilityWindow)) return { status: "STALE", actionType: "AID_REQUEST", payload: input.payload };

  const productIds = input.payload.items.map((item) => item.productId);
  if (new Set(productIds).size !== productIds.length) {
    return { status: "STALE", actionType: "AID_REQUEST", payload: input.payload };
  }
  const lockedProductIds = await lockInventoryControls(client, input.payload.pointId, productIds);
  if (lockedProductIds.length !== productIds.length) throw new Error("Falta configurar el inventario de un producto en ese punto.");
  const notificationOutboxIds: string[] = [];

  for (const productId of productIds) {
    const expired = await client.query<{ due: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM grn_reservation_commitments
          WHERE collection_point_id = $1 AND product_id = $2
            AND status IN ('PENDING_CONFIRMATION', 'ACTIVE')
            AND expires_at <= transaction_timestamp()
       ) AS due`,
      [input.payload.pointId, productId],
    );
    if (expired.rows[0]?.due) {
      const reconciled = await reconcileAndAdvanceQueue(client, input.payload.pointId, productId);
      notificationOutboxIds.push(...reconciled.notificationOutboxIds);
    }
  }

  for (const item of input.payload.items) {
    const current = await readAvailableStock(client, input.payload.pointId, item.productId);
    const policy = await client.query<{ max_per_request: number }>(
      `SELECT max_per_request FROM grn_collection_point_products
        WHERE collection_point_id = $1 AND product_id = $2`,
      [input.payload.pointId, item.productId],
    );
    const queue = await client.query<{ has_priority: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM grn_waitlist_entries
          WHERE collection_point_id = $1 AND product_id = $2
            AND status = 'WAITING' AND quantity > 0
       ) AS has_priority`,
      [input.payload.pointId, item.productId],
    );
    const hasOlderWaitlist = queue.rows[0]?.has_priority === true;
    const partialQuantity = current !== null && current > 0 && current < item.requestedQuantity;
    if (current === null || current !== item.expectedAvailable || item.reserveQuantity > current ||
        !policy.rows[0] || item.requestedQuantity > policy.rows[0].max_per_request ||
        (item.reserveQuantity !== 0 && item.reserveQuantity !== item.requestedQuantity) ||
        (item.reserveQuantity > 0 && hasOlderWaitlist) ||
        (partialQuantity && !hasOlderWaitlist)) {
      return { status: "STALE", actionType: "AID_REQUEST", payload: input.payload, notificationOutboxIds };
    }
  }

  const slot = await client.query<{ start_at: string; end_at: string; active_count: number }>(
    `SELECT
       (((transaction_timestamp() AT TIME ZONE $1)::date + $2::time) AT TIME ZONE $1)::text AS start_at,
       (((transaction_timestamp() AT TIME ZONE $1)::date + $3::time) AT TIME ZONE $1)::text AS end_at,
       (SELECT COUNT(DISTINCT i.request_id)::int
          FROM grn_reservation_commitments r
          JOIN grn_aid_request_items i ON i.id = r.request_item_id
         WHERE r.collection_point_id = $4
           AND r.status IN ('PENDING_CONFIRMATION', 'ACTIVE')
           AND r.expires_at > transaction_timestamp()
           AND (r.created_at AT TIME ZONE $1)::date = (transaction_timestamp() AT TIME ZONE $1)::date) AS active_count`,
    [point.timezone, input.payload.availabilityWindow.start, input.payload.availabilityWindow.end, input.payload.pointId],
  );
  if (input.payload.items.some((item) => item.reserveQuantity > 0) &&
      Number(slot.rows[0]?.active_count ?? 0) >= Number(point.pickup_capacity)) {
    return { status: "STALE", actionType: "AID_REQUEST", payload: input.payload, notificationOutboxIds };
  }

  const inserted = await client.query<{ id: string; submitted_at: string }>(
    `INSERT INTO grn_aid_requests
       (requester_id, idempotency_key, zone, mobility, availability_window)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (requester_id, idempotency_key) DO NOTHING
     RETURNING id, submitted_at`,
    [input.actorId, input.idempotencyKey, input.payload.zone, input.payload.mobility, JSON.stringify(input.payload.availabilityWindow)],
  );
  if (inserted.rows.length === 0) {
    const replay = await replayAidRequest(client, input.actorId, input.idempotencyKey);
    if (!replay) throw new Error("Idempotency conflict did not return the existing request.");
    return { ...replay, notificationOutboxIds };
  }

  const requestId = inserted.rows[0].id;
  const reservations: Array<{ productName: string; quantity: number; pickupCode: string }> = [];
  const waiting: Array<{ productName: string; quantity: number }> = [];
  for (const item of input.payload.items) {
    const sequence = await client.query<{ fifo_sequence: string }>(
      `UPDATE grn_inventory_controls
          SET next_fifo_sequence = next_fifo_sequence + 1, updated_at = transaction_timestamp()
        WHERE collection_point_id = $1 AND product_id = $2
        RETURNING (next_fifo_sequence - 1)::text AS fifo_sequence`,
      [input.payload.pointId, item.productId],
    );
    const waitingQuantity = item.requestedQuantity - item.reserveQuantity;
    const requestItem = await client.query<{ id: string }>(
      `INSERT INTO grn_aid_request_items
         (request_id, collection_point_id, product_id, requested_quantity, waiting_quantity, fifo_sequence)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [requestId, input.payload.pointId, item.productId, item.requestedQuantity, waitingQuantity, sequence.rows[0].fifo_sequence],
    );
    if (item.reserveQuantity > 0) {
      const code = randomInt(10_000_000, 100_000_000).toString();
      await client.query(
        `INSERT INTO grn_reservation_commitments
           (request_item_id, collection_point_id, product_id, quantity, status, expires_at,
            pickup_window_start, pickup_window_end, pickup_code)
         VALUES ($1, $2, $3, $4, 'ACTIVE', $5::timestamptz, $6::timestamptz, $7::timestamptz, $8)`,
        [requestItem.rows[0].id, input.payload.pointId, item.productId, item.reserveQuantity,
          point.closes_at_instant, slot.rows[0].start_at, slot.rows[0].end_at, code],
      );
      reservations.push({ productName: item.productName, quantity: item.reserveQuantity, pickupCode: code });
      await client.query(
        `INSERT INTO grn_lifecycle_events (aggregate_type, aggregate_id, event_type, actor_id, metadata)
         VALUES ('RESERVATION', (SELECT id FROM grn_reservation_commitments WHERE pickup_code = $1), 'RESERVATION_CREATED', $2, $3::jsonb)`,
        [code, input.actorId, JSON.stringify({ quantity: item.reserveQuantity, requestId })],
      );
    }
    if (waitingQuantity > 0) waiting.push({ productName: item.productName, quantity: waitingQuantity });
    if (waitingQuantity > 0) {
      await client.query(
        `INSERT INTO grn_waitlist_entries
           (request_item_id, collection_point_id, product_id, quantity, fifo_sequence)
         VALUES ($1, $2, $3, $4, $5)`,
        [requestItem.rows[0].id, input.payload.pointId, item.productId, waitingQuantity, sequence.rows[0].fifo_sequence],
      );
    }
    await client.query(
      `INSERT INTO grn_lifecycle_events (aggregate_type, aggregate_id, event_type, actor_id, metadata)
       VALUES ('REQUEST_ITEM', $1, 'DEMAND_SUBMITTED', $2, $3::jsonb)`,
      [requestItem.rows[0].id, input.actorId, JSON.stringify({ requestedQuantity: item.requestedQuantity, waitingQuantity })],
    );
  }
  await client.query(
    `INSERT INTO grn_lifecycle_events (aggregate_type, aggregate_id, event_type, actor_id, metadata)
     VALUES ('AID_REQUEST', $1, 'AID_REQUEST_SUBMITTED', $2, $3::jsonb)`,
    [requestId, input.actorId, JSON.stringify({ zone: input.payload.zone })],
  );
  await client.query(
    `UPDATE grn_action_drafts SET status = 'CONSUMED', consumed_at = transaction_timestamp()
      WHERE actor_id = $1 AND idempotency_key = $2 AND status = 'PENDING'`,
    [input.actorId, input.idempotencyKey],
  );
  await client.query("DELETE FROM grn_conversation_contexts WHERE id = $1 AND actor_id = $2", [input.conversationId, input.actorId]);
  return { status: "COMPLETED", actionType: "AID_REQUEST", requestId, reservations, waiting, notificationOutboxIds };
}

async function executeDonationManifest(
  client: PoolClient,
  input: { actorId: string; conversationId: string; idempotencyKey: string; payload: ManifestDraftPayload },
): Promise<Extract<ActionExecutionResult, { status: "COMPLETED" | "STALE" }>> {
  const replay = await replayDonationManifest(client, input.actorId, input.idempotencyKey);
  if (replay) return replay;

  const point = await pointHours(client, input.payload.pointId);
  const replayAfterPointLock = await replayDonationManifest(client, input.actorId, input.idempotencyKey);
  if (replayAfterPointLock) return replayAfterPointLock;
  if (!point?.active || !point.opens_at || !point.closes_at || !point.closes_at_instant) {
    return { status: "STALE", actionType: "DONATION_MANIFEST", payload: input.payload };
  }
  const deliverySlot = await client.query<{ same_local_date: boolean; eta_time: string; current_time: string }>(
    `SELECT ($1::timestamptz AT TIME ZONE $2)::date = (transaction_timestamp() AT TIME ZONE $2)::date AS same_local_date,
            to_char(date_trunc('minute', $1::timestamptz AT TIME ZONE $2), 'HH24:MI') AS eta_time,
            to_char(date_trunc('minute', transaction_timestamp() AT TIME ZONE $2), 'HH24:MI') AS current_time`,
    [input.payload.estimatedDeliveryAt, point.timezone],
  );
  const delivery = deliverySlot.rows[0];
  const etaMinute = validTime(delivery?.eta_time);
  const currentMinute = validTime(delivery?.current_time);
  const opensMinute = validTime(point.opens_at.slice(0, 5));
  const closesMinute = validTime(point.closes_at.slice(0, 5));
  if (!delivery?.same_local_date || etaMinute === null || currentMinute === null || opensMinute === null || closesMinute === null ||
      !isAdvisoryDeliveryTimeValid({ etaMinute, nowMinute: currentMinute, opensAtMinute: opensMinute, closesAtMinute: closesMinute })) {
    return { status: "STALE", actionType: "DONATION_MANIFEST", payload: input.payload };
  }
  const mediaIds = [...new Set(input.payload.items.flatMap((item) => item.photoMediaIds))];
  const media = await client.query<{ id: string; owner_id: string; status: string }>(
    `SELECT id, owner_id, status FROM grn_private_media
      WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
    [mediaIds],
  );
  if (media.rows.length !== mediaIds.length || media.rows.some((row) => row.owner_id !== input.actorId || row.status !== "AVAILABLE")) {
    return { status: "STALE", actionType: "DONATION_MANIFEST", payload: input.payload };
  }

  const activeCount = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM grn_donation_manifests
      WHERE collection_point_id = $1
        AND (status = 'VALIDATED' OR (status = 'PENDING' AND expires_at > transaction_timestamp()))
        AND (created_at AT TIME ZONE $2)::date = (transaction_timestamp() AT TIME ZONE $2)::date`,
    [input.payload.pointId, point.timezone],
  );
  if (Number(activeCount.rows[0]?.count ?? 0) >= Number(point.intake_capacity)) {
    return { status: "STALE", actionType: "DONATION_MANIFEST", payload: input.payload };
  }

  const quantitiesByProduct = new Map<string, number>();
  for (const item of input.payload.items) quantitiesByProduct.set(item.productId, (quantitiesByProduct.get(item.productId) ?? 0) + item.quantity);
  const productIds = [...quantitiesByProduct.keys()].sort();
  const lockedProductIds = await lockInventoryControls(client, input.payload.pointId, productIds);
  if (lockedProductIds.length !== productIds.length) {
    return { status: "STALE", actionType: "DONATION_MANIFEST", payload: input.payload };
  }
  const snapshots = await readInventorySnapshots(client, input.payload.pointId, productIds);
  if (snapshots.length !== productIds.length || snapshots.some((snapshot) => !fitsOnHandCapacity({
    confirmedOnHand: Number(snapshot.confirmed_on_hand),
    expectedInbound: Number(snapshot.expected_inbound),
    proposedQuantity: quantitiesByProduct.get(snapshot.product_id) ?? 0,
    maxOnHand: Number(snapshot.max_on_hand),
  }))) {
    return { status: "STALE", actionType: "DONATION_MANIFEST", payload: input.payload };
  }

  const code = randomBytes(6).toString("hex").toUpperCase();
  const result = await client.query<{ id: string }>(
    `INSERT INTO grn_donation_manifests
       (donor_id, collection_point_id, idempotency_key, code, estimated_delivery_at, expires_at)
     VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz)
     ON CONFLICT (donor_id, idempotency_key) DO NOTHING
     RETURNING id`,
    [input.actorId, input.payload.pointId, input.idempotencyKey, code, input.payload.estimatedDeliveryAt, point.closes_at_instant],
  );
  if (!result.rows[0]) {
    const existing = await client.query<{ id: string; code: string }>(
      "SELECT id, code FROM grn_donation_manifests WHERE donor_id = $1 AND idempotency_key = $2",
      [input.actorId, input.idempotencyKey],
    );
    await client.query(
      "UPDATE grn_action_drafts SET status = 'CONSUMED', consumed_at = transaction_timestamp() WHERE actor_id = $1 AND idempotency_key = $2 AND status = 'PENDING'",
      [input.actorId, input.idempotencyKey],
    );
    return { status: "COMPLETED", actionType: "DONATION_MANIFEST", manifestId: existing.rows[0].id, code: existing.rows[0].code };
  }

  const manifestId = result.rows[0].id;
  for (const item of input.payload.items) {
    await client.query(
      `INSERT INTO grn_donation_manifest_lines
         (manifest_id, collection_point_id, product_id, declared_quantity, photo_media_ids)
       VALUES ($1, $2, $3, $4, $5::uuid[])`,
      [manifestId, input.payload.pointId, item.productId, item.quantity, item.photoMediaIds],
    );
  }
  await markMediaAttached(client, input.actorId, mediaIds);
  await client.query(
    `INSERT INTO grn_lifecycle_events (aggregate_type, aggregate_id, event_type, actor_id, metadata)
     VALUES ('MANIFEST', $1, 'MANIFEST_CREATED_PENDING_PHYSICAL_VALIDATION', $2, $3::jsonb)`,
    [manifestId, input.actorId, JSON.stringify({ lineCount: input.payload.items.length, photoCount: mediaIds.length })],
  );
  await client.query(
    `UPDATE grn_action_drafts SET status = 'CONSUMED', consumed_at = transaction_timestamp()
      WHERE actor_id = $1 AND idempotency_key = $2 AND status = 'PENDING'`,
    [input.actorId, input.idempotencyKey],
  );
  await client.query("DELETE FROM grn_conversation_contexts WHERE id = $1 AND actor_id = $2", [input.conversationId, input.actorId]);
  return { status: "COMPLETED", actionType: "DONATION_MANIFEST", manifestId, code };
}

async function executeWaitlistConfirmation(
  client: PoolClient,
  input: { actorId: string; conversationId: string; idempotencyKey: string; payload: WaitlistConfirmationDraftPayload },
): Promise<Extract<ActionExecutionResult, { status: "COMPLETED" | "STALE" }>> {
  const identity = await client.query<{ point_id: string; product_id: string }>(
    `SELECT r.collection_point_id AS point_id, r.product_id
       FROM grn_reservation_commitments r
       JOIN grn_aid_request_items i ON i.id = r.request_item_id
       JOIN grn_aid_requests ar ON ar.id = i.request_id
      WHERE r.id = $1 AND ar.requester_id = $2`,
    [input.payload.reservationId, input.actorId],
  );
  const key = identity.rows[0];
  if (!key) return { status: "STALE", actionType: "WAITLIST_CONFIRMATION", payload: input.payload };
  const control = await client.query(
    `SELECT 1 FROM grn_inventory_controls
      WHERE collection_point_id = $1 AND product_id = $2 FOR UPDATE`,
    [key.point_id, key.product_id],
  );
  if (!control.rows.length) return { status: "STALE", actionType: "WAITLIST_CONFIRMATION", payload: input.payload };
  const found = await client.query<{
    id: string; request_item_id: string; point_id: string; product_id: string; quantity: number;
    product_name: string; active: boolean; timezone: string; same_day_cutoff_minutes: number;
    intake_capacity: number; pickup_capacity: number;
    opens_at: string | null; closes_at: string | null; local_time: string; closes_at_instant: string | null;
    fifo_entry_id: string | null;
  }>(
    `SELECT r.id, r.request_item_id, r.collection_point_id AS point_id, r.product_id, r.quantity,
            p.name AS product_name, cp.active, cp.timezone, cp.same_day_cutoff_minutes,
            cp.intake_capacity, cp.pickup_capacity,
            h.opens_at::text AS opens_at, h.closes_at::text AS closes_at,
            (transaction_timestamp() AT TIME ZONE cp.timezone)::time::text AS local_time,
            CASE WHEN h.closes_at IS NULL THEN NULL ELSE
              (((transaction_timestamp() AT TIME ZONE cp.timezone)::date + h.closes_at) AT TIME ZONE cp.timezone)::text
            END AS closes_at_instant,
            r.waitlist_entry_id AS fifo_entry_id
       FROM grn_reservation_commitments r
       JOIN grn_aid_request_items i ON i.id = r.request_item_id
       JOIN grn_aid_requests ar ON ar.id = i.request_id
       JOIN grn_products p ON p.id = r.product_id
       JOIN grn_collection_points cp ON cp.id = r.collection_point_id
       LEFT JOIN grn_collection_point_hours h
         ON h.collection_point_id = cp.id
        AND h.weekday = EXTRACT(DOW FROM transaction_timestamp() AT TIME ZONE cp.timezone)::int
      WHERE r.id = $1 AND ar.requester_id = $2 AND r.status = 'PENDING_CONFIRMATION'
        AND r.expires_at > transaction_timestamp()
      FOR UPDATE OF r`,
    [input.payload.reservationId, input.actorId],
  );
  const offer = found.rows[0];
  if (!offer) return { status: "STALE", actionType: "WAITLIST_CONFIRMATION", payload: input.payload };
  const valid = isTodayWindowValid(offer, input.payload.availabilityWindow);
  if (!valid || !offer.closes_at_instant) {
    return { status: "STALE", actionType: "WAITLIST_CONFIRMATION", payload: input.payload };
  }
  const code = randomInt(10_000_000, 100_000_000).toString();
  await client.query(
    `UPDATE grn_reservation_commitments
        SET status = 'ACTIVE', pickup_code = $2, expires_at = $3::timestamptz,
            pickup_window_start = (((transaction_timestamp() AT TIME ZONE $4)::date + $5::time) AT TIME ZONE $4),
            pickup_window_end = (((transaction_timestamp() AT TIME ZONE $4)::date + $6::time) AT TIME ZONE $4),
            updated_at = transaction_timestamp()
      WHERE id = $1`,
    [offer.id, code, offer.closes_at_instant, offer.timezone, input.payload.availabilityWindow.start, input.payload.availabilityWindow.end],
  );
  if (offer.fifo_entry_id) {
    await client.query(
      `UPDATE grn_waitlist_entries SET status = 'FULFILLED', updated_at = transaction_timestamp()
        WHERE id = $1 AND status = 'OFFERED'`,
      [offer.fifo_entry_id],
    );
  }
  await client.query(
    `INSERT INTO grn_lifecycle_events (aggregate_type, aggregate_id, event_type, actor_id, metadata)
     VALUES ('RESERVATION', $1, 'FIFO_OFFER_ACCEPTED', $2, $3::jsonb)`,
    [offer.id, input.actorId, JSON.stringify({ quantity: offer.quantity, waitlistEntryId: offer.fifo_entry_id })],
  );
  await client.query(
    `UPDATE grn_action_drafts SET status = 'CONSUMED', consumed_at = transaction_timestamp()
      WHERE actor_id = $1 AND idempotency_key = $2 AND status = 'PENDING'`,
    [input.actorId, input.idempotencyKey],
  );
  await client.query("DELETE FROM grn_conversation_contexts WHERE id = $1 AND actor_id = $2", [input.conversationId, input.actorId]);
  return { status: "COMPLETED", actionType: "WAITLIST_CONFIRMATION", quantity: Number(offer.quantity), productName: offer.product_name, pickupCode: code };
}

export async function executeConfirmedAction(token: string, actorId: string): Promise<ActionExecutionResult> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return { status: "NOT_FOUND" };
  const hash = hashActionDraftToken(token);
  return withTransaction(async (client) => {
    const found = await client.query<{
      id: string;
      conversation_id: string;
      action_type: "AID_REQUEST" | "DONATION_MANIFEST" | "WAITLIST_CONFIRMATION";
      idempotency_key: string;
      payload: AidDraftPayload | ManifestDraftPayload | WaitlistConfirmationDraftPayload;
      status: string;
      expires_at: string;
    }>(
      `SELECT id, conversation_id, action_type, idempotency_key, payload, status, expires_at
         FROM grn_action_drafts
        WHERE token_hash = $1 AND actor_id = $2
        FOR UPDATE`,
      [hash, actorId],
    );
    const draft = found.rows[0];
    if (!draft) return { status: "NOT_FOUND" };
    if (draft.status !== "PENDING") return { status: "ALREADY_USED" };
    const expiry = await client.query<{ expired: boolean }>(
      "SELECT $1::timestamptz <= transaction_timestamp() AS expired",
      [draft.expires_at],
    );
    if (expiry.rows[0]?.expired) {
      await client.query("UPDATE grn_action_drafts SET status = 'EXPIRED' WHERE id = $1", [draft.id]);
      return { status: "EXPIRED" };
    }
    if (draft.action_type === "AID_REQUEST") {
      return executeAidRequest(client, {
        actorId,
        conversationId: draft.conversation_id,
        idempotencyKey: draft.idempotency_key,
        payload: draft.payload as AidDraftPayload,
      });
    }
    if (draft.action_type === "WAITLIST_CONFIRMATION") {
      return executeWaitlistConfirmation(client, {
        actorId,
        conversationId: draft.conversation_id,
        idempotencyKey: draft.idempotency_key,
        payload: draft.payload as WaitlistConfirmationDraftPayload,
      });
    }
    return executeDonationManifest(client, {
      actorId,
      conversationId: draft.conversation_id,
      idempotencyKey: draft.idempotency_key,
      payload: draft.payload as ManifestDraftPayload,
    });
  });
}
