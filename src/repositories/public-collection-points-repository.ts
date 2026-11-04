import "server-only";
import type { PublicCollectionPoint, PublicPointProduct } from "@/domain/types";
import { queryRows } from "@/core/server/db";

interface PublicPointRow {
  point_id: string;
  point_name: string;
  neighborhood: string;
  city: string;
  latitude: number | string;
  longitude: number | string;
  opens_at: string | null;
  closes_at: string | null;
  local_time: string;
  is_open: boolean;
  product_id: string | null;
  product_name: string | null;
  product_unit: string | null;
  available_quantity: number | string | null;
  expected_inbound_quantity: number | string | null;
  unmet_demand_quantity: number | string | null;
}

/** Public projection intentionally contains collection point locations only, never requester coordinates. */
export async function readPublicCollectionPoints(): Promise<PublicCollectionPoint[]> {
  const rows = await queryRows<PublicPointRow>(
    `WITH clock AS (SELECT transaction_timestamp() AS now)
     SELECT cp.id AS point_id, cp.name AS point_name, cp.neighborhood, cp.city,
            cp.latitude, cp.longitude,
            h.opens_at::text AS opens_at, h.closes_at::text AS closes_at,
            to_char(clock.now AT TIME ZONE cp.timezone, 'HH24:MI') AS local_time,
            CASE WHEN h.opens_at IS NULL THEN false
                 ELSE date_trunc('minute', clock.now AT TIME ZONE cp.timezone)::time >= h.opens_at
                  AND date_trunc('minute', clock.now AT TIME ZONE cp.timezone)::time < h.closes_at
            END AS is_open,
            p.id AS product_id, p.name AS product_name, p.unit AS product_unit,
            CASE WHEN p.id IS NULL THEN 0
                 ELSE grn_available_stock(cp.id, p.id, clock.now)
            END::int AS available_quantity,
            CASE WHEN p.id IS NULL THEN 0
                 ELSE grn_expected_inbound(cp.id, p.id, clock.now, NULL::uuid)
            END::int AS expected_inbound_quantity,
            COALESCE(demand.quantity, 0)::int AS unmet_demand_quantity
       FROM grn_collection_points cp
       CROSS JOIN clock
       LEFT JOIN grn_collection_point_hours h
         ON h.collection_point_id = cp.id
        AND h.weekday = EXTRACT(DOW FROM clock.now AT TIME ZONE cp.timezone)::int
       LEFT JOIN grn_collection_point_products cpp
         ON cpp.collection_point_id = cp.id
       LEFT JOIN grn_products p
         ON p.id = cpp.product_id AND p.active = true
       LEFT JOIN LATERAL (
         SELECT SUM(i.waiting_quantity) AS quantity
           FROM grn_aid_request_items i
          WHERE i.collection_point_id = cp.id
            AND i.product_id = p.id
            AND i.waiting_quantity > 0
       ) demand ON true
      WHERE cp.active = true
      ORDER BY cp.name, p.name NULLS LAST`,
  );

  const points = new Map<string, PublicCollectionPoint>();
  for (const row of rows) {
    let point = points.get(row.point_id);
    if (!point) {
      point = {
        id: row.point_id,
        name: row.point_name,
        neighborhood: row.neighborhood,
        city: row.city,
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        opensAt: row.opens_at,
        closesAt: row.closes_at,
        localTime: row.local_time,
        isOpen: row.is_open,
        products: [],
      };
      points.set(point.id, point);
    }

    if (row.product_id && row.product_name && row.product_unit) {
      const product: PublicPointProduct = {
        productId: row.product_id,
        name: row.product_name,
        unit: row.product_unit,
        availableQuantity: Number(row.available_quantity ?? 0),
        expectedInboundQuantity: Number(row.expected_inbound_quantity ?? 0),
        unmetDemandQuantity: Number(row.unmet_demand_quantity ?? 0),
      };
      point.products.push(product);
    }
  }

  return [...points.values()];
}
