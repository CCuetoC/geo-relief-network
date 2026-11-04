-- Localized product presentation preserves the stable product id and slug.
ALTER TABLE grn_products
  ADD COLUMN localized_content jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE grn_products
   SET localized_content = jsonb_build_object(
     'en', jsonb_build_object(
       'name', CASE WHEN slug IN ('water', 'bottled-water') THEN 'Bottled water'
                    WHEN slug IN ('rice', 'food') THEN 'Food'
                    ELSE name END,
       'unit', CASE WHEN slug IN ('water', 'bottled-water') THEN 'bottle'
                    ELSE unit END,
       'aliases', CASE WHEN slug IN ('water', 'bottled-water') THEN jsonb_build_array(name, slug, 'water', 'bottled water', 'bottle of water', 'bottles of water')
                       WHEN slug IN ('rice', 'food') THEN jsonb_build_array(name, slug, 'food', 'rice')
                       ELSE jsonb_build_array(name, slug) END
     ),
     'es', jsonb_build_object(
       'name', CASE WHEN slug IN ('water', 'bottled-water') THEN 'Agua embotellada'
                    WHEN slug IN ('rice', 'food') THEN 'Alimentos'
                    ELSE name END,
       'unit', CASE WHEN slug IN ('water', 'bottled-water') THEN 'botella'
                    ELSE unit END,
       'aliases', CASE WHEN slug IN ('water', 'bottled-water') THEN jsonb_build_array(name, slug, 'agua', 'agua embotellada', 'botella de agua', 'botellas de agua')
                       WHEN slug IN ('rice', 'food') THEN jsonb_build_array(name, slug, 'alimentos', 'comida', 'arroz')
                       ELSE jsonb_build_array(name, slug) END
     )
   );

ALTER TABLE grn_whatsapp_links
  ADD COLUMN preferred_locale text NOT NULL DEFAULT 'en'
  CHECK (preferred_locale IN ('en', 'es'));

ALTER TABLE grn_whatsapp_link_tokens
  ADD COLUMN preferred_locale text NOT NULL DEFAULT 'en'
  CHECK (preferred_locale IN ('en', 'es'));
