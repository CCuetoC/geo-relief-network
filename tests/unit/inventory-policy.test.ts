import assert from "node:assert/strict";
import test from "node:test";
import {
  fitsOnHandCapacity,
  isAdvisoryDeliveryTimeValid,
  isWithinOperatingHours,
  minutesSinceMidnight,
} from "@/domain/inventory-policy";
import { haversineKm } from "@/services/geospatial-matching";

test("expected inbound consumes physical capacity without becoming on-hand stock", () => {
  assert.equal(fitsOnHandCapacity({ confirmedOnHand: 3, expectedInbound: 2, proposedQuantity: 5, maxOnHand: 10 }), true);
  assert.equal(fitsOnHandCapacity({ confirmedOnHand: 3, expectedInbound: 2, proposedQuantity: 6, maxOnHand: 10 }), false);
});

test("operating hours include opening time and exclude closing time", () => {
  assert.equal(isWithinOperatingHours({ localTime: "08:00", opensAt: "08:00", closesAt: "18:00" }), true);
  assert.equal(isWithinOperatingHours({ localTime: "17:59", opensAt: "08:00", closesAt: "18:00" }), true);
  assert.equal(isWithinOperatingHours({ localTime: "18:00", opensAt: "08:00", closesAt: "18:00" }), false);
  assert.equal(isWithinOperatingHours({ localTime: "07:59", opensAt: "08:00", closesAt: "18:00" }), false);
});

test("time parsing rejects malformed clock values", () => {
  assert.equal(minutesSinceMidnight("23:59:00"), 1439);
  assert.equal(minutesSinceMidnight("24:00"), null);
  assert.equal(minutesSinceMidnight("10:60"), null);
  assert.equal(minutesSinceMidnight("noon"), null);
  assert.equal(minutesSinceMidnight(null), null);
});

test("donation ETA is advisory while the point is open", () => {
  assert.equal(isAdvisoryDeliveryTimeValid({ etaMinute: 8 * 60, nowMinute: 15 * 60, opensAtMinute: 8 * 60, closesAtMinute: 18 * 60 }), true);
  assert.equal(isAdvisoryDeliveryTimeValid({ etaMinute: 7 * 60 + 59, nowMinute: 15 * 60, opensAtMinute: 8 * 60, closesAtMinute: 18 * 60 }), false);
  assert.equal(isAdvisoryDeliveryTimeValid({ etaMinute: 18 * 60, nowMinute: 17 * 60, opensAtMinute: 8 * 60, closesAtMinute: 18 * 60 }), false);
  assert.equal(isAdvisoryDeliveryTimeValid({ etaMinute: 9 * 60, nowMinute: 18 * 60, opensAtMinute: 8 * 60, closesAtMinute: 18 * 60 }), false);
});

test("Haversine distance is zero for the same point and symmetric", () => {
  const limaCenter = { latitude: -12.0464, longitude: -77.0428 };
  const miraflores = { latitude: -12.1211, longitude: -77.0297 };
  assert.equal(haversineKm(limaCenter, limaCenter), 0);
  assert.ok(haversineKm(limaCenter, miraflores) > 8 && haversineKm(limaCenter, miraflores) < 9);
  assert.ok(Math.abs(haversineKm(limaCenter, miraflores) - haversineKm(miraflores, limaCenter)) < 1e-9);
});
