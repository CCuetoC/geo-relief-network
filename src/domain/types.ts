/** Pure TypeScript contracts. Runtime validation is intentionally deferred. */

export type UserRole =
  | "donor"
  | "aid_seeker"
  | "collection_point_manager"
  | "administrator";

export type IsoDateTime = string;

export interface GeoCoordinates {
  latitude: number;
  longitude: number;
}

export interface PhotoEvidenceReference {
  /** Private storage reference; never include this in model-facing context. */
  storageKey: string;
  contentType: string;
}

export interface DonationManifestLine {
  productId: string;
  declaredQuantity: number;
  photos: PhotoEvidenceReference[];
}

export interface DonationManifest {
  id: string;
  donorId: string;
  collectionPointId: string;
  code: string;
  lines: DonationManifestLine[];
  status: "PENDING" | "VALIDATED";
  createdAt: IsoDateTime;
}

export interface AidRequest {
  id: string;
  idempotencyKey: string;
  requesterId: string;
  collectionPointId: string;
  productId: string;
  requestedQuantity: number;
  reservedQuantity: number;
  waitingQuantity: number;
  zone: string;
  submittedAt: IsoDateTime;
}

export type ReservationCommitment =
  | {
      id: string;
      requestId: string;
      collectionPointId: string;
      productId: string;
      quantity: number;
      status: "PENDING_CONFIRMATION";
      expiresAt: IsoDateTime;
      pickupCode?: never;
    }
  | {
      id: string;
      requestId: string;
      collectionPointId: string;
      productId: string;
      quantity: number;
      status: "ACTIVE";
      expiresAt: IsoDateTime;
      pickupCode: string;
    };

export type InventoryMovementKind = "DONATION_IN" | "PICKUP_OUT" | "AUTHORIZED_ADJUSTMENT";

export interface InventoryMovement {
  id: string;
  collectionPointId: string;
  productId: string;
  quantity: number;
  kind: InventoryMovementKind;
  occurredAt: IsoDateTime;
}

export interface LifecycleEvent {
  id: string;
  aggregateId: string;
  aggregateType: "AID_REQUEST" | "MANIFEST" | "RESERVATION" | "INVENTORY_MOVEMENT";
  eventType: string;
  occurredAt: IsoDateTime;
  metadata?: Readonly<Record<string, unknown>>;
}

export type NotificationStatus = "PENDING" | "SENT" | "FAILED";

export interface NotificationOutboxRecord {
  id: string;
  recipientId: string;
  channel: "WHATSAPP" | "WEB";
  status: NotificationStatus;
  attemptCount: number;
  createdAt: IsoDateTime;
}

/** Safe context for the model. Do not add image bytes or private storage keys here. */
export interface AssistantPhotoContext {
  photo_attached: boolean;
}

export interface SubmitAidRequestInput {
  idempotencyKey: string;
  collectionPointId: string;
  productId: string;
  requestedQuantity: number;
  zone: string;
  userConfirmed: true;
}

export interface CreateDonationManifestInput {
  collectionPointId: string;
  lines: DonationManifestLine[];
  userConfirmed: true;
}
