"use client";

import { useCallback, useEffect, useState } from "react";
import { Camera, Clock3, MapPin, PackageCheck, RefreshCw } from "lucide-react";
import { authClient } from "@/adapters/client/neon-auth";
import { useI18n } from "@/adapters/client/i18n-provider";
import { formatDate } from "@/i18n/locale";
import { formatNumber } from "@/i18n/locale";

interface ManifestLine {
  id: string;
  product_id: string;
  product_name: string;
  declared_quantity: number;
  photo_media_ids: string[];
}

interface Manifest {
  id: string;
  code: string;
  point_id: string;
  point_name: string;
  neighborhood: string;
  timezone: string;
  estimated_delivery_at: string;
  lines: ManifestLine[];
}

interface Reservation {
  id: string;
  point_id: string;
  point_name: string;
  product_name: string;
  quantity: number;
  expires_at: string;
  requester_zone: string;
  timezone: string;
}

export function ManagerDashboard() {
  const { locale, t } = useI18n();
  const [signedIn, setSignedIn] = useState(false);
  const [manifests, setManifests] = useState<Manifest[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [accepted, setAccepted] = useState<Record<string, string>>({});
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [manifestResponse, reservationResponse] = await Promise.all([
        fetch(`/api/manager/manifests?locale=${locale}`),
        fetch(`/api/manager/reservations?locale=${locale}`),
      ]);
      if (manifestResponse.status === 401 || reservationResponse.status === 401) {
        setSignedIn(false);
        setManifests([]);
        setReservations([]);
        setStatus(t("manager.loginRequired"));
        return;
      }
      setSignedIn(true);
      if (manifestResponse.status === 403 || reservationResponse.status === 403) {
        setManifests([]);
        setReservations([]);
        setStatus(t("manager.accessDenied"));
        return;
      }
      const manifestBody = await manifestResponse.json() as { manifests?: Manifest[] };
      const reservationBody = await reservationResponse.json() as { reservations?: Reservation[] };
      setManifests(manifestBody.manifests ?? []);
      setReservations(reservationBody.reservations ?? []);
      setStatus("");
    } catch {
      setStatus(t("manager.loadError"));
    } finally {
      setBusy(false);
    }
  }, [locale, t]);

  useEffect(() => {
    void authClient.getSession().then(({ data }) => {
      setSignedIn(Boolean(data?.user));
      if (data?.user) void load();
      else setStatus(t("manager.loginHint"));
    }).catch(() => {
      setSignedIn(false);
      setStatus(t("manager.sessionError"));
    });
    const refreshOnFocus = () => void load();
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [load]);

  async function validate(manifest: Manifest) {
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch(`/api/manager/manifests/${manifest.id}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: manifest.lines.map((line) => ({
          lineId: line.id,
          acceptedQuantity: Number(accepted[line.id] ?? line.declared_quantity),
        })) }),
      });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(t("manager.validationError"));
      setStatus(t("manager.validated", { code: manifest.code }));
      await load();
    } catch (error) {
      setStatus(t("manager.validationError"));
    } finally {
      setBusy(false);
    }
  }

  async function processQueue(manifest: Manifest) {
    setBusy(true);
    try {
      for (const productId of [...new Set(manifest.lines.map((line) => line.product_id))]) {
        const response = await fetch("/api/manager/queue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pointId: manifest.point_id, productId }),
        });
        const result = await response.json() as { message?: string };
        if (!response.ok) throw new Error(t("manager.queueError"));
      }
      setStatus(t("manager.queueProcessed"));
      await load();
    } catch (error) {
      setStatus(t("manager.queueError"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmPickup(reservation: Reservation) {
    setBusy(true);
    try {
      const response = await fetch(`/api/manager/reservations/${reservation.id}/pickup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pickupCode: codes[reservation.id] ?? "" }),
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(t("manager.pickupError"));
      setStatus(t("manager.pickupDone", { quantity: formatNumber(locale, reservation.quantity), product: reservation.product_name }));
      setCodes((current) => ({ ...current, [reservation.id]: "" }));
      await load();
    } catch (error) {
      setStatus(t("manager.pickupError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-7 px-4 py-6 sm:px-8 sm:py-10">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200/80 pb-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0064E0]">{t("manager.pendingManifests")}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{t("manager.title")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t("manager.intro")}</p>
        </div>
        {signedIn && <button disabled={busy} onClick={() => void load()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"><RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} aria-hidden="true" />{t("manager.refresh")}</button>}
      </header>

      <p aria-live="polite" className={`min-h-5 rounded-xl text-sm ${status ? "border border-slate-200/80 bg-white px-4 py-3 text-slate-700 shadow-sm" : "text-muted-foreground"}`}>{status}</p>
      {signedIn && <>
        <section aria-labelledby="pending-manifests-title" className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-[#0064E0]/10 text-[#0064E0]"><PackageCheck className="size-5" aria-hidden="true" /></span>
            <h2 id="pending-manifests-title" className="text-lg font-semibold tracking-tight">{t("manager.pendingManifests")}</h2>
          </div>
          {manifests.length === 0 && <p className="rounded-2xl border border-slate-200/80 bg-white p-5 text-sm text-muted-foreground shadow-sm">{t("manager.noManifests")}</p>}
          {manifests.map((manifest) => <article key={manifest.id} className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200/80 bg-slate-50/80 p-4 sm:p-5">
              <div className="min-w-0">
                <h3 className="font-semibold tracking-tight">{manifest.point_name}</h3>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-600"><MapPin className="size-4 shrink-0" aria-hidden="true" />{manifest.neighborhood}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-mono text-slate-700">{t("manager.manifestCode", { code: manifest.code })}</span>
                  <span className="inline-flex items-center gap-1.5 text-slate-600"><Clock3 className="size-3.5" aria-hidden="true" />{t("manager.estimatedDelivery")} {formatDate(locale, manifest.estimated_delivery_at, manifest.timezone)}</span>
                </div>
              </div>
              <button disabled={busy} onClick={() => void processQueue(manifest)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"><RefreshCw className="size-4" aria-hidden="true" />{t("manager.processQueue")}</button>
            </div>
            <div className="space-y-4 p-4 sm:p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                {manifest.lines.map((line) => (
                  <div key={line.id} className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4">
                    <h4 className="font-medium">{line.product_name} <span className="text-sm font-normal text-slate-600">· {t("manager.declared")} {formatNumber(locale, line.declared_quantity)}</span></h4>
                    <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-slate-600"><Camera className="size-3.5" aria-hidden="true" />{t("manager.photosEvidence", { count: line.photo_media_ids.length })}</p>
                    <div className="mt-3 flex flex-wrap gap-2">{line.photo_media_ids.map((id) => <a key={id} href={`/api/manager/media/${id}`} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"><img src={`/api/manager/media/${id}`} alt={t("manager.photoAlt", { product: line.product_name })} className="h-24 w-24 object-cover transition hover:scale-105" /></a>)}</div>
                    <label className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm font-medium">{t("manager.acceptedQuantity")}
                      <input type="number" min="0" max="10000" value={accepted[line.id] ?? String(line.declared_quantity)} onChange={(event) => setAccepted((current) => ({ ...current, [line.id]: event.target.value }))} className="h-11 w-28 rounded-lg border border-slate-200 bg-white px-3 text-sm tabular-nums shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-[#0064E0]/30" />
                    </label>
                  </div>
                ))}
              </div>
              <button disabled={busy} onClick={() => void validate(manifest)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#0064E0] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0057c2] disabled:cursor-not-allowed disabled:opacity-50"><PackageCheck className="size-4" aria-hidden="true" />{t("manager.validate")}</button>
            </div>
          </article>)}
        </section>

        <section aria-labelledby="pending-pickups-title" className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><PackageCheck className="size-5" aria-hidden="true" /></span>
            <h2 id="pending-pickups-title" className="text-lg font-semibold tracking-tight">{t("manager.pendingPickups")}</h2>
          </div>
          {reservations.length === 0 && <p className="rounded-2xl border border-slate-200/80 bg-white p-5 text-sm text-muted-foreground shadow-sm">{t("manager.noPickups")}</p>}
          {reservations.map((reservation) => <article key={reservation.id} className="grid gap-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-5">
            <div className="min-w-0">
              <h3 className="font-semibold tracking-tight">{formatNumber(locale, reservation.quantity)} {reservation.product_name}</h3>
              <p className="mt-1 text-sm text-slate-600">{reservation.point_name}</p>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                <span>{t("manager.zone")}: {reservation.requester_zone}</span>
                <span className="inline-flex items-center gap-1"><Clock3 className="size-3.5" aria-hidden="true" />{t("manager.expires", { date: formatDate(locale, reservation.expires_at, reservation.timezone) })}</span>
              </div>
            </div>
            <div className="grid gap-2 sm:flex sm:items-center">
              <input inputMode="numeric" maxLength={8} placeholder={t("manager.pickupCode")} aria-label={t("manager.pickupCode")} value={codes[reservation.id] ?? ""} onChange={(event) => setCodes((current) => ({ ...current, [reservation.id]: event.target.value.replace(/\D/g, "").slice(0, 8) }))} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm tracking-[0.2em] shadow-sm outline-none placeholder:tracking-normal focus-visible:ring-2 focus-visible:ring-[#0064E0]/30 sm:w-40" />
              <button disabled={busy || (codes[reservation.id] ?? "").length !== 8} onClick={() => void confirmPickup(reservation)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#0064E0] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0057c2] disabled:cursor-not-allowed disabled:opacity-50"><PackageCheck className="size-4" aria-hidden="true" />{t("manager.confirmPickup")}</button>
            </div>
          </article>)}
        </section>
      </>}
    </main>
  );
}
