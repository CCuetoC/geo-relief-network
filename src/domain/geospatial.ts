import type { GeoCoordinates } from "@/domain/types";

const EARTH_RADIUS_KM = 6371.0088;

/** Great-circle distance for public point ranking; coordinates stay in the caller's context. */
export function haversineKm(a: GeoCoordinates, b: GeoCoordinates): number {
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(b.latitude - a.latitude);
  const longitudeDelta = toRadians(b.longitude - a.longitude);
  const h = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
