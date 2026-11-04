import "server-only";
import { queryRows } from "@/core/server/db";
import type { Locale } from "@/domain/types";
import { resolveCatalogSlug, selectProductText, type LocalizedProductContent } from "@/domain/catalog-localization";

export interface CatalogProduct {
  id: string;
  slug: string;
  name: string;
  unit: string;
  suggestedUnitsPerPerson: number | null;
  aliases: string[];
  localizedContent: LocalizedProductContent;
}

export async function getActiveCatalog(locale: Locale): Promise<CatalogProduct[]> {
  const rows = await queryRows<{
    id: string;
    slug: string;
    name: string;
    unit: string;
    suggested_units_per_person: number | null;
    localized_content: LocalizedProductContent;
  }>(
    `SELECT id, slug, name, unit, suggested_units_per_person, localized_content
       FROM grn_products WHERE active = true ORDER BY COALESCE(localized_content -> $1::text ->> 'name', name)`,
    [locale],
  );
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    ...selectProductText(row.localized_content, locale, { name: row.name, unit: row.unit }),
    suggestedUnitsPerPerson: row.suggested_units_per_person,
    localizedContent: row.localized_content ?? {},
  }));
}

export async function resolveCatalogItems(items: Array<{ productName: string; productSlug?: string; quantity: number }>, locale: Locale) {
  const catalog = await getActiveCatalog(locale);
  const lookup = catalog.map((product) => ({
    slug: product.slug,
    localized: product.localizedContent,
    fallbackName: product.name,
  }));
  return items.map((item) => {
    const slug = resolveCatalogSlug({ slug: item.productSlug, name: item.productName }, lookup);
    const product = catalog.find((candidate) => candidate.slug === slug);
    return product ? { product, quantity: item.quantity } : null;
  });
}

export function suggestForHousehold(catalog: CatalogProduct[], householdSize: number) {
  return catalog.flatMap((product) => product.suggestedUnitsPerPerson
    ? [{ productId: product.id, productName: product.name, quantity: product.suggestedUnitsPerPerson * householdSize, unit: product.unit }]
    : []);
}
