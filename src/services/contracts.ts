import type {
  AidRequest,
  CollectionPointRecommendation,
  ConversationInput,
  ConversationOutput,
  ConversationState,
  DonationManifest,
  GeoCoordinates,
  Locale,
} from "@/domain/types";

export interface ConversationService {
  respond(input: ConversationInput): Promise<ConversationOutput>;
}

export interface AidRequestService {
  submit(input: {
    actorId: string;
    idempotencyKey: string;
    zone: string;
    mobility: "NEARBY_ONLY" | "CAN_TRAVEL";
    availabilityWindow: { start: string; end: string };
    pointId: string;
    items: Array<{ productId: string; requestedQuantity: number; reserveQuantity: number }>;
  }): Promise<AidRequest>;
}

export interface DonationManifestService {
  createPending(input: {
    actorId: string;
    idempotencyKey: string;
    collectionPointId: string;
    estimatedDeliveryAt: string;
    lines: Array<{ productId: string; declaredQuantity: number; photoMediaIds: string[] }>;
  }): Promise<DonationManifest>;
}

export interface CollectionPointReadService {
  recommend(input: {
    locale: Locale;
    zone: string;
    origin?: GeoCoordinates;
    items: Array<{ productId: string; productName: string; quantity: number }>;
    mode: "DONOR" | "AID_SEEKER";
    mobility?: "NEARBY_ONLY" | "CAN_TRAVEL";
    preference?: "NEAREST" | "GREATEST_NEED";
    availabilityWindow?: { start: string; end: string };
    estimatedDeliveryTime?: string;
  }): Promise<CollectionPointRecommendation[]>;
}

export interface ConversationContextRepository {
  load(id: string, actorId?: string): Promise<ConversationState | null>;
  save(id: string, channel: "WEB" | "WHATSAPP", state: ConversationState, actorId?: string): Promise<void>;
  delete(id: string, actorId?: string): Promise<void>;
}

export interface StructuredTurnExtractor {
  extract(input: {
    text?: string;
    audio?: { base64: string; format: "wav" | "mp3" };
    state: ConversationState;
    photoAttached: boolean;
    locale: Locale;
    catalog: Array<{ slug: string; name: string; aliases: string[] }>;
  }): Promise<ConversationState & { cancel?: boolean }>;
}
