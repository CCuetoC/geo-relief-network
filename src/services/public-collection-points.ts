import "server-only";
import type { Locale, PublicCollectionPoint } from "@/domain/types";
import { readPublicCollectionPoints } from "@/repositories/public-collection-points-repository";

export function listPublicCollectionPoints(locale: Locale): Promise<PublicCollectionPoint[]> {
  return readPublicCollectionPoints(locale);
}
