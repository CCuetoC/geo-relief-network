import type { Locale } from "@/domain/types";

export interface LocalizedProductText {
  name?: string;
  unit?: string;
  aliases?: string[];
}

export type LocalizedProductContent = Partial<Record<Locale, LocalizedProductText>>;

export function normalizeCatalogTerm(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}

export function selectProductText(
  localized: LocalizedProductContent | null | undefined,
  locale: Locale,
  fallback: { name: string; unit: string },
): Required<Pick<LocalizedProductText, "name" | "unit">> & { aliases: string[] } {
  const preferred = localized?.[locale];
  const secondary = localized?.[locale === "en" ? "es" : "en"];
  return {
    name: preferred?.name || fallback.name,
    unit: preferred?.unit || fallback.unit,
    aliases: [...new Set([
      fallback.name,
      ...((preferred?.aliases ?? [])),
      ...((secondary?.aliases ?? [])),
    ].filter((item): item is string => typeof item === "string" && item.trim().length > 0))],
  };
}

export function resolveCatalogSlug(
  query: { slug?: string; name: string },
  products: Array<{ slug: string; localized: LocalizedProductContent; fallbackName: string }>,
): string | null {
  if (query.slug) return products.some((product) => product.slug === query.slug) ? query.slug : null;
  const normalized = normalizeCatalogTerm(query.name);
  const match = products.find((product) => [product.slug.replaceAll("-", " "), product.fallbackName,
    ...(product.localized.en?.aliases ?? []), ...(product.localized.es?.aliases ?? []),
    product.localized.en?.name ?? "", product.localized.es?.name ?? ""]
    .some((candidate) => normalizeCatalogTerm(candidate) === normalized));
  return match?.slug ?? null;
}
