-- Synthetic demo data only. Apply to Neon branch `vercel-dev` / database `neondb`.
-- This is not a schema migration. It is safe to re-run and never resets confirmed stock.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM grn_collection_points
     WHERE id = 'ed0d4d2d-23dd-417e-b2ff-538efcfccc04'
       AND name = 'DEMO — Lima Centro'
  ) THEN
    RAISE EXCEPTION 'The expected DEMO — Lima Centro point is not present; stop without seeding.';
  END IF;
END;
$$;

UPDATE grn_collection_points
   SET intake_capacity = 20,
       pickup_capacity = 20,
       same_day_cutoff_minutes = 0,
       timezone = 'America/Lima',
       active = true,
       updated_at = transaction_timestamp()
 WHERE id = 'ed0d4d2d-23dd-417e-b2ff-538efcfccc04'
   AND name = 'DEMO — Lima Centro';

UPDATE grn_collection_point_hours
   SET opens_at = '00:00', closes_at = '23:59'
 WHERE collection_point_id = 'ed0d4d2d-23dd-417e-b2ff-538efcfccc04';

INSERT INTO grn_products (id, slug, name, unit, suggested_units_per_person, active)
VALUES
  ('50000000-0000-4000-8000-000000000001', 'agua-embotellada', 'Agua embotellada', 'botella', NULL, true),
  ('50000000-0000-4000-8000-000000000002', 'alimentos-no-perecibles', 'Alimentos no perecibles', 'paquete', NULL, true)
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      unit = EXCLUDED.unit,
      active = true;

INSERT INTO grn_collection_point_products
  (collection_point_id, product_id, max_per_request, max_on_hand)
SELECT 'ed0d4d2d-23dd-417e-b2ff-538efcfccc04', p.id, 10, 100
  FROM grn_products p
 WHERE p.slug IN ('agua-embotellada', 'alimentos-no-perecibles')
ON CONFLICT (collection_point_id, product_id) DO UPDATE
  SET max_per_request = EXCLUDED.max_per_request,
      max_on_hand = EXCLUDED.max_on_hand;

INSERT INTO grn_inventory_controls (collection_point_id, product_id, confirmed_on_hand)
SELECT cpp.collection_point_id, cpp.product_id, 0
  FROM grn_collection_point_products cpp
  JOIN grn_products p ON p.id = cpp.product_id
 WHERE cpp.collection_point_id = 'ed0d4d2d-23dd-417e-b2ff-538efcfccc04'
   AND p.slug IN ('agua-embotellada', 'alimentos-no-perecibles')
ON CONFLICT (collection_point_id, product_id) DO NOTHING;

COMMIT;
