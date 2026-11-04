-- Pending donations remain expected inbound through the collection point's
-- local closing time. estimated_delivery_at is advisory only.

ALTER TABLE grn_donation_manifests
  ADD COLUMN expires_at timestamptz;

UPDATE grn_donation_manifests m
   SET expires_at = COALESCE(
     (
       SELECT ((m.created_at AT TIME ZONE cp.timezone)::date + h.closes_at) AT TIME ZONE cp.timezone
         FROM grn_collection_points cp
         JOIN grn_collection_point_hours h
           ON h.collection_point_id = cp.id
          AND h.weekday = EXTRACT(DOW FROM m.created_at AT TIME ZONE cp.timezone)::int
        WHERE cp.id = m.collection_point_id
     ),
     -- Missing legacy opening-hours data falls back to the end of that local day.
     (((m.created_at AT TIME ZONE cp.timezone)::date + TIME '23:59') AT TIME ZONE cp.timezone)
   )
  FROM grn_collection_points cp
 WHERE cp.id = m.collection_point_id
   AND m.expires_at IS NULL;

ALTER TABLE grn_donation_manifests
  ALTER COLUMN expires_at SET NOT NULL;

ALTER TABLE grn_donation_manifests
  DROP CONSTRAINT grn_donation_manifests_status_check;

ALTER TABLE grn_donation_manifests
  ADD CONSTRAINT grn_donation_manifests_status_check
  CHECK (status IN ('PENDING', 'VALIDATED', 'REJECTED', 'CANCELLED', 'EXPIRED'));

CREATE INDEX grn_pending_manifest_expiry_idx
  ON grn_donation_manifests (collection_point_id, expires_at)
  WHERE status = 'PENDING';

CREATE INDEX grn_manifest_lines_inventory_idx
  ON grn_donation_manifest_lines (collection_point_id, product_id, manifest_id);

WITH expired AS (
  UPDATE grn_donation_manifests
     SET status = 'EXPIRED'
   WHERE status = 'PENDING'
     AND expires_at <= transaction_timestamp()
  RETURNING id
)
INSERT INTO grn_lifecycle_events (aggregate_type, aggregate_id, event_type, metadata)
SELECT 'MANIFEST', id, 'MANIFEST_EXPIRED_AT_DAILY_CLOSING', jsonb_build_object('source', 'migration-0003')
  FROM expired;

CREATE OR REPLACE FUNCTION grn_expected_inbound(
  p_collection_point_id uuid,
  p_product_id uuid,
  p_at timestamptz,
  p_excluded_manifest_id uuid
)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(ml.declared_quantity), 0)::int
    FROM grn_donation_manifest_lines ml
    JOIN grn_donation_manifests m ON m.id = ml.manifest_id
   WHERE ml.collection_point_id = p_collection_point_id
     AND ml.product_id = p_product_id
     AND m.status = 'PENDING'
     AND m.expires_at > p_at
     AND (p_excluded_manifest_id IS NULL OR m.id <> p_excluded_manifest_id)
$$;

CREATE OR REPLACE FUNCTION grn_available_stock(
  p_collection_point_id uuid,
  p_product_id uuid,
  p_at timestamptz
)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT GREATEST(
    COALESCE((
      SELECT ic.confirmed_on_hand
        FROM grn_inventory_controls ic
       WHERE ic.collection_point_id = p_collection_point_id
         AND ic.product_id = p_product_id
    ), 0)
    - COALESCE((
      SELECT SUM(r.quantity)
        FROM grn_reservation_commitments r
       WHERE r.collection_point_id = p_collection_point_id
         AND r.product_id = p_product_id
         AND r.status IN ('PENDING_CONFIRMATION', 'ACTIVE')
         AND r.expires_at > p_at
    ), 0),
    0
  )::int
$$;
