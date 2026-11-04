import "server-only";
import { queryRows } from "@/core/server/db";

export interface CatalogProduct {
  id: string;
  slug: string;
  name: string;
  unit: string;
  suggestedUnitsPerPerson: number | null;
}

export async function getActiveCatalog(): Promise<CatalogProduct[]> {
  const rows = await queryRows<{
    id: string;
    slug: string;
    name: string;
    unit: string;
    suggested_units_per_person: number | null;
  }>(
    `SELECT id, slug, name, unit, suggested_units_per_person
       FROM grn_products WHERE active = true ORDER BY name`,
  );
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    unit: row.unit,
    suggestedUnitsPerPerson: row.suggested_units_per_person,
  }));
}

export async function resolveCatalogItems(items: Array<{ productName: string; quantity: number }>) {
  const catalog = await getActiveCatalog();
  return items.map((item) => {
    const normalized = item.productName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
    const product = catalog.find((candidate) => {
      const name = candidate.name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
      const slug = candidate.slug.replaceAll("-", " ").toLocaleLowerCase("es");
      return name === normalized || slug === normalized || name.includes(normalized) || normalized.includes(name);
    });
    return product ? { product, quantity: item.quantity } : null;
  });
}

export function suggestForHousehold(catalog: CatalogProduct[], householdSize: number) {
  return catalog.flatMap((product) => product.suggestedUnitsPerPerson
    ? [{ productId: product.id, productName: product.name, quantity: product.suggestedUnitsPerPerson * householdSize, unit: product.unit }]
    : []);
}
