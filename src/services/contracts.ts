import type {
  AidRequest,
  CreateDonationManifestInput,
  DonationManifest,
  GeoCoordinates,
  ReservationCommitment,
  SubmitAidRequestInput,
} from "@/domain/types";

/** Interfaces only: business rules and persistence are intentionally deferred. */
export interface DonationManifestService {
  createPending(input: CreateDonationManifestInput): Promise<DonationManifest>;
}

export interface AidRequestService {
  submit(input: SubmitAidRequestInput): Promise<AidRequest>;
}

export interface ReservationService {
  requestReservation(requestId: string): Promise<ReservationCommitment[]>;
}

export interface WaitlistService {
  process(pointId: string, productId: string): Promise<void>;
}

export interface CollectionPointCandidate {
  id: string;
  coordinates: GeoCoordinates;
}

export interface GeospatialMatchingService {
  rankNearest(origin: GeoCoordinates, candidates: CollectionPointCandidate[]): CollectionPointCandidate[];
}

export interface ConversationService {
  respond(input: ConversationInput): Promise<ConversationOutput>;
}

export interface ConversationInput {
  channel: "WEB" | "WHATSAPP";
  actorId?: string;
  text?: string;
  audioReference?: string;
  photoAttached?: boolean;
}

export interface ConversationOutput {
  text: string;
  requiresUserConfirmation: boolean;
}
