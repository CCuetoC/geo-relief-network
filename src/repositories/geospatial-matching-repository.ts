import "server-only";
import { queryRows } from "@/core/server/db";

export interface PointProductRow {
  point_id: string;
  point_name: string;
  neighborhood: string;
  latitude: number;
  longitude: number;
  timezone: string;
  intake_capacity: number;
  pickup_capacity: number;
  same_day_cutoff_minutes: number;
  opens_at: string | null;
  closes_at: string | null;
  local_time: string;
  local_weekday: number;
  product_id: string;
  product_name: string;
  requested_quantity: number;
  max_per_request: number;
  max_on_hand: number;
  on_hand: number;
  reserved: number;
  available: number;
  queued_request_count: number;
  expected_inbound: number;
  unmet_demand: number;
  pickup_count_today: number;
  intake_count_today: number;
}

/** SQL projection for recommendations; stock and inbound quantities use the shared database policies. */
export async function readPointProductRows(productIds: string[], quantities: number[]) {
  return queryRows<PointProductRow>(
    `WITH clock AS (
       SELECT transaction_timestamp() AS now
     )
     SELECT cp.id AS point_id, cp.name AS point_name, cp.neighborhood,
            cp.latitude, cp.longitude, cp.timezone, cp.intake_capacity,
            cp.pickup_capacity, cp.same_day_cutoff_minutes,
            h.opens_at::text AS opens_at, h.closes_at::text AS closes_at,
            date_trunc('minute', clock.now AT TIME ZONE cp.timezone)::time::text AS local_time,
            EXTRACT(DOW FROM clock.now AT TIME ZONE cp.timezone)::int AS local_weekday,
            p.id AS product_id, p.name AS product_name,
            requested.quantity AS requested_quantity,
            cpp.max_per_request, cpp.max_on_hand,
            COALESCE(ic.confirmed_on_hand, 0)::int AS on_hand,
            COALESCE(commitments.quantity, 0)::int AS reserved,
            grn_available_stock(cp.id, p.id, clock.now)::int AS available,
            COALESCE(queue.waiting_count, 0)::int AS queued_request_count,
            grn_expected_inbound(cp.id, p.id, clock.now, NULL::uuid)::int AS expected_inbound,
            COALESCE(waitlist.quantity, 0)::int AS unmet_demand,
            COALESCE(pickups.count, 0)::int AS pickup_count_today,
            COALESCE(intakes.count, 0)::int AS intake_count_today
       FROM grn_collection_points cp
       CROSS JOIN clock
       JOIN grn_collection_point_products cpp ON cpp.collection_point_id = cp.id
       JOIN grn_products p ON p.id = cpp.product_id AND p.active
       JOIN unnest($1::uuid[], $2::int[]) AS requested(product_id, quantity)
         ON requested.product_id = p.id
       LEFT JOIN grn_collection_point_hours h
         ON h.collection_point_id = cp.id
        AND h.weekday = EXTRACT(DOW FROM clock.now AT TIME ZONE cp.timezone)::int
       JOIN grn_inventory_controls ic
         ON ic.collection_point_id = cp.id AND ic.product_id = p.id
       LEFT JOIN LATERAL (
         SELECT SUM(r.quantity) AS quantity
           FROM grn_reservation_commitments r
          WHERE r.collection_point_id = cp.id AND r.product_id = p.id
            AND r.status IN ('PENDING_CONFIRMATION', 'ACTIVE')
            AND r.expires_at > clock.now
       ) commitments ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS waiting_count
           FROM grn_waitlist_entries w
          WHERE w.collection_point_id = cp.id AND w.product_id = p.id
            AND w.status = 'WAITING' AND w.quantity > 0
       ) queue ON true
       LEFT JOIN LATERAL (
         SELECT SUM(i.waiting_quantity) AS quantity
           FROM grn_aid_request_items i
          WHERE i.collection_point_id = cp.id AND i.product_id = p.id
            AND i.waiting_quantity > 0
       ) waitlist ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(DISTINCT i.request_id) AS count
           FROM grn_reservation_commitments r
           JOIN grn_aid_request_items i ON i.id = r.request_item_id
          WHERE r.collection_point_id = cp.id
            AND r.status IN ('PENDING_CONFIRMATION', 'ACTIVE')
            AND r.expires_at > clock.now
            AND (r.created_at AT TIME ZONE cp.timezone)::date = (clock.now AT TIME ZONE cp.timezone)::date
       ) pickups ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS count
           FROM grn_donation_manifests m
          WHERE m.collection_point_id = cp.id
            AND (m.created_at AT TIME ZONE cp.timezone)::date = (clock.now AT TIME ZONE cp.timezone)::date
            AND (m.status = 'VALIDATED' OR (m.status = 'PENDING' AND m.expires_at > clock.now))
       ) intakes ON true
      WHERE cp.active = true
      ORDER BY cp.id, p.id`,
    [productIds, quantities],
  );
}
