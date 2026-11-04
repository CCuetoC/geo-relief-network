"use client";

import { useI18n } from "@/adapters/client/i18n-provider";
import type { Locale } from "@/domain/types";

export function LanguageSelector() {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
      <span className="sr-only">{t("language.change")}</span>
      <select
        aria-label={t("language.change")}
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
        className="rounded-md border bg-background px-2.5 py-2 text-xs text-foreground"
      >
        <option value="en">English</option>
        <option value="es">Español</option>
      </select>
    </label>
  );
}
