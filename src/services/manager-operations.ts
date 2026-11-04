import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { queryRows, withTransaction } from "@/core/server/db";
import { fitsOnHandCapacity, isWithinOperatingHours } from "@/domain/inventory-policy";
import { lockInventoryControls, readInventorySnapshots } from "@/repositories/inventory-repository";
import { reconcileAndAdvanceQueue } from "@/services/queue-service";
import type { Locale } from "@/domain/types";

export class ManagerOperationError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function requireManager(client: PoolClient, userId: string, pointId: string) {
  const result = await client.query(
    `SELECT 1 FROM grn_collection_point_managers
      WHERE user_id = $1 AND collection_point_id = $2 AND active`,
    [userId, pointId],
  );
  if (!result.rows.length) throw new ManagerOperationError("No tienes permisos para administrar este punto.", 403);
}

export async function listManagedPoints(userId: string) {
  return queryRows<{ id: string; name: string; neighborhood: string }>(
    `SELECT cp.id, cp.name, cp.neighborhood
       FROM grn_collection_point_managers m
       JOIN grn_collection_points cp ON cp.id = m.collection_point_id
      WHERE m.user_id = $1 AND m.active AND cp.active
      ORDER BY cp.name`,
    [userId],
  );
}

export async function listActiveReservations(userId: string, locale: Locale = "en") {
  return queryRows<{
    id: string; point_id: string; point_name: string; product_name: string;
    quantity: number; expires_at: string; requester_zone: string; timezone: string;
  }>(
    `SELECT r.id, cp.id AS point_id, cp.name AS point_name,
            COALESCE(p.localized_content -> $2::text ->> 'name', p.name) AS product_name,
            r.quantity, r.expires_at, ar.zone AS requester_zone, cp.timezone
       FROM grn_reservation_commitments r
       JOIN grn_aid_request_items i ON i.id = r.request_item_id
       JOIN grn_aid_requests ar ON ar.id = i.request_id
       JOIN grn_products p ON p.id = r.product_id
       JOIN grn_collection_points cp ON cp.id = r.collection_point_id
       JOIN grn_collection_point_managers mgr
         ON mgr.collection_point_id = cp.id AND mgr.user_id = $1 AND mgr.active
      WHERE r.status = 'ACTIVE' AND r.expires_at > transaction_timestamp()
      ORDER BY r.expires_at, r.created_at
      LIMIT 100`,
    [userId, locale],
  );
}

export async function listPendingManifests(userId: string, locale: Locale = "en") {
  return queryRows<{
    id: string; code: string; point_id: string; point_name: string; neighborhood: string;
    estimated_delivery_at: string; timezone: string; lines: Array<{ id: string; product_id: string; product_name: string; declared_quantity: number; photo_count: number; photo_media_ids: string[] }>;
  }>(
    `SELECT m.id, m.code, m.collection_point_id AS point_id, cp.name AS point_name,
            cp.neighborhood, m.estimated_delivery_at, cp.timezone,
            json_agg(json_build_object(
              'id', ml.id, 'product_id', ml.product_id,
              'product_name', COALESCE(p.localized_content -> $2::text ->> 'name', p.name),
              'declared_quantity', ml.declared_quantity,
              'photo_count', cardinality(ml.photo_media_ids),
              'photo_media_ids', ml.photo_media_ids
            ) ORDER BY COALESCE(p.localized_content -> $2::text ->> 'name', p.name)) AS lines
       FROM grn_donation_manifests m
       JOIN grn_collection_points cp ON cp.id = m.collection_point_id
       JOIN grn_collection_point_managers mgr
         ON mgr.collection_point_id = cp.id AND mgr.user_id = $1 AND mgr.active
       JOIN grn_donation_manifest_lines ml ON ml.manifest_id = m.id
       JOIN grn_products p ON p.id = ml.product_id
      WHERE m.status = 'PENDING' AND m.expires_at > transaction_timestamp()
      GROUP BY m.id, cp.name, cp.neighborhood, cp.timezone
      ORDER BY m.estimated_delivery_at, m.created_at
      LIMIT 100`,
    [userId, locale],
  );
}

export async function validateDonationManifest(userId: string, manifestId: string, acceptedLines: Array<{ lineId: string; acceptedQuantity: number }>) {
  if (!/^[0-9a-f-]{36}$/i.test(manifestId) || acceptedLines.length < 1 || acceptedLines.length > 30) {
    throw new ManagerOperationError("Manifiesto o detalle de validación inválido.", 400);
  }
  const unique = new Set(acceptedLines.map((line) => line.lineId));
  if (unique.size !== acceptedLines.length || acceptedLines.some((line) => !/^[0-9a-f-]{36}$/i.test(line.lineId) || !Number.isInteger(line.acceptedQuantity) || line.acceptedQuantity < 0 || line.acceptedQuantity > 10_000)) {
    throw new ManagerOperationError("Cada cantidad aceptada debe ser un entero no negativo y las líneas no se pueden repetir.", 400);
  }

  const result = await withTransaction(async (client) => {
    const manifest = await client.query<{ point_id: string; status: string; expires_at: string }>(
      `SELECT collection_point_id AS point_id, status, expires_at
         FROM grn_donation_manifests WHERE id = $1 FOR UPDATE`,
      [manifestId],
    );
    const row = manifest.rows[0];
    if (!row) throw new ManagerOperationError("No se encontró ese manifiesto.", 404);
    await requireManager(client, userId, row.point_id);
    if (row.status !== "PENDING") throw new ManagerOperationError("El manifiesto ya fue procesado.", 409);

    const point = await client.query<{
      timezone: string; localTime: string; opensAt: string | null; closesAt: string | null; expired: boolean;
    }>(
      `SELECT cp.timezone,
              to_char(date_trunc('minute', transaction_timestamp() AT TIME ZONE cp.timezone), 'HH24:MI') AS "localTime",
              h.opens_at::text AS "opensAt", h.closes_at::text AS "closesAt",
              $2::timestamptz <= transaction_timestamp() AS expired
         FROM grn_collection_points cp
         LEFT JOIN grn_collection_point_hours h
           ON h.collection_point_id = cp.id
          AND h.weekday = EXTRACT(DOW FROM transaction_timestamp() AT TIME ZONE cp.timezone)::int
        WHERE cp.id = $1`,
      [row.point_id, row.expires_at],
    );
    const pointRow = point.rows[0];
    if (pointRow?.expired) {
      await client.query(
        `UPDATE grn_donation_manifests SET status = 'EXPIRED' WHERE id = $1 AND status = 'PENDING'`,
        [manifestId],
      );
      await client.query(
        `INSERT INTO grn_lifecycle_events (aggregate_type, aggregate_id, event_type, actor_id)
         VALUES ('MANIFEST', $1, 'MANIFEST_EXPIRED_AT_DAILY_CLOSING', $2)`,
        [manifestId, userId],
      );
      return { expired: true as const };
    }
    if (!pointRow || !isWithinOperatingHours(pointRow)) {
      throw new ManagerOperationError("El punto recibe donaciones solo dentro de su horario local de atención.", 409);
    }

    const lines = await client.query<{
      id: string; product_id: string; declared_quantity: number; name: string;
    }>(
      `SELECT ml.id, ml.product_id, ml.declared_quantity, p.name
         FROM grn_donation_manifest_lines ml
         JOIN grn_products p ON p.id = ml.product_id
        WHERE ml.manifest_id = $1
        ORDER BY ml.product_id, ml.id
        FOR UPDATE OF ml`,
      [manifestId],
    );
    if (lines.rows.length !== acceptedLines.length || lines.rows.some((line) => !unique.has(line.id))) {
      throw new ManagerOperationError("El detalle enviado no coincide con todas las líneas del manifiesto.", 400);
    }
    const products = [...new Set(lines.rows.map((line) => line.product_id))].sort();
    const lockedProducts = await lockInventoryControls(client, row.point_id, products);
    if (lockedProducts.length !== products.length) throw new ManagerOperationError("Falta configurar el stock de un producto.", 409);

    const acceptedByProduct = new Map<string, number>();
    for (const line of lines.rows) {
      const accepted = acceptedLines.find((entry) => entry.lineId === line.id)!.acceptedQuantity;
      if (accepted > Number(line.declared_quantity)) {
        throw new ManagerOperationError(`No puedes aceptar más unidades de ${line.name} que las declaradas en el manifiesto.`, 400);
      }
      acceptedByProduct.set(line.product_id, (acceptedByProduct.get(line.product_id) ?? 0) + accepted);
    }
    const snapshots = await readInventorySnapshots(client, row.point_id, products, manifestId);
    if (snapshots.length !== products.length) throw new ManagerOperationError("Falta la regla de capacidad o el control de inventario de un producto.", 409);
    for (const snapshot of snapshots) {
      if (!fitsOnHandCapacity({
        confirmedOnHand: Number(snapshot.confirmed_on_hand),
        expectedInbound: Number(snapshot.expected_inbound),
        proposedQuantity: acceptedByProduct.get(snapshot.product_id) ?? 0,
        maxOnHand: Number(snapshot.max_on_hand),
      })) {
        const availableCapacity = Math.max(0, Number(snapshot.max_on_hand) - Number(snapshot.confirmed_on_hand) - Number(snapshot.expected_inbound));
        const product = lines.rows.find((line) => line.product_id === snapshot.product_id);
        throw new ManagerOperationError(`La capacidad de ${product?.name ?? "este producto"} permite aceptar hasta ${availableCapacity} unidad(es) adicionales. Corrige la validación física.`, 409);
      }
    }

    const notificationOutboxIds: string[] = [];
    for (const line of lines.rows) {
      const accepted = acceptedLines.find((entry) => entry.lineId === line.id)!.acceptedQuantity;
      await client.query(
        `UPDATE grn_donation_manifest_lines SET validated_quantity = $2 WHERE id = $1`,
        [line.id, accepted],
      );
      if (accepted > 0) {
        await client.query(
          `UPDATE grn_inventory_controls
              SET confirmed_on_hand = confirmed_on_hand + $3, updated_at = transaction_timestamp()
            WHERE collection_point_id = $1 AND product_id = $2`,
          [row.point_id, line.product_id, accepted],
        );
        await client.query(
          `INSERT INTO grn_inventory_movements
             (collection_point_id, product_id, manifest_line_id, quantity, kind, actor_id)
           VALUES ($1, $2, $3, $4, 'DONATION_IN', $5)`,
          [row.point_id, line.product_id, line.id, accepted, userId],
        );
        const advanced = await reconcileAndAdvanceQueue(client, row.point_id, line.product_id);
        notificationOutboxIds.push(...advanced.notificationOutboxIds);
      }
      await client.query(
        `INSERT INTO grn_lifecycle_events (aggregate_type, aggregate_id, event_type, actor_id, metadata)
         VALUES ('MANIFEST', $1, 'MANIFEST_LINE_PHYSICALLY_VALIDATED', $2, $3::jsonb)`,
        [manifestId, userId, JSON.stringify({ manifestLineId: line.id, declaredQuantity: line.declared_quantity, acceptedQuantity: accepted })],
      );
    }
    await client.query(
      `UPDATE grn_donation_manifests SET status = 'VALIDATED' WHERE id = $1`,
      [manifestId],
    );
    await client.query(
      `INSERT INTO grn_lifecycle_events (aggregate_type, aggregate_id, event_type, actor_id)
       VALUES ('MANIFEST', $1, 'MANIFEST_VALIDATED_BY_MANAGER', $2)`,
      [manifestId, userId],
    );
    return { expired: false as const, manifestId, acceptedLines: acceptedLines.length, notificationOutboxIds };
  });

  if (result.expired) throw new ManagerOperationError("El manifiesto venció al cierre local y ya no puede recibirse.", 409);
  return result;
}

export async function processManagerQueue(userId: string, pointId: string, productId: string) {
  return withTransaction(async (client) => {
    await requireManager(client, userId, pointId);
    const control = await client.query(
      `SELECT 1 FROM grn_inventory_controls
        WHERE collection_point_id = $1 AND product_id = $2 FOR UPDATE`,
      [pointId, productId],
    );
    if (!control.rows.length) throw new ManagerOperationError("No existe ese producto en el punto.", 404);
    await client.query(
      `INSERT INTO grn_lifecycle_events (aggregate_type, aggregate_id, event_type, actor_id, metadata)
       VALUES ('INVENTORY', $1, 'MANAGER_QUEUE_PROCESS_REQUESTED', $2, $3::jsonb)`,
      [randomUUID(), userId, JSON.stringify({ pointId, productId })],
    );
    return reconcileAndAdvanceQueue(client, pointId, productId);
  });
}

export async function recordPhysicalPickup(userId: string, reservationId: string, pickupCode: string) {
  if (!/^[0-9a-f-]{36}$/i.test(reservationId) || !/^\d{8}$/.test(pickupCode)) {
    throw new ManagerOperationError("Reserva o código de recojo inválido.", 400);
  }
  return withTransaction(async (client) => {
    const identity = await client.query<{ point_id: string; product_id: string; requester_id: string; product_name: string; product_names: { en?: { name?: string }; es?: { name?: string } }; point_name: string }>(
      `SELECT r.collection_point_id AS point_id, r.product_id, ar.requester_id, p.name AS product_name,
              p.localized_content AS product_names, cp.name AS point_name
         FROM grn_reservation_commitments r
         JOIN grn_aid_request_items i ON i.id = r.request_item_id
         JOIN grn_aid_requests ar ON ar.id = i.request_id
         JOIN grn_products p ON p.id = r.product_id
         JOIN grn_collection_points cp ON cp.id = r.collection_point_id
        WHERE r.id = $1`,
      [reservationId],
    );
    const key = identity.rows[0];
    if (!key) throw new ManagerOperationError("No se encontró esa reserva.", 404);
    await requireManager(client, userId, key.point_id);
    const control = await client.query<{ confirmed_on_hand: number }>(
      `SELECT confirmed_on_hand FROM grn_inventory_controls
        WHERE collection_point_id = $1 AND product_id = $2 FOR UPDATE`,
      [key.point_id, key.product_id],
    );
    const reservation = await client.query<{
      request_item_id: string; quantity: number; status: string; expires_at: string;
    }>(
      `SELECT request_item_id, quantity, status, expires_at
         FROM grn_reservation_commitments
        WHERE id = $1 AND pickup_code = $2 FOR UPDATE`,
      [reservationId, pickupCode],
    );
    const row = reservation.rows[0];
    if (!row) throw new ManagerOperationError("El código no coincide o la reserva venció.", 409);
    const valid = await client.query<{ active: boolean }>(
      "SELECT $1 = 'ACTIVE' AND $2::timestamptz > transaction_timestamp() AS active",
      [row.status, row.expires_at],
    );
    if (!valid.rows[0]?.active) throw new ManagerOperationError("El código no coincide o la reserva venció.", 409);
    if (Number(control.rows[0]?.confirmed_on_hand ?? 0) < Number(row.quantity)) {
      throw new ManagerOperationError("El stock confirmado no cubre el recojo. Solicita una revisión administrativa.", 409);
    }
    const notificationOutboxIds: string[] = [];
    await client.query(
      `UPDATE grn_inventory_controls
          SET confirmed_on_hand = confirmed_on_hand - $3, updated_at = transaction_timestamp()
        WHERE collection_point_id = $1 AND product_id = $2`,
      [key.point_id, key.product_id, row.quantity],
    );
    await client.query(
      `UPDATE grn_reservation_commitments
          SET status = 'PICKED_UP', updated_at = transaction_timestamp()
        WHERE id = $1`,
      [reservationId],
    );
    await client.query(
      `UPDATE grn_waitlist_entries SET status = 'FULFILLED', updated_at = transaction_timestamp()
        WHERE id = (SELECT waitlist_entry_id FROM grn_reservation_commitments WHERE id = $1)
          AND status = 'OFFERED'`,
      [reservationId],
    );
    await client.query(
      `INSERT INTO grn_inventory_movements
         (collection_point_id, product_id, reservation_id, quantity, kind, actor_id)
       VALUES ($1, $2, $3, $4, 'PICKUP_OUT', $5)`,
      [key.point_id, key.product_id, reservationId, row.quantity, userId],
    );
    await client.query(
      `INSERT INTO grn_lifecycle_events (aggregate_type, aggregate_id, event_type, actor_id, metadata)
       VALUES ('RESERVATION', $1, 'PHYSICAL_PICKUP_CONFIRMED', $2, $3::jsonb)`,
      [reservationId, userId, JSON.stringify({ quantity: row.quantity })],
    );
    const payload = JSON.stringify({
      quantity: Number(row.quantity), productName: key.product_name,
      productNames: { en: key.product_names?.en?.name, es: key.product_names?.es?.name },
      pointName: key.point_name, reservationId,
    });
    await client.query(
      `INSERT INTO grn_notification_outbox (recipient_user_id, channel, event_type, payload)
       VALUES ($1, 'WEB', 'PHYSICAL_PICKUP_CONFIRMED', $2::jsonb)`,
      [key.requester_id, payload],
    );
    const whatsappNotification = await client.query<{ id: string }>(
      `INSERT INTO grn_notification_outbox (recipient_user_id, channel, event_type, payload)
       SELECT $1, 'WHATSAPP', 'PHYSICAL_PICKUP_CONFIRMED', $2::jsonb
        WHERE EXISTS (SELECT 1 FROM grn_whatsapp_links WHERE user_id = $1)
       RETURNING id`,
      [key.requester_id, payload],
    );
    if (whatsappNotification.rows[0]) notificationOutboxIds.push(whatsappNotification.rows[0].id);
    const advanced = await reconcileAndAdvanceQueue(client, key.point_id, key.product_id);
    notificationOutboxIds.push(...advanced.notificationOutboxIds);
    return { reservationId, quantity: Number(row.quantity), notificationOutboxIds };
  });
}
