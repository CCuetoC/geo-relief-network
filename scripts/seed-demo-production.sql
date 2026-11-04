-- Synthetic production demo configuration for Geo Relief Network.
-- This script is intentionally limited to the named demo collection point.
-- It creates bilingual catalog entries, rules, and continuous demo hours.
-- Inventory controls start at zero and are never reset on re-run.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM grn_collection_points
     WHERE id = 'ed0d4d2d-23dd-417e-b2ff-538efcfccc04'
       AND name <> 'DEMO — Lima Centro'
  ) THEN
    RAISE EXCEPTION 'Demo point ID is already used by another collection point; stop without seeding.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM grn_products
     WHERE id = '50000000-0000-4000-8000-000000000001'
       AND slug <> 'bottled-water'
  ) OR EXISTS (
    SELECT 1 FROM grn_products
     WHERE id = '50000000-0000-4000-8000-000000000002'
       AND slug <> 'food'
  ) THEN
    RAISE EXCEPTION 'A demo product ID is already used by another product; stop without seeding.';
  END IF;
END;
$$;

INSERT INTO grn_collection_points (
  id, name, neighborhood, city, country_code, latitude, longitude, timezone,
  intake_capacity, pickup_capacity, same_day_cutoff_minutes, active
)
VALUES (
  'ed0d4d2d-23dd-417e-b2ff-538efcfccc04',
  'DEMO — Lima Centro',
  'Lima Centro',
  'Lima',
  'PE',
  -12.0464,
  -77.0428,
  'America/Lima',
  20,
  20,
  0,
  true
)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      neighborhood = EXCLUDED.neighborhood,
      city = EXCLUDED.city,
      country_code = EXCLUDED.country_code,
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      timezone = EXCLUDED.timezone,
      intake_capacity = EXCLUDED.intake_capacity,
      pickup_capacity = EXCLUDED.pickup_capacity,
      same_day_cutoff_minutes = EXCLUDED.same_day_cutoff_minutes,
      active = EXCLUDED.active,
      updated_at = transaction_timestamp();

INSERT INTO grn_collection_point_hours (collection_point_id, weekday, opens_at, closes_at)
SELECT 'ed0d4d2d-23dd-417e-b2ff-538efcfccc04', weekday, '00:00', '23:59'
  FROM generate_series(0, 6) AS weekday
ON CONFLICT (collection_point_id, weekday) DO UPDATE
  SET opens_at = EXCLUDED.opens_at,
      closes_at = EXCLUDED.closes_at;

INSERT INTO grn_products (id, slug, name, unit, suggested_units_per_person, active, localized_content)
VALUES
  (
    '50000000-0000-4000-8000-000000000001',
    'bottled-water',
    'Agua embotellada',
    'botella',
    NULL,
    true,
    '{"en":{"name":"Bottled water","unit":"bottle","aliases":["water","bottled water","bottle of water","bottles of water"]},"es":{"name":"Agua embotellada","unit":"botella","aliases":["agua","agua embotellada","botella de agua","botellas de agua"]}}'::jsonb
  ),
  (
    '50000000-0000-4000-8000-000000000002',
    'food',
    'Alimentos no perecibles',
    'paquete',
    NULL,
    true,
    '{"en":{"name":"Non-perishable food","unit":"pack","aliases":["food","non-perishable food","food pack","rice"]},"es":{"name":"Alimentos no perecibles","unit":"paquete","aliases":["alimentos","alimentos no perecibles","comida","arroz"]}}'::jsonb
  )
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      unit = EXCLUDED.unit,
      localized_content = EXCLUDED.localized_content,
      active = true;

INSERT INTO grn_collection_point_products (
  collection_point_id, product_id, max_per_request, max_on_hand
)
SELECT
  'ed0d4d2d-23dd-417e-b2ff-538efcfccc04',
  p.id,
  10,
  100
FROM grn_products p
WHERE p.slug IN ('bottled-water', 'food')
ON CONFLICT (collection_point_id, product_id) DO UPDATE
  SET max_per_request = EXCLUDED.max_per_request,
      max_on_hand = EXCLUDED.max_on_hand;

INSERT INTO grn_inventory_controls (collection_point_id, product_id, confirmed_on_hand)
SELECT cpp.collection_point_id, cpp.product_id, 0
  FROM grn_collection_point_products cpp
  JOIN grn_products p ON p.id = cpp.product_id
 WHERE cpp.collection_point_id = 'ed0d4d2d-23dd-417e-b2ff-538efcfccc04'
   AND p.slug IN ('bottled-water', 'food')
ON CONFLICT (collection_point_id, product_id) DO NOTHING;

COMMIT;
