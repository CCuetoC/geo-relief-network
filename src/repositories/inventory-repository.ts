import "server-only";
import type { PoolClient } from "@neondatabase/serverless";

export interface InventorySnapshot {
  product_id: string;
  max_on_hand: number;
  confirmed_on_hand: number;
  expected_inbound: number;
  available_stock: number;
}

/** Lock every inventory row in a stable order before a multi-product mutation. */
export async function lockInventoryControls(client: PoolClient, pointId: string, productIds: string[]) {
  const uniqueProductIds = [...new Set(productIds)].sort();
  if (uniqueProductIds.length === 0) return [] as string[];
  const result = await client.query<{ product_id: string }>(
    `SELECT product_id
       FROM grn_inventory_controls
      WHERE collection_point_id = $1 AND product_id = ANY($2::uuid[])
      ORDER BY product_id
      FOR UPDATE`,
    [pointId, uniqueProductIds],
  );
  return result.rows.map((row) => row.product_id);
}

export async function readInventorySnapshots(
  client: PoolClient,
  pointId: string,
  productIds: string[],
  excludedManifestId?: string,
): Promise<InventorySnapshot[]> {
  const uniqueProductIds = [...new Set(productIds)].sort();
  if (uniqueProductIds.length === 0) return [];
  const result = await client.query<InventorySnapshot>(
    `SELECT cpp.product_id, cpp.max_on_hand,
            ic.confirmed_on_hand,
            grn_expected_inbound($1, cpp.product_id, transaction_timestamp(), $3::uuid)::int AS expected_inbound,
            grn_available_stock($1, cpp.product_id, transaction_timestamp())::int AS available_stock
       FROM grn_collection_point_products cpp
       JOIN grn_inventory_controls ic
         ON ic.collection_point_id = cpp.collection_point_id AND ic.product_id = cpp.product_id
      WHERE cpp.collection_point_id = $1 AND cpp.product_id = ANY($2::uuid[])
      ORDER BY cpp.product_id`,
    [pointId, uniqueProductIds, excludedManifestId ?? null],
  );
  return result.rows;
}

/** One shared availability definition; null means point/product is not configured. */
export async function readAvailableStock(client: PoolClient, pointId: string, productId: string) {
  const result = await client.query<{ available_stock: number }>(
    `SELECT grn_available_stock($1, $2, transaction_timestamp())::int AS available_stock
       FROM grn_inventory_controls
      WHERE collection_point_id = $1 AND product_id = $2`,
    [pointId, productId],
  );
  return result.rows[0] ? Number(result.rows[0].available_stock) : null;
}
