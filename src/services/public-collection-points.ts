import "server-only";
import type { PublicCollectionPoint } from "@/domain/types";
import { readPublicCollectionPoints } from "@/repositories/public-collection-points-repository";

export function listPublicCollectionPoints(): Promise<PublicCollectionPoint[]> {
  return readPublicCollectionPoints();
}
