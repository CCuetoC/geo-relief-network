"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MapPin, MessageCircle, Warehouse } from "lucide-react";
import { AccountStatusBar } from "@/adapters/client/account-status-bar";
import { useI18n } from "@/adapters/client/i18n-provider";

export function AppNav() {
  const pathname = usePathname();
  const { t } = useI18n();
  const tabs = [
    { href: "/", label: t("nav.map"), Icon: MapPin, active: pathname === "/" },
    { href: "/chat", label: t("nav.assistant"), Icon: MessageCircle, active: ["/chat", "/donate", "/request"].some((path) => pathname.startsWith(path)) },
    { href: "/manager", label: t("nav.managerTab"), Icon: Warehouse, active: pathname.startsWith("/manager") },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-2 px-4 py-3 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 lg:shrink-0">
          <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[#0064E0] focus-visible:ring-offset-2">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#0064E0] text-white shadow-sm" aria-hidden="true">
              <MapPin className="size-5" />
            </span>
            <span className="whitespace-nowrap text-[13px] font-semibold tracking-tight text-slate-950 sm:text-base">{t("brand.short")}</span>
          </Link>
          <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[9px] font-medium text-slate-600 sm:px-2.5 sm:text-xs lg:hidden">
            {t("brand.poweredBy")}
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 lg:justify-end">
          <nav aria-label={t("nav.actions")} className="flex items-center gap-1 rounded-xl bg-slate-100/80 p-1">
            {tabs.map(({ href, label, Icon, active }) => (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors sm:px-3 sm:text-sm ${active ? "bg-[#0064E0] text-white shadow-sm" : "text-slate-600 hover:bg-white hover:text-slate-950"}`}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span>{label}</span>
              </Link>
            ))}
          </nav>

          <div className="flex w-full items-center justify-between gap-2 lg:w-auto lg:justify-end">
            <span className="hidden shrink-0 text-xs font-medium text-slate-500 lg:inline">{t("brand.poweredBy")}</span>
            <AccountStatusBar />
          </div>
        </div>
      </div>
    </header>
  );
}
