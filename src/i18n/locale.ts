import type { Locale } from "@/domain/types";

export const LOCALE_COOKIE = "grn_locale";
export const DEFAULT_LOCALE: Locale = "en";

export function parseLocale(value: unknown): Locale | undefined {
  return value === "en" || value === "es" ? value : undefined;
}

/** Lightweight fallback for WhatsApp before the conversational model returns a locale. */
export function inferLocaleFromText(value: string, fallback: Locale = DEFAULT_LOCALE): Locale {
  const text = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const spanish = (text.match(/\b(que|necesito|quiero|tengo|puedo|agua|ayuda|donar|recoger|gracias|hola|buenos|buenas|por favor|mi|para|esta|estan)\b/g) ?? []).length;
  const english = (text.match(/\b(what|need|want|have|can|water|help|donate|pick up|thank|hello|please|my|for|is|are|the)\b/g) ?? []).length;
  if (spanish === english) return fallback;
  return spanish > english ? "es" : "en";
}

/** Accept-Language is a browser preference, not a country or geolocation signal. */
export function resolveLocale(cookieValue: unknown, acceptLanguage: string | null | undefined): Locale {
  const saved = parseLocale(cookieValue);
  if (saved) return saved;

  const candidates = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag = "", quality = ""] = part.trim().split(";");
      const q = quality.startsWith("q=") ? Number(quality.slice(2)) : 1;
      return { language: tag.trim().toLowerCase().split("-")[0], quality: Number.isFinite(q) ? q : 0 };
    })
    .filter((item) => item.quality > 0)
    .sort((a, b) => b.quality - a.quality);

  for (const candidate of candidates) {
    if (candidate.language === "es") return "es";
    if (candidate.language === "en") return "en";
  }
  return DEFAULT_LOCALE;
}

export function formatNumber(locale: Locale, value: number): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatDate(locale: Locale, value: string | Date, timeZone?: string): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

export function formatTime(locale: Locale, value: string | Date, timeZone?: string): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}
