import { randomUUID } from "node:crypto";
import { withTransaction } from "@/core/server/db";
import { createActionDraft } from "@/services/action-drafts";
import type {
  AidDraftPayload,
  ManifestDraftPayload,
  WaitlistConfirmationDraftPayload,
} from "@/services/action-execution";
import type { InventoryFixture } from "./inventory-fixtures";
import { currentAvailabilityWindow, insertTestPhoto } from "./inventory-fixtures";

export async function createAidActionDraft(input: {
  fixture: InventoryFixture;
  actorId: string;
  requestedQuantity: number;
  reserveQuantity: number;
  expectedAvailable: number;
  idempotencyKey?: string;
}) {
  const conversationId = randomUUID();
  const idempotencyKey = input.idempotencyKey ?? randomUUID();
  const payload: AidDraftPayload = {
    channel: "WEB",
    pointId: input.fixture.pointId,
    zone: "Fixture",
    mobility: "CAN_TRAVEL",
    availabilityWindow: await currentAvailabilityWindow(input.fixture.timezone),
    items: [{
      productId: input.fixture.productId,
      productName: input.fixture.productName,
      requestedQuantity: input.requestedQuantity,
      reserveQuantity: input.reserveQuantity,
      expectedAvailable: input.expectedAvailable,
    }],
  };
  const draft = await createActionDraft({
    actorId: input.actorId,
    conversationId,
    actionType: "AID_REQUEST",
    idempotencyKey,
    payload,
    preview: { testFixture: true },
  });
  return { ...draft, actorId: input.actorId, conversationId, idempotencyKey, payload };
}

export async function createDonationActionDraft(input: {
  fixture: InventoryFixture;
  actorId: string;
  quantity: number;
  idempotencyKey?: string;
}) {
  const conversationId = randomUUID();
  const idempotencyKey = input.idempotencyKey ?? randomUUID();
  const photoMediaId = await insertTestPhoto(input.actorId);
  const timestamp = await withTransaction((client) => client.query<{ eta: string }>(
    "SELECT transaction_timestamp()::text AS eta",
  ));
  const payload: ManifestDraftPayload = {
    channel: "WEB",
    pointId: input.fixture.pointId,
    zone: "Fixture",
    estimatedDeliveryAt: timestamp.rows[0].eta,
    items: [{
      productId: input.fixture.productId,
      productName: input.fixture.productName,
      quantity: input.quantity,
      photoMediaIds: [photoMediaId],
    }],
  };
  const draft = await createActionDraft({
    actorId: input.actorId,
    conversationId,
    actionType: "DONATION_MANIFEST",
    idempotencyKey,
    payload,
    preview: { testFixture: true },
  });
  return { ...draft, actorId: input.actorId, conversationId, idempotencyKey, payload, photoMediaId };
}

export async function createWaitlistConfirmationDraft(input: {
  fixture: InventoryFixture;
  actorId: string;
  reservationId: string;
}) {
  const conversationId = randomUUID();
  const idempotencyKey = randomUUID();
  const payload: WaitlistConfirmationDraftPayload = {
    reservationId: input.reservationId,
    availabilityWindow: await currentAvailabilityWindow(input.fixture.timezone),
  };
  const draft = await createActionDraft({
    actorId: input.actorId,
    conversationId,
    actionType: "WAITLIST_CONFIRMATION",
    idempotencyKey,
    payload,
    preview: { testFixture: true },
  });
  return { ...draft, actorId: input.actorId, conversationId, idempotencyKey, payload };
}
