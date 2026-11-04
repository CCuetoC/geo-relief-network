"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Locale } from "@/domain/types";
import { translate, type MessageKey, type MessageParams } from "@/i18n/messages";
import { LOCALE_COOKIE } from "@/i18n/locale";

interface I18nContextValue {
  locale: Locale;
  setLocale(locale: Locale): void;
  t(key: MessageKey, params?: MessageParams): string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ locale: initialLocale, children }: { locale: Locale; children: ReactNode }) {
  const [locale, updateLocale] = useState(initialLocale);
  const setLocale = useCallback((next: Locale) => {
    updateLocale(next);
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    document.documentElement.lang = next;
  }, []);
  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    t: (key, params) => translate(locale, key, params),
  }), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
