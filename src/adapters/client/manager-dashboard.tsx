"use client";

import { useCallback, useEffect, useState } from "react";
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
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{t("brand.short")}</p>
          <h1 className="mt-1 text-2xl font-semibold">{t("manager.title")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t("manager.intro")}</p>
        </div>
        {signedIn && <button disabled={busy} onClick={() => void load()} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">{t("manager.refresh")}</button>}
      </header>

      <p aria-live="polite" className="min-h-5 text-sm text-muted-foreground">{status}</p>
      {signedIn && <>
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t("manager.pendingManifests")}</h2>
          {manifests.length === 0 && <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">{t("manager.noManifests")}</p>}
          {manifests.map((manifest) => <article key={manifest.id} className="space-y-4 rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h3 className="font-semibold">{manifest.point_name} · {manifest.neighborhood}</h3><p className="text-sm text-muted-foreground">{t("manager.manifestCode", { code: manifest.code })} · {t("manager.estimatedDelivery")} {formatDate(locale, manifest.estimated_delivery_at, manifest.timezone)}</p></div>
              <button disabled={busy} onClick={() => void processQueue(manifest)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">{t("manager.processQueue")}</button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {manifest.lines.map((line) => <div key={line.id} className="rounded-lg border p-3">
                <h4 className="font-medium">{line.product_name} · {t("manager.declared")} {formatNumber(locale, line.declared_quantity)}</h4>
                <p className="text-xs text-muted-foreground">{t("manager.photosEvidence", { count: line.photo_media_ids.length })}</p>
                <div className="mt-2 flex flex-wrap gap-2">{line.photo_media_ids.map((id) => <a key={id} href={`/api/manager/media/${id}`} target="_blank" rel="noreferrer"><img src={`/api/manager/media/${id}`} alt={t("manager.photoAlt", { product: line.product_name })} className="h-24 w-24 rounded-md border object-cover" /></a>)}</div>
                <label className="mt-3 flex items-center gap-2 text-sm">{t("manager.acceptedQuantity")}
                  <input type="number" min="0" max="10000" value={accepted[line.id] ?? String(line.declared_quantity)} onChange={(event) => setAccepted((current) => ({ ...current, [line.id]: event.target.value }))} className="w-24 rounded-md border bg-background px-2 py-1" />
                </label>
              </div>)}
            </div>
            <button disabled={busy} onClick={() => void validate(manifest)} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{t("manager.validate")}</button>
          </article>)}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t("manager.pendingPickups")}</h2>
          {reservations.length === 0 && <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">{t("manager.noPickups")}</p>}
          {reservations.map((reservation) => <article key={reservation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
            <div><h3 className="font-medium">{formatNumber(locale, reservation.quantity)} {reservation.product_name} · {reservation.point_name}</h3><p className="text-sm text-muted-foreground">{t("manager.zone")}: {reservation.requester_zone} · {t("manager.expires", { date: formatDate(locale, reservation.expires_at, reservation.timezone) })}</p></div>
            <div className="flex gap-2"><input inputMode="numeric" maxLength={8} placeholder={t("manager.pickupCode")} value={codes[reservation.id] ?? ""} onChange={(event) => setCodes((current) => ({ ...current, [reservation.id]: event.target.value.replace(/\D/g, "").slice(0, 8) }))} className="w-36 rounded-md border bg-background px-3 py-2 text-sm" /><button disabled={busy || (codes[reservation.id] ?? "").length !== 8} onClick={() => void confirmPickup(reservation)} className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">{t("manager.confirmPickup")}</button></div>
          </article>)}
        </section>
      </>}
    </main>
  );
}
