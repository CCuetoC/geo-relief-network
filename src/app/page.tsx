"use client";

import Link from "next/link";
import { PublicMap } from "@/adapters/client/public-map";
import { useI18n } from "@/adapters/client/i18n-provider";

export default function HomePage() {
  const { t } = useI18n();
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col gap-9 px-4 py-6 sm:px-8 sm:py-10">
      <section className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{t("brand.descriptive")}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{t("brand.short")}</h1>
        </div>
      </section>

      <PublicMap />

      <section aria-labelledby="workflow-title" className="grid gap-4 rounded-2xl border bg-card p-5 sm:grid-cols-[1fr_auto] sm:items-center sm:p-6">
        <div>
          <h2 id="workflow-title" className="text-lg font-semibold">{t("home.workflowTitle")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("home.workflowBody")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/donate" className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">{t("home.prepareDonation")}</Link>
          <Link href="/request" className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">{t("home.requestHelp")}</Link>
        </div>
      </section>
    </main>
  );
}
