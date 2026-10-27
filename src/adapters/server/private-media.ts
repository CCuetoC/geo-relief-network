import type { PhotoEvidenceReference } from "@/domain/types";

export interface PrivateMediaAdapter {
  store(input: { bytes: Uint8Array; contentType: string }): Promise<PhotoEvidenceReference>;
  createShortLivedReadUrl(reference: PhotoEvidenceReference): Promise<string>;
}
