import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";
import { AccountStatusBar } from "@/adapters/client/account-status-bar";
import { I18nProvider } from "@/adapters/client/i18n-provider";
import { LOCALE_COOKIE, resolveLocale } from "@/i18n/locale";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await currentLocale();
  return {
    title: "Geo Relief Network",
    description: locale === "en"
      ? "Coordinate emergency donations and aid requests through local collection points."
      : "Coordina donaciones de emergencia y solicitudes de ayuda a través de puntos locales.",
  };
}

async function currentLocale() {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value, headerStore.get("accept-language"));
}

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const locale = await currentLocale();
  return (
    <html lang={locale}>
      <body>
        <I18nProvider locale={locale}>
          <AccountStatusBar />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
