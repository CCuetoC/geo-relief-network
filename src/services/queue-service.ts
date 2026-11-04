import "server-only";
import type { PoolClient } from "@neondatabase/serverless";
import { queryRows, withTransaction } from "@/core/server/db";
import { readAvailableStock } from "@/repositories/inventory-repository";
import type { Locale } from "@/domain/types";

interface OfferRow {
  reservation_id: string;
  request_item_id: string;
  waitlist_entry_id: string | null;
  requester_id: string;
  product_id: string;
  product_name: string;
  point_id: string;
  point_name: string;
  quantity: number;
  status: "PENDING_CONFIRMATION" | "ACTIVE";
}

async function nextSequence(client: PoolClient, pointId: string, productId: string) {
  const result = await client.query<{ sequence: string }>(
    `UPDATE grn_inventory_controls
        SET next_fifo_sequence = next_fifo_sequence + 1, updated_at = transaction_timestamp()
      WHERE collection_point_id = $1 AND product_id = $2
      RETURNING (next_fifo_sequence - 1)::text AS sequence`,
    [pointId, productId],
  );
  if (!result.rows[0]) throw new Error("No existe control de inventario para el punto/producto.");
  return result.rows[0].sequence;
}

async function queueNotification(client: PoolClient, input: {
  userId: string; eventType: string; reservationId: string; expiresAt: string;
  quantity: number; productName: string; pointName: string; timeZone: string;
  productNames?: { en?: string; es?: string };
}) {
  const payload = JSON.stringify({
    reservationId: input.reservationId,
    expiresAt: input.expiresAt,
    quantity: input.quantity,
    productName: input.productName,
    productNames: input.productNames,
    pointName: input.pointName,
    timeZone: input.timeZone,
  });
  await client.query(
    `INSERT INTO grn_notification_outbox (recipient_user_id, channel, event_type, payload)
     VALUES ($1, 'WEB', $2, $3::jsonb)`,
    [input.userId, input.eventType, payload],
  );
  const whatsapp = await client.query<{ id: string }>(
    `INSERT INTO grn_notification_outbox (recipient_user_id, channel, event_type, payload)
     SELECT $1, 'WHATSAPP', $2, $3::jsonb
      WHERE EXISTS (SELECT 1 FROM grn_whatsapp_links WHERE user_id = $1)
     RETURNING id`,
    [input.userId, input.eventType, payload],
  );
  return whatsapp.rows[0]?.id ?? null;
}

async function requeueExpiredOffer(client: PoolClient, row: OfferRow) {
  if (row.waitlist_entry_id) {
    await client.query(
      `UPDATE grn_waitlist_entries SET status = 'CANCELLED', updated_at = transaction_timestamp()
        WHERE id = $1 AND status = 'OFFERED'`,
      [row.waitlist_entry_id],
    );
  }
  const sequence = await nextSequence(client, row.point_id, row.product_id);
  const created = await client.query<{ id: string }>(
    `INSERT INTO grn_waitlist_entries
       (request_item_id, collection_point_id, product_id, quantity, fifo_sequence, status)
     VALUES ($1, $2, $3, $4, $5, 'WAITING')
     RETURNING id`,
    [row.request_item_id, row.point_id, row.product_id, row.quantity, sequence],
  );
  await client.query(
    `UPDATE grn_aid_request_items SET waiting_quantity = waiting_quantity + $2 WHERE id = $1`,
    [row.request_item_id, row.quantity],
  );
  return created.rows[0]?.id;
}

/** Caller must hold the common inventory-control row lock for this point/product. */
export async function reconcileAndAdvanceQueue(client: PoolClient, pointId: string, productId: string) {
  const notificationOutboxIds: string[] = [];
  const pointClock = await client.query<{ may_offer: boolean; capacity_remaining: number }>(
     `SELECT COALESCE(
       h.opens_at <= date_trunc('minute', transaction_timestamp() AT TIME ZONE cp.timezone)::time
       AND h.closes_at - date_trunc('minute', transaction_timestamp() AT TIME ZONE cp.timezone)::time >
         make_interval(mins => cp.same_day_cutoff_minutes), false
     ) AS may_offer,
     GREATEST(cp.pickup_capacity - (
       SELECT COUNT(DISTINCT i.request_id)::int
         FROM grn_reservation_commitments r
         JOIN grn_aid_request_items i ON i.id = r.request_item_id
        WHERE r.collection_point_id = cp.id AND r.status IN ('PENDING_CONFIRMATION', 'ACTIVE')
          AND r.expires_at > transaction_timestamp()
          AND (r.created_at AT TIME ZONE cp.timezone)::date = (transaction_timestamp() AT TIME ZONE cp.timezone)::date
     ), 0)::int AS capacity_remaining
       FROM grn_collection_points cp
       LEFT JOIN grn_collection_point_hours h
         ON h.collection_point_id = cp.id
        AND h.weekday = EXTRACT(DOW FROM transaction_timestamp() AT TIME ZONE cp.timezone)::int
      WHERE cp.id = $1 AND cp.active`,
    [pointId],
  );
  const mayOffer = pointClock.rows[0]?.may_offer === true;
  const capacityRemaining = Number(pointClock.rows[0]?.capacity_remaining ?? 0);

  const expired = await client.query<OfferRow>(
    `SELECT r.id AS reservation_id, r.request_item_id, r.waitlist_entry_id,
            ar.requester_id, r.product_id, p.name AS product_name,
            r.collection_point_id AS point_id, cp.name AS point_name,
            r.quantity, r.status
       FROM grn_reservation_commitments r
       JOIN grn_aid_request_items i ON i.id = r.request_item_id
       JOIN grn_aid_requests ar ON ar.id = i.request_id
       JOIN grn_products p ON p.id = r.product_id
       JOIN grn_collection_points cp ON cp.id = r.collection_point_id
      WHERE r.collection_point_id = $1 AND r.product_id = $2
        AND r.status IN ('PENDING_CONFIRMATION', 'ACTIVE')
        AND r.expires_at <= transaction_timestamp()
      ORDER BY r.expires_at, r.id
      FOR UPDATE OF r`,
    [pointId, productId],
  );
  const requeuedEntryIds: string[] = [];
  for (const hold of expired.rows) {
    await client.query(
      `UPDATE grn_reservation_commitments
          SET status = 'EXPIRED', updated_at = transaction_timestamp()
        WHERE id = $1`,
      [hold.reservation_id],
    );
    const requeuedEntryId = await requeueExpiredOffer(client, hold);
    if (requeuedEntryId) requeuedEntryIds.push(requeuedEntryId);
    await client.query(
      `INSERT INTO grn_lifecycle_events (aggregate_type, aggregate_id, event_type, metadata)
       VALUES ('RESERVATION', $1, 'COMMITMENT_EXPIRED_REQUEUED', $2::jsonb)`,
      [hold.reservation_id, JSON.stringify({ quantity: hold.quantity, pointId, productId })],
    );
  }

  if (!mayOffer || capacityRemaining <= 0) return { offers: 0, notificationOutboxIds };
  let available = Number(await readAvailableStock(client, pointId, productId) ?? 0);
  let created = 0;
  while (available > 0 && created < Math.min(100, capacityRemaining)) {
    const next = await client.query<{
      id: string; request_item_id: string; requester_id: string; quantity: number;
      fifo_sequence: string; product_name: string; product_names: { en?: { name?: string }; es?: { name?: string } }; point_name: string; time_zone: string;
    }>(
      `SELECT w.id, w.request_item_id, ar.requester_id, w.quantity, w.fifo_sequence::text,
              p.name AS product_name, p.localized_content AS product_names,
              cp.name AS point_name, cp.timezone AS time_zone, h.closes_at::text AS closes_at
         FROM grn_waitlist_entries w
         JOIN grn_aid_request_items i ON i.id = w.request_item_id
         JOIN grn_aid_requests ar ON ar.id = i.request_id
         JOIN grn_products p ON p.id = w.product_id
         JOIN grn_collection_points cp ON cp.id = w.collection_point_id
         LEFT JOIN grn_collection_point_hours h
           ON h.collection_point_id = cp.id
          AND h.weekday = EXTRACT(DOW FROM transaction_timestamp() AT TIME ZONE cp.timezone)::int
        WHERE w.collection_point_id = $1 AND w.product_id = $2 AND w.status = 'WAITING' AND w.quantity > 0
          AND NOT (w.id = ANY($3::uuid[]))
        ORDER BY w.fifo_sequence, w.id
        LIMIT 1 FOR UPDATE OF w`,
      [pointId, productId, requeuedEntryIds],
    );
    const candidate = next.rows[0];
    if (!candidate) break;
    // A product line is indivisible: never split one submitted request across
    // an offer and a remaining waitlist segment. Strict FIFO also means a
    // smaller later request cannot bypass this head-of-line entry.
    if (Number(candidate.quantity) > available) break;
    const quantity = Number(candidate.quantity);

    let offerEntryId: string;
    const offeredEntry = await client.query<{ id: string }>(
      `UPDATE grn_waitlist_entries SET status = 'OFFERED', updated_at = transaction_timestamp()
        WHERE id = $1 RETURNING id`,
      [candidate.id],
    );
    offerEntryId = offeredEntry.rows[0].id;
    await client.query(
      `UPDATE grn_aid_request_items SET waiting_quantity = GREATEST(waiting_quantity - $2, 0)
        WHERE id = $1`,
      [candidate.request_item_id, quantity],
    );
    const commitment = await client.query<{ id: string }>(
      `INSERT INTO grn_reservation_commitments
         (request_item_id, waitlist_entry_id, collection_point_id, product_id, quantity, status, expires_at)
       SELECT $1, $2, $3, $4, $5, 'PENDING_CONFIRMATION', transaction_timestamp() + interval '30 minutes'
        RETURNING id`,
      [candidate.request_item_id, offerEntryId, pointId, productId, quantity],
    );
    await client.query(
      `INSERT INTO grn_lifecycle_events (aggregate_type, aggregate_id, event_type, metadata)
       VALUES ('RESERVATION', $1, 'FIFO_OFFER_CREATED', $2::jsonb)`,
      [commitment.rows[0].id, JSON.stringify({ quantity, expiresMinutes: 30, pointId, productId })],
    );
    const expiry = await client.query<{ expires_at: string }>(
      "SELECT (transaction_timestamp() + interval '30 minutes')::text AS expires_at",
    );
    const whatsappOutboxId = await queueNotification(client, {
      userId: candidate.requester_id,
      eventType: "FIFO_OFFER_CREATED",
      reservationId: commitment.rows[0].id,
      expiresAt: expiry.rows[0]?.expires_at ?? "",
      quantity,
      productName: candidate.product_name,
      productNames: {
        en: candidate.product_names?.en?.name,
        es: candidate.product_names?.es?.name,
      },
      pointName: candidate.point_name,
      timeZone: candidate.time_zone,
    });
    if (whatsappOutboxId) notificationOutboxIds.push(whatsappOutboxId);
    available -= quantity;
    created += 1;
  }
  return { offers: created, notificationOutboxIds };
}

export async function processQueue(pointId: string, productId: string) {
  const result = await withTransaction(async (client) => {
    const control = await client.query(
      `SELECT 1 FROM grn_inventory_controls
        WHERE collection_point_id = $1 AND product_id = $2 FOR UPDATE`,
      [pointId, productId],
    );
    if (!control.rows.length) throw new Error("No existe ese producto en el punto.");
    return reconcileAndAdvanceQueue(client, pointId, productId);
  });
  return result;
}

export async function findPendingWaitlistOffer(actorId: string, locale: Locale = "en") {
  const rows = await queryRows<{
    id: string; conversation_id: string; point_id: string; point_name: string;
    request_item_id: string; product_id: string; product_name: string; quantity: number;
    zone: string; mobility: "NEARBY_ONLY" | "CAN_TRAVEL"; expires_at: string;
    timezone: string;
  }>(
    `SELECT r.id, wc.conversation_id, r.collection_point_id AS point_id, cp.name AS point_name,
            i.id AS request_item_id, r.product_id,
            COALESCE(p.localized_content -> $2::text ->> 'name', p.name) AS product_name,
            r.quantity, ar.zone, ar.mobility, r.expires_at, cp.timezone
       FROM grn_reservation_commitments r
       JOIN grn_aid_request_items i ON i.id = r.request_item_id
       JOIN grn_aid_requests ar ON ar.id = i.request_id
       JOIN grn_collection_points cp ON cp.id = r.collection_point_id
       JOIN grn_products p ON p.id = r.product_id
       LEFT JOIN grn_whatsapp_conversations wc ON wc.user_id = ar.requester_id
      WHERE ar.requester_id = $1 AND r.status = 'PENDING_CONFIRMATION'
        AND r.expires_at > transaction_timestamp()
      ORDER BY r.expires_at, r.id LIMIT 1`,
    [actorId, locale],
  );
  return rows[0] ?? null;
}
