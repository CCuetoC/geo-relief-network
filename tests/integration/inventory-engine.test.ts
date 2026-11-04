import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import { withTransaction } from "@/core/server/db";
import { getNeonTransactionPool } from "@/core/server/neon";
import { executeConfirmedAction } from "@/services/action-execution";
import { createActionDraft } from "@/services/action-drafts";
import {
  listActiveReservations,
  listManagedPoints,
  listPendingManifests,
  ManagerOperationError,
  processManagerQueue,
  recordPhysicalPickup,
  validateDonationManifest,
} from "@/services/manager-operations";
import { createAidActionDraft, createDonationActionDraft, createWaitlistConfirmationDraft } from "../support/action-drafts";
import {
  createActor,
  createInventoryFixture,
  readInventorySnapshot,
  setClosingInMinutes,
} from "../support/inventory-fixtures";

async function requireMigration0003() {
  const rows = await withTransaction((client) => client.query<{ version: string; checksum: string }>(
    "SELECT version, checksum FROM grn_schema_migrations ORDER BY version DESC LIMIT 1",
  ));
  assert.equal(rows.rows[0]?.version, "0003", "La rama de prueba debe tener la migración 0003 aplicada.");
  const migration = await readFile(resolve(process.cwd(), "migrations/0003-daily-manifest-expiry.sql"));
  const expectedChecksum = createHash("sha256").update(migration).digest("hex");
  assert.equal(rows.rows[0]?.checksum, expectedChecksum, "El checksum de la migración 0003 debe coincidir con el repositorio.");
}

before(requireMigration0003);
after(async () => {
  await getNeonTransactionPool().end();
});

test("un manifiesto pendiente cuenta como suministro y la validación humana convierte solo lo recibido", async () => {
  const fixture = await createInventoryFixture({ maxOnHand: 5 });
  const donorId = createActor("donor");
  const draft = await createDonationActionDraft({ fixture, actorId: donorId, quantity: 4 });
  const created = await executeConfirmedAction(draft.draftId, donorId);
  if (created.status !== "COMPLETED" || created.actionType !== "DONATION_MANIFEST") assert.fail("El borrador de manifiesto no se completó.");

  const initial = await readInventorySnapshot(fixture, [donorId]);
  assert.equal(initial.expectedInbound, 4);
  assert.equal(initial.onHand, 0);
  assert.equal(initial.available, 0);

  const replayDraft = await createActionDraft({
    actorId: donorId,
    conversationId: randomUUID(),
    actionType: "DONATION_MANIFEST",
    idempotencyKey: draft.idempotencyKey,
    payload: draft.payload,
    preview: { replay: true },
  });
  const replayed = await executeConfirmedAction(replayDraft.draftId, donorId);
  if (replayed.status !== "COMPLETED" || replayed.actionType !== "DONATION_MANIFEST") assert.fail("El replay no devolvió el manifiesto existente.");
  assert.equal(replayed.manifestId, created.manifestId);

  await assert.rejects(
    validateDonationManifest(createActor("unauthorized-manager"), created.manifestId, [{ lineId: await getManifestLineId(created.manifestId), acceptedQuantity: 3 }]),
    (error: unknown) => error instanceof ManagerOperationError && error.status === 403,
  );

  const lineId = await getManifestLineId(created.manifestId);
  await validateDonationManifest(fixture.managerId, created.manifestId, [{ lineId, acceptedQuantity: 3 }]);
  const final = await readInventorySnapshot(fixture, [donorId]);
  assert.equal(final.expectedInbound, 0);
  assert.equal(final.onHand, 3);
  assert.equal(final.available, 3);
  assert.equal(final.manifests, 1);
  assert.equal(final.movements, 1);

  const persisted = await withTransaction((client) => client.query<{ status: string; accepted: number; media_status: string }>(
    `SELECT m.status, ml.validated_quantity AS accepted, pm.status AS media_status
       FROM grn_donation_manifests m
       JOIN grn_donation_manifest_lines ml ON ml.manifest_id = m.id
       JOIN grn_private_media pm ON pm.id = ANY(ml.photo_media_ids)
      WHERE m.id = $1`,
    [created.manifestId],
  ));
  assert.equal(persisted.rows[0]?.status, "VALIDATED");
  assert.equal(Number(persisted.rows[0]?.accepted), 3);
  assert.equal(persisted.rows[0]?.media_status, "ATTACHED");
});

test("dos donantes concurrentes no superan el tope físico contando el suministro anunciado", async () => {
  const fixture = await createInventoryFixture({ maxOnHand: 5 });
  const donors = [createActor("capacity-donor-a"), createActor("capacity-donor-b")];
  const drafts = await Promise.all(donors.map((actorId) => createDonationActionDraft({
    fixture,
    actorId,
    quantity: 4,
  })));
  const results = await Promise.all(drafts.map((draft, index) => executeConfirmedAction(draft.draftId, donors[index])));
  const acceptedManifests = results.filter((result) => result.status === "COMPLETED" && result.actionType === "DONATION_MANIFEST");
  const staleManifests = results.filter((result) => result.status === "STALE");
  assert.equal(acceptedManifests.length, 1);
  assert.equal(staleManifests.length, 1);

  const manifest = acceptedManifests[0];
  if (manifest.status !== "COMPLETED" || manifest.actionType !== "DONATION_MANIFEST") assert.fail("No se pudo identificar el manifiesto aceptado.");
  const beforeValidation = await readInventorySnapshot(fixture);
  assert.equal(beforeValidation.onHand, 0);
  assert.equal(beforeValidation.expectedInbound, 4);
  assert.equal(beforeValidation.manifests, 1);

  await validateDonationManifest(fixture.managerId, manifest.manifestId, [{
    lineId: await getManifestLineId(manifest.manifestId),
    acceptedQuantity: 4,
  }]);
  const afterValidation = await readInventorySnapshot(fixture);
  assert.equal(afterValidation.onHand, 4);
  assert.equal(afterValidation.expectedInbound, 0);
  assert.equal(afterValidation.available, 4);
  assert.equal(afterValidation.manifests, 1);
});

test("la solicitud indivisible pide ajustar si el stock no cubre la cantidad y el replay idempotente no duplica demanda", async () => {
  const fixture = await createInventoryFixture({ initialStock: 3 });
  const firstRequester = createActor("requester");
  const secondRequester = createActor("requester");

  const oversized = await createAidActionDraft({
    fixture,
    actorId: firstRequester,
    requestedQuantity: 5,
    reserveQuantity: 0,
    expectedAvailable: 3,
  });
  const oversizedResult = await executeConfirmedAction(oversized.draftId, firstRequester);
  assert.equal(oversizedResult.status, "STALE");
  assert.equal((await readInventorySnapshot(fixture, [firstRequester])).requests, 0);

  const idempotencyKey = randomUUID();
  const acceptedDraft = await createAidActionDraft({
    fixture,
    actorId: firstRequester,
    requestedQuantity: 3,
    reserveQuantity: 3,
    expectedAvailable: 3,
    idempotencyKey,
  });
  const accepted = await executeConfirmedAction(acceptedDraft.draftId, firstRequester);
  if (accepted.status !== "COMPLETED" || accepted.actionType !== "AID_REQUEST") assert.fail("La solicitud ajustada no se completó.");
  assert.equal(accepted.reservations[0]?.quantity, 3);
  assert.equal(accepted.reservations[0]?.pickupCode.length, 8);

  const replayDraft = await createAidActionDraft({
    fixture,
    actorId: firstRequester,
    requestedQuantity: 3,
    reserveQuantity: 3,
    expectedAvailable: 3,
    idempotencyKey,
  });
  const replayed = await executeConfirmedAction(replayDraft.draftId, firstRequester);
  if (replayed.status !== "COMPLETED" || replayed.actionType !== "AID_REQUEST") assert.fail("El replay idempotente no devolvió la solicitud existente.");
  assert.equal(replayed.requestId, accepted.requestId);

  const waitingDraft = await createAidActionDraft({
    fixture,
    actorId: secondRequester,
    requestedQuantity: 2,
    reserveQuantity: 0,
    expectedAvailable: 0,
  });
  const waiting = await executeConfirmedAction(waitingDraft.draftId, secondRequester);
  if (waiting.status !== "COMPLETED" || waiting.actionType !== "AID_REQUEST") assert.fail("La solicitud sin stock no se registró en espera.");
  assert.deepEqual(waiting.waiting, [{ productName: fixture.productName, quantity: 2 }]);

  const result = await readInventorySnapshot(fixture, [firstRequester, secondRequester]);
  assert.equal(result.requests, 2);
  assert.equal(result.onHand, 3);
  assert.equal(result.available, 0);
  assert.equal(result.commitments, 1);
  assert.equal(result.waitingEntries, 1);
  const lines = await withTransaction((client) => client.query<{ requested_quantity: number; waiting_quantity: number }>(
    `SELECT i.requested_quantity, i.waiting_quantity
       FROM grn_aid_request_items i JOIN grn_aid_requests r ON r.id = i.request_id
      WHERE r.requester_id = ANY($1::text[]) ORDER BY i.fifo_sequence`,
    [[firstRequester, secondRequester]],
  ));
  assert.deepEqual(lines.rows.map((line) => [Number(line.requested_quantity), Number(line.waiting_quantity)]), [[3, 0], [2, 2]]);
});

test("dos confirmaciones concurrentes no sobre-venden y un código de recojo solo descuenta una vez", async () => {
  const fixture = await createInventoryFixture({ initialStock: 1 });
  const actors = [createActor("requester-a"), createActor("requester-b")];
  const drafts = await Promise.all(actors.map((actorId) => createAidActionDraft({
    fixture,
    actorId,
    requestedQuantity: 1,
    reserveQuantity: 1,
    expectedAvailable: 1,
  })));
  const results = await Promise.all(drafts.map((draft, index) => executeConfirmedAction(draft.draftId, actors[index])));
  const winners = results.filter((result) => result.status === "COMPLETED" && result.actionType === "AID_REQUEST");
  const stale = results.filter((result) => result.status === "STALE");
  assert.equal(winners.length, 1);
  assert.equal(stale.length, 1);
  const winnerIndex = results.findIndex((result) => result.status === "COMPLETED");
  const winner = results[winnerIndex];
  if (winner.status !== "COMPLETED" || winner.actionType !== "AID_REQUEST") assert.fail("No se pudo identificar la reserva ganadora.");
  const reservation = await getReservationForRequest(winner.requestId);
  assert.equal(reservation.quantity, 1);

  const afterReservation = await readInventorySnapshot(fixture, actors);
  assert.equal(afterReservation.onHand, 1);
  assert.equal(afterReservation.available, 0);
  assert.equal(afterReservation.requests, 1);
  assert.equal(afterReservation.commitments, 1);

  await assert.rejects(
    recordPhysicalPickup(fixture.managerId, reservation.id, "00000000"),
    (error: unknown) => error instanceof ManagerOperationError && error.status === 409,
  );
  const pickupAttempts = await Promise.allSettled([
    recordPhysicalPickup(fixture.managerId, reservation.id, winner.reservations[0].pickupCode),
    recordPhysicalPickup(fixture.managerId, reservation.id, winner.reservations[0].pickupCode),
  ]);
  assert.equal(pickupAttempts.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(pickupAttempts.filter((entry) => entry.status === "rejected").length, 1);
  await assert.rejects(
    recordPhysicalPickup(fixture.managerId, reservation.id, winner.reservations[0].pickupCode),
    (error: unknown) => error instanceof ManagerOperationError && error.status === 409,
  );

  const afterPickup = await readInventorySnapshot(fixture, actors);
  assert.equal(afterPickup.onHand, 0);
  assert.equal(afterPickup.available, 0);
  assert.equal(afterPickup.movements, 1);
  assert.equal(afterPickup.outbox, 1);
});

test("la cola serializa por FIFO, vence apartados a los 30 minutos y devuelve el no-show al final", async () => {
  const fixture = await createInventoryFixture();
  const firstRequester = createActor("fifo-first");
  const secondRequester = createActor("fifo-second");
  const firstDraft = await createAidActionDraft({ fixture, actorId: firstRequester, requestedQuantity: 1, reserveQuantity: 0, expectedAvailable: 0 });
  const secondDraft = await createAidActionDraft({ fixture, actorId: secondRequester, requestedQuantity: 1, reserveQuantity: 0, expectedAvailable: 0 });
  const firstRequest = await executeConfirmedAction(firstDraft.draftId, firstRequester);
  const secondRequest = await executeConfirmedAction(secondDraft.draftId, secondRequester);
  if (firstRequest.status !== "COMPLETED" || firstRequest.actionType !== "AID_REQUEST" ||
      secondRequest.status !== "COMPLETED" || secondRequest.actionType !== "AID_REQUEST") assert.fail("No se registraron las dos solicitudes FIFO.");

  const donor = createActor("fifo-donor");
  const donation = await createDonationActionDraft({ fixture, actorId: donor, quantity: 1 });
  const manifest = await executeConfirmedAction(donation.draftId, donor);
  if (manifest.status !== "COMPLETED" || manifest.actionType !== "DONATION_MANIFEST") assert.fail("No se creó el manifiesto para reponer stock.");
  const lineId = await getManifestLineId(manifest.manifestId);
  await validateDonationManifest(fixture.managerId, manifest.manifestId, [{ lineId, acceptedQuantity: 1 }]);

  const firstOffer = await getReservationForRequest(firstRequest.requestId);
  assert.equal(firstOffer.status, "PENDING_CONFIRMATION");
  assert.equal(firstOffer.pickupCode, null);
  assert.ok(firstOffer.holdSeconds >= 1_799 && firstOffer.holdSeconds <= 1_801, `El apartado debería durar 30 minutos; observado: ${firstOffer.holdSeconds}s.`);
  const firstOutbox = await withTransaction((client) => client.query<{ channel: string; event_type: string }>(
    `SELECT channel, event_type FROM grn_notification_outbox
      WHERE recipient_user_id = $1 AND event_type = 'FIFO_OFFER_CREATED'`,
    [firstRequester],
  ));
  assert.deepEqual(firstOutbox.rows.map((row) => [row.channel, row.event_type]), [["WEB", "FIFO_OFFER_CREATED"]]);

  await expireCommitment(firstOffer.id);
  const afterFirstExpiry = await processManagerQueue(fixture.managerId, fixture.pointId, fixture.productId);
  assert.equal(afterFirstExpiry.offers, 1);
  const secondOffer = await getReservationForRequest(secondRequest.requestId);
  assert.equal(secondOffer.status, "PENDING_CONFIRMATION");
  const requeuedFirst = await getWaitingEntryForRequest(firstRequest.requestId);
  const secondWaitlist = await getWaitingEntryForRequest(secondRequest.requestId);
  assert.ok(Number(requeuedFirst.fifo_sequence) > Number(secondWaitlist.fifo_sequence), "El primer apartado vencido debe volver al final de la cola.");

  const confirmationDraft = await createWaitlistConfirmationDraft({
    fixture,
    actorId: secondRequester,
    reservationId: secondOffer.id,
  });
  const confirmation = await executeConfirmedAction(confirmationDraft.draftId, secondRequester);
  if (confirmation.status !== "COMPLETED" || confirmation.actionType !== "WAITLIST_CONFIRMATION") assert.fail("No se confirmó la propuesta FIFO.");
  assert.equal(confirmation.pickupCode.length, 8);
  const active = await getReservationForRequest(secondRequest.requestId);
  assert.equal(active.status, "ACTIVE");
  assert.notEqual(active.pickupCode, null);
  const localExpiry = await withTransaction((client) => client.query<{ expiry_time: string; closing_time: string }>(
    `SELECT to_char(r.expires_at AT TIME ZONE cp.timezone, 'HH24:MI') AS expiry_time,
            to_char(h.closes_at, 'HH24:MI') AS closing_time
       FROM grn_reservation_commitments r
       JOIN grn_collection_points cp ON cp.id = r.collection_point_id
       JOIN grn_collection_point_hours h ON h.collection_point_id = cp.id
        AND h.weekday = EXTRACT(DOW FROM transaction_timestamp() AT TIME ZONE cp.timezone)::int
      WHERE r.id = $1`,
    [active.id],
  ));
  assert.equal(localExpiry.rows[0]?.expiry_time, localExpiry.rows[0]?.closing_time);

  await expireCommitment(active.id);
  const afterNoShow = await processManagerQueue(fixture.managerId, fixture.pointId, fixture.productId);
  assert.equal(afterNoShow.offers, 1);
  const firstNextOffer = await getReservationForRequest(firstRequest.requestId);
  assert.equal(firstNextOffer.status, "PENDING_CONFIRMATION");
  const requeuedSecond = await getWaitingEntryForRequest(secondRequest.requestId);
  const offeredFirst = await getWaitingEntryForRequest(firstRequest.requestId);
  assert.ok(Number(requeuedSecond.fifo_sequence) > Number(offeredFirst.fifo_sequence), "El no-show también debe volver al final de la cola.");
  const state = await readInventorySnapshot(fixture, [firstRequester, secondRequester]);
  assert.equal(state.onHand, 1);
  assert.equal(state.available, 0);
  assert.equal(state.outbox, 3);
});

test("el corte antes del cierre detiene nuevas propuestas y las lecturas no mutan el inventario", async () => {
  const fixture = await createInventoryFixture();
  const requester = createActor("cutoff-requester");
  const requestDraft = await createAidActionDraft({ fixture, actorId: requester, requestedQuantity: 1, reserveQuantity: 0, expectedAvailable: 0 });
  const request = await executeConfirmedAction(requestDraft.draftId, requester);
  if (request.status !== "COMPLETED" || request.actionType !== "AID_REQUEST") assert.fail("La solicitud de prueba no quedó en espera.");

  const donor = createActor("cutoff-donor");
  const donation = await createDonationActionDraft({ fixture, actorId: donor, quantity: 1 });
  const manifest = await executeConfirmedAction(donation.draftId, donor);
  if (manifest.status !== "COMPLETED" || manifest.actionType !== "DONATION_MANIFEST") assert.fail("No se creó el manifiesto de prueba.");
  await setClosingInMinutes(fixture, 30);
  const lineId = await getManifestLineId(manifest.manifestId);
  await validateDonationManifest(fixture.managerId, manifest.manifestId, [{ lineId, acceptedQuantity: 1 }]);

  const cutoff = await readInventorySnapshot(fixture, [requester]);
  assert.equal(cutoff.onHand, 1);
  assert.equal(cutoff.available, 1);
  assert.equal(cutoff.commitments, 0);
  assert.equal(cutoff.waitingEntries, 1);

  await assert.rejects(
    processManagerQueue(createActor("not-manager"), fixture.pointId, fixture.productId),
    (error: unknown) => error instanceof ManagerOperationError && error.status === 403,
  );
  const beforeReads = await readInventorySnapshot(fixture, [requester]);
  await listManagedPoints(fixture.managerId);
  await listActiveReservations(fixture.managerId);
  await listPendingManifests(fixture.managerId);
  const afterReads = await readInventorySnapshot(fixture, [requester]);
  assert.deepEqual(afterReads, beforeReads, "Las lecturas de panel no deben cambiar el estado persistido.");
});

async function getManifestLineId(manifestId: string) {
  const result = await withTransaction((client) => client.query<{ id: string }>(
    "SELECT id FROM grn_donation_manifest_lines WHERE manifest_id = $1",
    [manifestId],
  ));
  assert.equal(result.rows.length, 1);
  return result.rows[0].id;
}

async function getReservationForRequest(requestId: string) {
  const result = await withTransaction((client) => client.query<{
    id: string;
    status: string;
    quantity: number;
    pickup_code: string | null;
    hold_seconds: number;
  }>(
    `SELECT r.id, r.status, r.quantity, r.pickup_code,
            EXTRACT(EPOCH FROM (r.expires_at - r.created_at))::int AS hold_seconds
       FROM grn_reservation_commitments r
       JOIN grn_aid_request_items i ON i.id = r.request_item_id
      WHERE i.request_id = $1
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT 1`,
    [requestId],
  ));
  assert.ok(result.rows[0], `No existe una reserva para solicitud ${requestId}.`);
  return {
    id: result.rows[0].id,
    status: result.rows[0].status,
    quantity: Number(result.rows[0].quantity),
    pickupCode: result.rows[0].pickup_code,
    holdSeconds: Number(result.rows[0].hold_seconds),
  };
}

async function getWaitingEntryForRequest(requestId: string) {
  const result = await withTransaction((client) => client.query<{ id: string; status: string; fifo_sequence: string }>(
    `SELECT id, status, fifo_sequence::text
       FROM grn_waitlist_entries
      WHERE request_item_id IN (SELECT id FROM grn_aid_request_items WHERE request_id = $1)
      ORDER BY fifo_sequence DESC LIMIT 1`,
    [requestId],
  ));
  assert.ok(result.rows[0], `No existe una entrada FIFO para solicitud ${requestId}.`);
  return result.rows[0];
}

async function expireCommitment(reservationId: string) {
  await withTransaction((client) => client.query(
    `UPDATE grn_reservation_commitments
        SET expires_at = transaction_timestamp() - interval '1 second'
      WHERE id = $1`,
    [reservationId],
  ).then(() => undefined));
}
