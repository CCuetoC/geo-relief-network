import "server-only";
import type { CollectionPointRecommendation } from "@/domain/types";
import { haversineKm } from "@/domain/geospatial";
import { fitsOnHandCapacity } from "@/domain/inventory-policy";
import { readPointProductRows, type PointProductRow } from "@/repositories/geospatial-matching-repository";
import type { CollectionPointReadService } from "@/services/contracts";

export { haversineKm } from "@/domain/geospatial";

function minutes(value: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function normalizeZone(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
}

export class NeonCollectionPointReadService implements CollectionPointReadService {
  async recommend(input: Parameters<CollectionPointReadService["recommend"]>[0]): Promise<CollectionPointRecommendation[]> {
    if (input.items.length === 0) return [];
    const requested = new Map<string, { productName: string; quantity: number }>();
    for (const item of input.items) {
      const existing = requested.get(item.productId);
      if (existing) existing.quantity += item.quantity;
      else requested.set(item.productId, { productName: item.productName, quantity: item.quantity });
    }
    const productIds = [...requested.keys()];
    const quantities = productIds.map((productId) => requested.get(productId)!.quantity);
    const rows = await readPointProductRows(productIds, quantities);

    const byPoint = new Map<string, {
      row: PointProductRow;
      productRows: Map<string, PointProductRow>;
      products: CollectionPointRecommendation["products"];
      score: number;
      reasons: string[];
      distanceKm: number | null;
    }>();
    for (const row of rows) {
      let entry = byPoint.get(row.point_id);
      if (!entry) {
        const distanceKm = input.origin
          ? haversineKm(input.origin, { latitude: Number(row.latitude), longitude: Number(row.longitude) })
          : null;
        entry = { row, productRows: new Map(), products: [], score: 0, reasons: [], distanceKm };
        byPoint.set(row.point_id, entry);
      }
      entry.productRows.set(row.product_id, row);
      const available = Number(row.available);
      const waitingDemand = Number(row.unmet_demand);
      const expectedInbound = Number(row.expected_inbound);
      const deficit = Math.max(0, waitingDemand - available - expectedInbound);
      entry.products.push({
        productId: row.product_id,
        productName: row.product_name,
        requestedQuantity: Number(row.requested_quantity),
        availableQuantity: available,
        queuedRequestCount: Number(row.queued_request_count),
        maxPerRequest: Number(row.max_per_request),
        expectedInbound,
        unmetDemand: waitingDemand,
      });
      entry.score += deficit;
    }

    const ranked: CollectionPointRecommendation[] = [];
    for (const [id, entry] of byPoint) {
      const row = entry.row;
      if (entry.products.length !== productIds.length) continue;
      if (input.mode === "AID_SEEKER" && !entry.products.every((item) => item.requestedQuantity <= item.maxPerRequest)) continue;
      const nowMinutes = minutes(row.local_time);
      const closeMinutes = minutes(row.closes_at);
      const openMinutes = minutes(row.opens_at);
      if (nowMinutes === null || closeMinutes === null || openMinutes === null) continue;
      const afterCutoff = closeMinutes - nowMinutes <= Number(row.same_day_cutoff_minutes);
      if (input.mode === "AID_SEEKER") {
        const windowStart = minutes(input.availabilityWindow?.start ?? null);
        const windowEnd = minutes(input.availabilityWindow?.end ?? null);
        if (
          windowStart === null || windowEnd === null || windowStart < nowMinutes || windowEnd <= windowStart ||
          windowStart < openMinutes || windowEnd > closeMinutes || afterCutoff
        ) continue;
      }
      if (input.mode === "DONOR") {
        const delivery = minutes(input.estimatedDeliveryTime ?? null);
        if (
          delivery === null || nowMinutes >= closeMinutes || delivery < openMinutes || delivery >= closeMinutes ||
          Number(row.intake_capacity) <= Number(row.intake_count_today)
        ) continue;
        const fitsCapacity = entry.products.every((item) => {
          const snapshot = entry.productRows.get(item.productId);
          if (!snapshot) return false;
          return fitsOnHandCapacity({
            confirmedOnHand: Number(snapshot.on_hand),
            expectedInbound: item.expectedInbound,
            proposedQuantity: item.requestedQuantity,
            maxOnHand: snapshot.max_on_hand,
          });
        });
        if (!fitsCapacity) continue;
      }

      const reasons: string[] = [];
      if (entry.distanceKm !== null) reasons.push(`${entry.distanceKm.toFixed(1)} km en distancia directa`);
      if (input.mode === "DONOR") {
        const needed = entry.products.filter((item) => Math.max(0, item.unmetDemand - item.availableQuantity - item.expectedInbound) > 0);
        if (needed.length) reasons.push(`déficit actual de ${needed.map((item) => item.productName).join(", ")}`);
        if (entry.products.some((item) => item.expectedInbound > 0)) reasons.push("hay donaciones anunciadas, todavía no disponibles");
      } else if (entry.products.some((item) => item.queuedRequestCount > 0)) {
        reasons.push("hay solicitudes anteriores en la cola FIFO; las unidades se asignan por turno");
      } else if (entry.products.some((item) => item.availableQuantity > 0)) {
        reasons.push("tiene stock físico confirmado disponible");
      } else {
        reasons.push("acepta estos productos, pero ahora no tiene unidades disponibles; la solicitud quedaría en espera");
      }
      if (input.mode === "AID_SEEKER" && Number(row.pickup_capacity) <= Number(row.pickup_count_today)) {
        reasons.push("la capacidad de recojo de hoy está completa; la solicitud podrá quedar en espera");
      }
      reasons.push(`atiende en ${row.neighborhood} hasta ${row.closes_at?.slice(0, 5)}`);

      ranked.push({
        id,
        name: row.point_name,
        neighborhood: row.neighborhood,
        distanceKm: entry.distanceKm,
        openUntil: null,
        pickupCapacityAvailable: Number(row.pickup_capacity) > Number(row.pickup_count_today),
        products: entry.products,
        reasons,
      });
    }

    ranked.sort((a, b) => {
      const entryA = byPoint.get(a.id)!;
      const entryB = byPoint.get(b.id)!;
      const zoneA = normalizeZone(a.neighborhood) === normalizeZone(input.zone) ? 0 : 1;
      const zoneB = normalizeZone(b.neighborhood) === normalizeZone(input.zone) ? 0 : 1;
      if (input.mode === "AID_SEEKER" && input.mobility === "NEARBY_ONLY" && zoneA !== zoneB) return zoneA - zoneB;
      if (input.mode === "DONOR" && input.preference === "NEAREST" && !input.origin && zoneA !== zoneB) return zoneA - zoneB;
      if (input.mode === "DONOR" && input.preference === "GREATEST_NEED" && entryA.score !== entryB.score) {
        return entryB.score - entryA.score;
      }
      if (input.mode === "AID_SEEKER" && input.mobility === "NEARBY_ONLY" && zoneA === 0) return a.name.localeCompare(b.name);
      return (a.distanceKm ?? Number.MAX_SAFE_INTEGER) - (b.distanceKm ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name);
    });
    if (input.mode === "AID_SEEKER" && input.mobility === "NEARBY_ONLY" && !input.origin) {
      const sameZone = ranked.filter((point) => normalizeZone(point.neighborhood) === normalizeZone(input.zone));
      return sameZone.slice(0, 1);
    }
    return ranked.slice(0, input.mode === "AID_SEEKER" && input.mobility === "NEARBY_ONLY" ? 1 : 5);
  }
}
