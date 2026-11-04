"use client";

import Script from "next/script";
import { LocateFixed, MapPin, Navigation, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GeoCoordinates, PublicCollectionPoint } from "@/domain/types";
import { haversineKm } from "@/domain/geospatial";
import { googleMapsBrowserConfig } from "@/adapters/client/maps";
import { useI18n } from "@/adapters/client/i18n-provider";
import { formatNumber } from "@/i18n/locale";

interface GoogleMapInstance {
  panTo(position: { lat: number; lng: number }): void;
  setZoom(zoom: number): void;
}

interface GoogleMapMarker {
  map: GoogleMapInstance | null;
  addEventListener(type: "gmp-click", listener: () => void): void;
}

interface GoogleMapLibrary {
  Map: new (element: HTMLElement, options: {
    center: { lat: number; lng: number };
    zoom: number;
    mapId: string;
    mapTypeControl: boolean;
    streetViewControl: boolean;
    fullscreenControl: boolean;
  }) => GoogleMapInstance;
}

interface GoogleMarkerLibrary {
  AdvancedMarkerElement: new (options: {
    map: GoogleMapInstance;
    position: { lat: number; lng: number };
    title: string;
    content: HTMLElement;
    gmpClickable: boolean;
  }) => GoogleMapMarker;
  PinElement: new (options: { background: string; borderColor: string; glyphColor: string }) => HTMLElement;
}

interface GoogleMapsNamespace {
  maps: {
    importLibrary(name: "maps" | "marker"): Promise<unknown>;
  };
}

interface ListedPoint extends PublicCollectionPoint {
  distanceKm: number | null;
}

function formatHour(value: string | null) {
  return value?.slice(0, 5) ?? null;
}

function normalize(value: string, locale: "en" | "es") {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase(locale).trim();
}

function directionsUrl(point: PublicCollectionPoint) {
  const destination = `${point.latitude},${point.longitude}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

function availabilityLabel(quantity: number, unit: string, locale: "en" | "es") {
  let displayedUnit = unit;
  if (quantity !== 1 && !unit.endsWith("s")) {
    if (locale === "en") displayedUnit = `${unit}s`;
    else if (unit.endsWith("a")) displayedUnit = `${unit.slice(0, -1)}as`;
    else if (unit.endsWith("o")) displayedUnit = `${unit.slice(0, -1)}os`;
    else displayedUnit = `${unit}${/[aeiouáéíóú]$/i.test(unit) ? "s" : "es"}`;
  }
  const available = locale === "en" ? "available" : quantity === 1 ? "disponible" : "disponibles";
  return `${formatNumber(locale, quantity)} ${displayedUnit} ${available}`;
}

export function PublicMap() {
  const { locale, t } = useI18n();
  const [points, setPoints] = useState<PublicCollectionPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [mapError, setMapError] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [filter, setFilter] = useState("");
  const [origin, setOrigin] = useState<GeoCoordinates | null>(null);
  const [notice, setNotice] = useState("");
  const [selectedPointId, setSelectedPointId] = useState("");
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<GoogleMapInstance | null>(null);
  const markers = useRef<GoogleMapMarker[]>([]);
  const mapsKey = googleMapsBrowserConfig.apiKey;

  const loadPoints = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch(`/api/collection-points?locale=${locale}`, { cache: "no-store" });
      const body = await response.json() as { points?: PublicCollectionPoint[]; message?: string };
      if (!response.ok) throw new Error(body.message || t("map.loadError"));
      setPoints(body.points ?? []);
      setSelectedPointId((current) => current || body.points?.[0]?.id || "");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t("map.loadError"));
    } finally {
      setLoading(false);
    }
  }, [locale, t]);

  useEffect(() => { void loadPoints(); }, [loadPoints]);

  const visiblePoints = useMemo<ListedPoint[]>(() => {
    const query = normalize(filter, locale);
    return points
      .filter((point) => !query || normalize(`${point.name} ${point.neighborhood} ${point.city} ${point.products.map((product) => product.name).join(" ")}`, locale).includes(query))
      .map((point) => ({
        ...point,
        distanceKm: origin ? haversineKm(origin, { latitude: point.latitude, longitude: point.longitude }) : null,
      }))
      .sort((a, b) => {
        if (origin) return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
        if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1;
        return a.name.localeCompare(b.name, locale);
      });
  }, [filter, locale, origin, points]);

  useEffect(() => {
    if (!mapReady || !mapsKey || !mapContainer.current) return;
    let cancelled = false;

    async function renderMap() {
      let googleMaps: GoogleMapsNamespace["maps"] | undefined;
      const apiDeadline = Date.now() + 5_000;
      while (Date.now() < apiDeadline) {
        googleMaps = (window as Window & { google?: GoogleMapsNamespace }).google?.maps;
        if (typeof googleMaps?.importLibrary === "function") break;
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }
      if (typeof googleMaps?.importLibrary !== "function") {
        throw new Error("Google Maps JavaScript API did not finish initializing.");
      }
      const [mapsLibrary, markerLibrary] = await Promise.all([
        googleMaps.importLibrary("maps") as Promise<GoogleMapLibrary>,
        googleMaps.importLibrary("marker") as Promise<GoogleMarkerLibrary>,
      ]);
      if (cancelled || !mapContainer.current) return;

      markers.current.forEach((marker) => { marker.map = null; });
      markers.current = [];
      if (visiblePoints.length === 0) return;

      const firstPoint = visiblePoints[0];
      const center = origin
        ? { lat: origin.latitude, lng: origin.longitude }
        : { lat: firstPoint.latitude, lng: firstPoint.longitude };
      const map = mapInstance.current ?? new mapsLibrary.Map(mapContainer.current, {
        center,
        zoom: visiblePoints.length === 1 ? 14 : 11,
        mapId: "DEMO_MAP_ID",
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
      });
      mapInstance.current = map;
      markers.current = visiblePoints.map((point) => {
        const shortage = Math.max(0, point.products.reduce(
          (largest, product) => Math.max(largest, product.unmetDemandQuantity - product.availableQuantity - product.expectedInboundQuantity),
          0,
        ));
        const pin = new markerLibrary.PinElement({
          background: shortage > 0 ? "#c76b3a" : "#176b5b",
          borderColor: "#ffffff",
          glyphColor: "#ffffff",
        });
        const marker = new markerLibrary.AdvancedMarkerElement({
          map,
          position: { lat: point.latitude, lng: point.longitude },
          title: point.name,
          content: pin,
          gmpClickable: true,
        });
        marker.addEventListener("gmp-click", () => setSelectedPointId(point.id));
        return marker;
      });
      map.panTo(center);
    }

    void renderMap().catch((error: unknown) => {
      if (process.env.NODE_ENV === "development") {
        console.error("Google Maps initialization failed: " + (error instanceof Error
          ? `${error.name}: ${error.message}`
          : "Unknown map initialization error"));
      }
      setMapError(true);
    });
    return () => { cancelled = true; };
  }, [mapReady, mapsKey, origin, visiblePoints]);

  function selectPoint(point: PublicCollectionPoint) {
    setSelectedPointId(point.id);
    mapInstance.current?.panTo({ lat: point.latitude, lng: point.longitude });
    mapInstance.current?.setZoom(14);
  }

  function locateMe() {
    if (!navigator.geolocation) {
      setNotice(t("map.noLocation"));
      return;
    }
    setNotice(t("map.locationRequest"));
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setOrigin({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        setNotice(t("map.locationReady"));
      },
      () => setNotice(t("map.locationDenied")),
      { enableHighAccuracy: false, timeout: 8_000, maximumAge: 60_000 },
    );
  }

  const selectedPoint = visiblePoints.find((point) => point.id === selectedPointId);

  return (
    <section aria-labelledby="public-points-title" className="space-y-5">
      {mapsKey && !mapError && <Script
        id="google-maps-javascript-api"
        src={`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(mapsKey)}&loading=async&v=weekly`}
        strategy="afterInteractive"
        onReady={() => setMapReady(true)}
        onError={() => setMapError(true)}
      />}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{t("map.locality")}</p>
          <h2 id="public-points-title" className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{t("home.title")}</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t("home.intro")}</p>
        </div>
        <button onClick={locateMe} className="inline-flex items-center justify-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm font-medium hover:bg-muted">
          <LocateFixed className="size-4" aria-hidden="true" /> {t("map.locate")}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)]">
        <div className="order-1 overflow-hidden rounded-2xl border bg-card">
          {mapsKey && !mapError ? (
            <div ref={mapContainer} aria-label={t("map.region")} role="region" className="h-[280px] w-full bg-muted sm:h-[430px] lg:h-[590px]" />
          ) : (
            <div className="flex h-[280px] flex-col items-center justify-center gap-3 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-50 via-stone-100 to-stone-200 px-6 text-center sm:h-[430px] lg:h-[590px]">
              <span className="grid size-14 place-items-center rounded-2xl bg-white text-primary shadow-sm"><MapPin className="size-7" aria-hidden="true" /></span>
              <div className="max-w-sm">
                <h3 className="font-semibold">{t("map.interactiveTitle", { city: selectedPoint?.city ?? "" })}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{mapError ? t("map.interactiveUnavailable") : t("map.keyHint")}</p>
              </div>
            </div>
          )}
          {selectedPoint && <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4">
            <div><p className="font-semibold">{selectedPoint.name}</p><p className="text-sm text-muted-foreground">{selectedPoint.neighborhood} · {selectedPoint.city}</p></div>
            <a href={directionsUrl(selectedPoint)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
              <Navigation className="size-4" aria-hidden="true" /> {t("map.openGoogle")}
            </a>
          </div>}
        </div>

        <div className="order-2 flex min-h-0 flex-col gap-3">
          <div className="flex gap-2">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border bg-card px-3">
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={t("map.searchPlaceholder")} className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
            </label>
            <button onClick={() => void loadPoints()} disabled={loading} aria-label={t("map.refresh")} className="grid size-11 shrink-0 place-items-center rounded-xl border bg-card hover:bg-muted disabled:opacity-50">
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
            </button>
          </div>
          {notice && <p aria-live="polite" className="text-xs text-muted-foreground">{notice}</p>}
          {loading && <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">{t("map.loading")}</p>}
          {!loading && loadError && <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><p>{loadError}</p><button onClick={() => void loadPoints()} className="mt-2 font-medium underline">{t("map.retry")}</button></div>}
          {!loading && !loadError && visiblePoints.length === 0 && <div className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">{points.length ? t("map.emptyFiltered") : t("map.empty")}</div>}
          <div className="space-y-3 lg:max-h-[590px] lg:overflow-y-auto lg:pr-1">
            {visiblePoints.map((point) => <article key={point.id} className={`rounded-2xl border bg-card p-4 transition ${selectedPointId === point.id ? "border-primary ring-1 ring-primary/20" : "hover:border-foreground/20"}`}>
              <button onClick={() => selectPoint(point)} className="w-full text-left">
                <div className="flex items-start justify-between gap-3">
                  <div><h3 className="font-semibold">{point.name}</h3><p className="mt-1 text-sm text-muted-foreground">{point.neighborhood} · {point.city}</p></div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${point.isOpen ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-600"}`}>
                    {point.opensAt && point.closesAt ? point.isOpen ? `${t("map.open")} · ${t("map.until", { time: formatHour(point.closesAt) ?? "" })}` : `${t("map.closed")} · ${formatHour(point.opensAt) ?? ""}–${formatHour(point.closesAt) ?? ""}` : t("map.scheduleUnavailable")}
                  </span>
                </div>
                {point.distanceKm !== null && <p className="mt-2 text-xs font-medium text-primary">{t("map.distance", { distance: new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(point.distanceKm) })}</p>}
              </button>
              <div className="mt-3 space-y-2 border-t pt-3">
                {point.products.length === 0 && <p className="text-sm text-muted-foreground">{t("map.catalogPending")}</p>}
                {point.products.map((product) => {
                  const shortage = Math.max(0, product.unmetDemandQuantity - product.availableQuantity - product.expectedInboundQuantity);
                  return <div key={product.productId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="font-medium">{product.name}</span>
                    <div className="flex flex-wrap justify-end gap-1.5 text-xs">
                      {product.availableQuantity > 0 && <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-800">{availabilityLabel(product.availableQuantity, product.unit, locale)}</span>}
                      {shortage > 0 && <span className="rounded-full bg-orange-50 px-2 py-1 text-orange-800">{t("map.shortage", { quantity: formatNumber(locale, shortage) })}</span>}
                      {product.expectedInboundQuantity > 0 && <span className="rounded-full bg-sky-50 px-2 py-1 text-sky-800">{t("map.inbound", { quantity: formatNumber(locale, product.expectedInboundQuantity) })}</span>}
                      {product.availableQuantity === 0 && shortage === 0 && product.expectedInboundQuantity === 0 && <span className="rounded-full bg-stone-100 px-2 py-1 text-stone-600">{t("map.noStock")}</span>}
                    </div>
                  </div>;
                })}
              </div>
              <a href={directionsUrl(point)} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary underline-offset-4 hover:underline">
                <Navigation className="size-3.5" aria-hidden="true" /> {t("map.indications")}
              </a>
            </article>)}
          </div>
          <p className="text-xs text-muted-foreground">{t("map.distanceDisclaimer")}</p>
        </div>
      </div>
    </section>
  );
}
