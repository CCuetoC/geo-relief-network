/** Static contracts shared by server-side domain and service modules. */
export type UserRole =
  | "donor"
  | "aid_seeker"
  | "collection_point_manager"
  | "administrator";

export type ConversationChannel = "WEB" | "WHATSAPP";
export type ConversationIntent = "DONATE" | "REQUEST_AID" | "UNKNOWN" | "CANCEL";
export type MobilityPreference = "NEARBY_ONLY" | "CAN_TRAVEL";
export type DonorRoutingPreference = "NEAREST" | "GREATEST_NEED";
export type IsoDateTime = string;

export interface GeoCoordinates {
  latitude: number;
  longitude: number;
}

export interface PublicPointProduct {
  productId: string;
  name: string;
  unit: string;
  availableQuantity: number;
  expectedInboundQuantity: number;
  unmetDemandQuantity: number;
}

export interface PublicCollectionPoint {
  id: string;
  name: string;
  neighborhood: string;
  city: string;
  latitude: number;
  longitude: number;
  opensAt: string | null;
  closesAt: string | null;
  localTime: string;
  isOpen: boolean;
  products: PublicPointProduct[];
}

export interface ProductLineDraft {
  productName: string;
  quantity: number;
  photoMediaIds?: string[];
}

export interface AvailabilityWindow {
  start: string;
  end: string;
}

/** Persist only these extracted slots; never persist raw user text or audio. */
export interface ConversationState {
  intent?: Exclude<ConversationIntent, "UNKNOWN" | "CANCEL">;
  items?: ProductLineDraft[];
  householdSize?: number;
  zone?: string;
  mobility?: MobilityPreference;
  availabilityWindow?: AvailabilityWindow;
  donorPreference?: DonorRoutingPreference;
  estimatedDeliveryTime?: string;
  itemsPreSorted?: boolean;
  photoMediaIds?: string[];
  draftGroupId?: string;
  pendingWaitlistReservationId?: string;
}

export type ConversationMissingField =
  | "intent"
  | "products"
  | "zone"
  | "mobility"
  | "availability_window"
  | "donor_preference"
  | "pre_sorted"
  | "estimated_delivery_time"
  | "photos";

export interface DonationManifest {
  id: string;
  donorId: string;
  collectionPointId: string;
  code: string;
  status: "PENDING" | "VALIDATED" | "REJECTED" | "CANCELLED" | "EXPIRED";
  createdAt: IsoDateTime;
}

export interface AidRequest {
  id: string;
  idempotencyKey: string;
  requesterId: string;
  zone: string;
  submittedAt: IsoDateTime;
}

export type ReservationStatus =
  | "PENDING_CONFIRMATION"
  | "ACTIVE"
  | "PICKED_UP"
  | "CANCELLED"
  | "EXPIRED";

export interface ReservationCommitment {
  id: string;
  requestItemId: string;
  collectionPointId: string;
  productId: string;
  quantity: number;
  status: ReservationStatus;
  expiresAt: IsoDateTime;
  pickupCode?: string;
}

export interface AssistantPhotoContext {
  /** Only this boolean may be included in a prompt; never a URL, key, or image bytes. */
  photo_attached: boolean;
}

export interface ConversationInput {
  conversationId: string;
  channel: ConversationChannel;
  actorId?: string;
  text?: string;
  audio?: { base64: string; format: "wav" | "mp3" };
  location?: GeoCoordinates;
  photoMediaIds?: string[];
  /** Confirmation accepts only the opaque draft token, never model-created action fields. */
  confirmationDraftId?: string;
}

export interface ConversationActionOption {
  draftId: string;
  label: string;
  summary: string;
}

export interface ConversationOutput {
  text: string;
  phase: "CAPTURING" | "PREVIEW" | "NEEDS_AUTH" | "COMPLETED" | "ERROR";
  conversationId: string;
  missingFields?: ConversationMissingField[];
  actionOptions?: ConversationActionOption[];
  recommendation?: CollectionPointRecommendation;
  audioTranscribed?: boolean;
  /** Server adapter handoff only; channel adapters strip this before returning a response. */
  notificationOutboxIds?: string[];
}

export interface CollectionPointRecommendation {
  id: string;
  name: string;
  neighborhood: string;
  distanceKm: number | null;
  openUntil: IsoDateTime | null;
  pickupCapacityAvailable: boolean;
  products: Array<{
    productId: string;
    productName: string;
    requestedQuantity: number;
    availableQuantity: number;
    /** Number of older FIFO entries that have priority over a new request. */
    queuedRequestCount: number;
    maxPerRequest: number;
    expectedInbound: number;
    unmetDemand: number;
  }>;
  reasons: string[];
}
