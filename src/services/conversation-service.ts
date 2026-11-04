import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type {
  CollectionPointRecommendation,
  ConversationInput,
  ConversationMissingField,
  ConversationOutput,
  ConversationState,
  ProductLineDraft,
} from "@/domain/types";
import { queryRows } from "@/core/server/db";
import { getOwnedPrivateMedia } from "@/repositories/private-media-repository";
import { cancelPendingActionDrafts, createActionDraft, markActionDraftStale } from "@/services/action-drafts";
import { executeConfirmedAction } from "@/services/action-execution";
import { getActiveCatalog, resolveCatalogItems, suggestForHousehold } from "@/services/catalog-service";
import type { CollectionPointReadService, ConversationContextRepository, ConversationService, StructuredTurnExtractor } from "@/services/contracts";
import type { AidDraftPayload, ManifestDraftPayload, WaitlistConfirmationDraftPayload } from "@/services/action-execution";
import { findPendingWaitlistOffer } from "@/services/queue-service";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validCoordinates(location: ConversationInput["location"]) {
  return location && Number.isFinite(location.latitude) && Number.isFinite(location.longitude) &&
    Math.abs(location.latitude) <= 90 && Math.abs(location.longitude) <= 180
    ? location
    : undefined;
}

function missingSlots(state: ConversationState): ConversationMissingField[] {
  const missing: ConversationMissingField[] = [];
  if (!state.intent) return ["intent"];
  if (state.pendingWaitlistReservationId) {
    if (!state.availabilityWindow) missing.push("availability_window");
    return missing;
  }
  if (!state.items?.length) missing.push("products");
  if (!state.zone) missing.push("zone");
  if (state.intent === "REQUEST_AID") {
    if (!state.mobility) missing.push("mobility");
    if (!state.availabilityWindow) missing.push("availability_window");
  } else {
    if (!state.donorPreference) missing.push("donor_preference");
    if (state.itemsPreSorted !== true) missing.push("pre_sorted");
    if (!state.estimatedDeliveryTime) missing.push("estimated_delivery_time");
    if (!state.photoMediaIds?.length) missing.push("photos");
  }
  return missing;
}

function followUp(missing: ConversationMissingField[], state: ConversationState, suggested?: Array<{ productName: string; quantity: number; unit: string }>) {
  if (missing.includes("intent")) return "¿Quieres donar productos o solicitar ayuda? Puedo orientarte con los puntos cercanos.";
  const parts: string[] = [];
  if (missing.includes("products")) {
    if (state.intent === "REQUEST_AID" && state.householdSize && suggested?.length) {
      parts.push(`Para un hogar de ${state.householdSize}, el catálogo sugiere como referencia ${suggested.map((item) => `${item.quantity} ${item.unit} de ${item.productName}`).join(", ")}. ¿Qué productos y cantidades quieres pedir?`);
    } else if (state.intent === "REQUEST_AID") {
      parts.push("¿Qué productos y cantidades necesitas? Si prefieres, dime cuántas personas viven en tu hogar y te muestro sugerencias del catálogo; tú eliges qué pedir.");
    } else {
      parts.push("¿Qué productos ya separados vas a donar y en qué cantidades?");
    }
  }
  if (missing.includes("zone")) parts.push("¿En qué barrio o distrito estás? Puedes compartir una ubicación aproximada o un pin para calcular distancia.");
  if (missing.includes("mobility")) parts.push("¿Solo puedes acercarte a un punto cercano o puedes desplazarte a otros puntos?");
  if (missing.includes("availability_window")) parts.push("¿En qué horario de hoy podrías recoger? Indica una ventana, por ejemplo 15:00–17:00.");
  if (missing.includes("donor_preference")) parts.push("¿Prefieres el punto más cercano o el punto con mayor déficit para esos productos?");
  if (missing.includes("pre_sorted")) parts.push("Antes de generar el manifiesto, confirma que llevarás los productos separados y listos para cotejo.");
  if (missing.includes("estimated_delivery_time")) parts.push("¿A qué hora estimas entregar hoy? Es una referencia para distribuir las llegadas; puedes acercarte en cualquier momento mientras el punto esté abierto.");
  if (missing.includes("photos")) parts.push("Adjunta una foto privada por cada producto que vas a entregar; se usará solo como evidencia para el encargado.");
  return parts.join(" ");
}

function normalized(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
}

function attachPhotos(items: ProductLineDraft[], mediaIds: string[]) {
  if (items.length === 1) return [{ ...items[0], photoMediaIds: [...mediaIds] }];
  return items.map((item, index) => ({ ...item, photoMediaIds: mediaIds[index] ? [mediaIds[index]] : [] }));
}

function humanDistance(point: CollectionPointRecommendation) {
  return point.distanceKm === null ? "distancia no calculable sin pin" : `${point.distanceKm.toFixed(1)} km en distancia directa`;
}

export class NeonConversationService implements ConversationService {
  constructor(
    private readonly extractor: StructuredTurnExtractor,
    private readonly contexts: ConversationContextRepository,
    private readonly points: CollectionPointReadService,
  ) {}

  async respond(input: ConversationInput): Promise<ConversationOutput> {
    if (!uuidPattern.test(input.conversationId)) {
      return { conversationId: input.conversationId, phase: "ERROR", text: "No pude iniciar esta conversación. Actualiza la página y vuelve a intentarlo." };
    }
    if (input.confirmationDraftId) return this.confirm(input);
    if (!input.text?.trim() && !input.audio && !input.photoMediaIds?.length) {
      return { conversationId: input.conversationId, phase: "CAPTURING", text: "Escribe un mensaje o envía una nota de voz para comenzar." };
    }

    const prior = await this.contexts.load(input.conversationId, input.actorId);
    let state: ConversationState = prior ?? {};
    if (!prior && input.actorId) {
      const pendingOffer = await findPendingWaitlistOffer(input.actorId);
      if (pendingOffer) {
        state = {
          intent: "REQUEST_AID",
          items: [{ productName: pendingOffer.product_name, quantity: Number(pendingOffer.quantity) }],
          zone: pendingOffer.zone,
          mobility: pendingOffer.mobility,
          pendingWaitlistReservationId: pendingOffer.id,
        };
      }
    }
    const incomingMedia = input.actorId && input.photoMediaIds?.length
      ? await getOwnedPrivateMedia(input.actorId, input.photoMediaIds)
      : [];
    if (input.photoMediaIds?.length && incomingMedia.length !== new Set(input.photoMediaIds).size) {
      return { conversationId: input.conversationId, phase: "ERROR", text: "No pude validar una de las fotos privadas. Vuelve a adjuntarla." };
    }
    const allMediaIds = [...new Set([...(state.photoMediaIds ?? []), ...incomingMedia.map((media) => media.id)])];
    const baseState: ConversationState = {
      ...state,
      photoMediaIds: allMediaIds,
    };

    let extracted: ConversationState & { cancel?: boolean };
    try {
      extracted = await this.extractor.extract({
        text: input.text,
        audio: input.audio,
        state: baseState,
        photoAttached: allMediaIds.length > 0,
      });
    } catch (error) {
      const audioOnly = Boolean(input.audio && !input.text?.trim());
      return {
        conversationId: input.conversationId,
        phase: "CAPTURING",
        text: audioOnly
          ? "No pude entender esa nota de voz. Envíala en MP3 o WAV, o escríbeme el mensaje."
          : "No pude procesar el mensaje ahora. Inténtalo de nuevo; no se registró ninguna solicitud ni manifiesto.",
      };
    }

    if (extracted.cancel) {
      await this.contexts.delete(input.conversationId, input.actorId);
      if (input.actorId) await cancelPendingActionDrafts(input.conversationId, input.actorId);
      return { conversationId: input.conversationId, phase: "COMPLETED", text: "Listo, cerré este flujo. No se creó ninguna solicitud ni manifiesto." };
    }

    if (state.intent && extracted.intent && state.intent !== extracted.intent) {
      if (input.actorId) await cancelPendingActionDrafts(input.conversationId, input.actorId);
      await this.contexts.delete(input.conversationId, input.actorId);
      state = {
        intent: extracted.intent,
        draftGroupId: randomUUID(),
        photoMediaIds: extracted.intent === "DONATE" ? incomingMedia.map((media) => media.id) : [],
      };
      await this.contexts.save(input.conversationId, input.channel, state, input.actorId);
      const missing = missingSlots(state);
      return {
        conversationId: input.conversationId,
        phase: "CAPTURING",
        text: `Cambié el flujo a ${state.intent === "DONATE" ? "donación" : "solicitud de ayuda"}. ${followUp(missing, state)}`,
        missingFields: missing,
      };
    }

    state = {
      ...baseState,
      ...extracted,
      photoMediaIds: allMediaIds,
      draftGroupId: state.draftGroupId,
    };
    if (state.intent === "DONATE" && state.items?.length && allMediaIds.length) {
      state.items = attachPhotos(state.items, allMediaIds);
    }
    await this.contexts.save(input.conversationId, input.channel, state, input.actorId);

    const missing = missingSlots(state);
    if (missing.length) {
      const catalog = state.intent === "REQUEST_AID" && state.householdSize && !state.items?.length
        ? await getActiveCatalog()
        : [];
      const suggestions = state.householdSize ? suggestForHousehold(catalog, state.householdSize) : [];
      return {
        conversationId: input.conversationId,
        phase: "CAPTURING",
        text: followUp(missing, state, suggestions),
        missingFields: missing,
        audioTranscribed: Boolean(input.audio),
      };
    }
    return this.buildPreview(input, state);
  }

  private async confirm(input: ConversationInput): Promise<ConversationOutput> {
    if (!input.actorId) {
      return { conversationId: input.conversationId, phase: "NEEDS_AUTH", text: "Inicia sesión con Google para confirmar esta acción." };
    }
    const token = input.confirmationDraftId!;
    const result = await executeConfirmedAction(token, input.actorId);
    if (result.status === "NOT_FOUND" || result.status === "ALREADY_USED") {
      return { conversationId: input.conversationId, phase: "ERROR", text: "Este borrador no existe, ya se usó o pertenece a otra sesión. No hice cambios." };
    }
    if (result.status === "EXPIRED") {
      return { conversationId: input.conversationId, phase: "CAPTURING", text: "El borrador venció después de 30 minutos. Vuelve a revisar la disponibilidad para crear uno nuevo." };
    }
    if (result.status === "STALE") {
      await markActionDraftStale(token, input.actorId);
      const state = await this.contexts.load(input.conversationId, input.actorId);
      if (state && result.actionType === "WAITLIST_CONFIRMATION") {
        const refreshed: ConversationState = { ...state, availabilityWindow: undefined };
        await this.contexts.save(input.conversationId, input.channel, refreshed, input.actorId);
        return {
          conversationId: input.conversationId,
          phase: "CAPTURING",
          missingFields: ["availability_window"],
          text: "Cambió la disponibilidad del punto o el apartado está por vencer. Indica otra ventana de recojo de hoy; volveré a comprobar el turno antes de pedirte confirmación.",
          notificationOutboxIds: result.notificationOutboxIds,
        };
      }
      if (state) return { ...await this.buildPreview(input, state), notificationOutboxIds: result.notificationOutboxIds };
      return { conversationId: input.conversationId, phase: "CAPTURING", text: "La disponibilidad cambió. Vuelve a enviar los datos para revisar un nuevo resumen.", notificationOutboxIds: result.notificationOutboxIds };
    }
    if (result.status !== "COMPLETED") {
      return { conversationId: input.conversationId, phase: "ERROR", text: "No pude confirmar el borrador. No se registró ninguna acción." };
    }
    if (result.actionType === "AID_REQUEST") {
      const reserved = result.reservations.map((item) => `${item.quantity} ${item.productName} (código ${item.pickupCode})`).join(", ");
      const waiting = result.waiting.map((item) => `${item.quantity} ${item.productName}`).join(", ");
      const pieces = ["Solicitud registrada una sola vez."];
      if (reserved) pieces.push(`Reserva activa para recoger hoy: ${reserved}.`);
      if (waiting) pieces.push(`En cola FIFO, sin fecha prometida: ${waiting}.`);
      if (!reserved && !waiting) pieces.push("No se generaron unidades reservadas ni pendientes.");
      return { conversationId: input.conversationId, phase: "COMPLETED", text: pieces.join(" "), notificationOutboxIds: result.notificationOutboxIds };
    }
    if (result.actionType === "WAITLIST_CONFIRMATION") {
      return {
        conversationId: input.conversationId,
        phase: "COMPLETED",
        text: `Turno confirmado: ${result.quantity} ${result.productName}. Tu código de recojo es ${result.pickupCode}; la reserva dura hasta el cierre de hoy.`,
        notificationOutboxIds: result.notificationOutboxIds,
      };
    }
    return {
      conversationId: input.conversationId,
      phase: "COMPLETED",
      text: `Manifiesto ${result.code} creado como pendiente. El punto debe cotejar los productos físicamente; el stock no cambia hasta esa validación.`,
      notificationOutboxIds: result.notificationOutboxIds,
    };
  }

  private async buildPreview(input: ConversationInput, state: ConversationState): Promise<ConversationOutput> {
    if (state.pendingWaitlistReservationId) {
      if (!input.actorId || !state.availabilityWindow) {
        return { conversationId: input.conversationId, phase: "CAPTURING", text: "¿En qué horario de hoy puedes recoger lo que se te ofreció?" };
      }
      const offer = await findPendingWaitlistOffer(input.actorId);
      if (!offer || offer.id !== state.pendingWaitlistReservationId) {
        return { conversationId: input.conversationId, phase: "CAPTURING", text: "Ese apartado venció o dejó de estar disponible. Vuelve a consultar tu solicitud; no se creó una reserva." };
      }
      const payload: WaitlistConfirmationDraftPayload = {
        reservationId: offer.id,
        availabilityWindow: state.availabilityWindow,
      };
      const idempotencyKey = createHash("sha256")
        .update(`${input.actorId}:${offer.id}:${state.availabilityWindow.start}:${state.availabilityWindow.end}`)
        .digest("hex");
      const summary = `${offer.quantity} ${offer.product_name} en ${offer.point_name}. Disponible para recoger hoy entre ${state.availabilityWindow.start} y ${state.availabilityWindow.end}; el apartado temporal vence ${new Date(offer.expires_at).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", timeZone: "America/Lima" })}. Al confirmar se generará un código y la reserva durará hasta el cierre del punto.`;
      await cancelPendingActionDrafts(input.conversationId, input.actorId);
      const draft = await createActionDraft({
        actorId: input.actorId,
        conversationId: input.conversationId,
        actionType: "WAITLIST_CONFIRMATION",
        idempotencyKey,
        payload,
        preview: { summary },
      });
      return {
        conversationId: input.conversationId,
        phase: "PREVIEW",
        text: "La cola FIFO apartó unidades temporalmente. Revisa el punto y el horario y confirma antes de que venza el apartado.",
        actionOptions: [{ draftId: draft.draftId, label: "Confirmar turno", summary }],
      };
    }
    if (!state.intent || !state.items?.length || !state.zone) {
      return { conversationId: input.conversationId, phase: "CAPTURING", text: followUp(missingSlots(state), state) };
    }

    const resolved = await resolveCatalogItems(state.items);
    const unresolved = resolved.filter((entry) => !entry);
    if (unresolved.length) {
      const catalog = await getActiveCatalog();
      const unresolvedNames = resolved.flatMap((entry, index) => entry ? [] : [state.items![index].productName]);
      const names = catalog.map((product) => product.name).join(", ");
      return {
        conversationId: input.conversationId,
        phase: "CAPTURING",
        missingFields: ["products"],
        text: names
          ? `No encontré ${unresolvedNames.join(", ")} en el catálogo habilitado. Elige productos de este catálogo: ${names}.`
          : "El catálogo de productos aún no está configurado en este entorno. No puedo crear una solicitud ni un manifiesto todavía.",
      };
    }
    let items = resolved.map((entry) => ({ productId: entry!.product.id, productName: entry!.product.name, quantity: entry!.quantity }));
    if (state.intent === "REQUEST_AID") {
      const combined = new Map<string, (typeof items)[number]>();
      for (const item of items) {
        const existing = combined.get(item.productId);
        if (existing) existing.quantity += item.quantity;
        else combined.set(item.productId, { ...item });
      }
      items = [...combined.values()];
    }
    const inputOrigin = validCoordinates(input.location);
    const mode = state.intent === "DONATE" ? "DONOR" : "AID_SEEKER";
    const recommendations = await this.points.recommend({
      zone: state.zone,
      origin: inputOrigin,
      items,
      mode,
      mobility: state.mobility,
      preference: state.donorPreference,
      availabilityWindow: state.availabilityWindow,
      estimatedDeliveryTime: state.estimatedDeliveryTime,
    });
    const point = recommendations[0];
    if (!point) {
      const locationHint = inputOrigin ? "No encontré un punto activo que acepte esos productos, esté abierto y tenga capacidad para ese horario." : "No encontré un punto activo y compatible en esa zona y horario. Si puedes, comparte un pin de ubicación o elige que puedes desplazarte a otros puntos.";
      return { conversationId: input.conversationId, phase: "CAPTURING", text: `${locationHint} No crearé una solicitud ni un manifiesto hasta que tengamos un punto adecuado.` };
    }
    const productRows = point.products;
    const capExceeded = productRows.find((row) => row.requestedQuantity > row.maxPerRequest);
    if (capExceeded && state.intent === "REQUEST_AID") {
      return { conversationId: input.conversationId, phase: "CAPTURING", text: `El límite configurado para ${capExceeded.productName} en este punto es ${capExceeded.maxPerRequest}. Ajusta esa cantidad y la vuelvo a revisar.` };
    }

    if (state.intent === "REQUEST_AID") {
      const partialAvailability = productRows.filter((row) =>
        row.queuedRequestCount === 0 && row.availableQuantity > 0 && row.availableQuantity < row.requestedQuantity,
      );
      if (partialAvailability.length > 0) {
        const limits = partialAvailability
          .map((row) => `${row.productName}: hay ${row.availableQuantity} de ${row.requestedQuantity} solicitadas`)
          .join("; ");
        return {
          conversationId: input.conversationId,
          phase: "CAPTURING",
          missingFields: ["products"],
          text: `En ${point.name}, ${limits}. No dividiré una misma solicitud entre reserva y cola. Ajusta cada cantidad al stock disponible para solicitarla ahora; si después necesitas el resto, envía otra solicitud separada y recibirá su propio turno FIFO. Todavía no se registró ninguna demanda.`,
          recommendation: point,
        };
      }
      const canReserveNow = point.pickupCapacityAvailable;
      const primary = productRows.map((row) => ({
        productId: row.productId,
        productName: row.productName,
        requestedQuantity: row.requestedQuantity,
        reserveQuantity: canReserveNow && row.queuedRequestCount === 0 && row.availableQuantity >= row.requestedQuantity
          ? row.requestedQuantity
          : 0,
        expectedAvailable: row.availableQuantity,
      }));
      const base = {
        channel: input.channel,
        pointId: point.id,
        zone: state.zone,
        mobility: state.mobility!,
        availabilityWindow: state.availabilityWindow!,
      } as const;
      const immediateSummary = primary
        .map((item) => item.reserveQuantity > 0
          ? `${item.requestedQuantity} ${item.productName} para recoger hoy`
          : `${item.requestedQuantity} ${item.productName} en cola FIFO, sin fecha prometida${productRows.find((row) => row.productId === item.productId)?.queuedRequestCount ? ", detrás de solicitudes anteriores" : ""}`)
        .join("; ");
      const summary = `${point.name} (${humanDistance(point)}): ${immediateSummary}. Ventana de recojo: ${state.availabilityWindow!.start}–${state.availabilityWindow!.end}. Cada producto se reserva completo o espera completo.`;
      if (!input.actorId) {
        return {
          conversationId: input.conversationId,
          phase: "NEEDS_AUTH",
          text: `Recomendación: ${point.name}, ${point.neighborhood}, ${humanDistance(point)}. ${point.reasons.join("; ")}. ${summary} Inicia sesión con Google para confirmar y registrar la solicitud.`,
          recommendation: point,
        };
      }
      state.draftGroupId ??= randomUUID();
      await this.contexts.save(input.conversationId, input.channel, state, input.actorId);
      const submissionIdentity = {
        pointId: point.id,
        zone: state.zone,
        mobility: state.mobility,
        availabilityWindow: state.availabilityWindow,
        items: primary.map(({ productId, requestedQuantity }) => ({ productId, requestedQuantity })),
      };
      const idempotencyKey = createHash("sha256")
        .update(`${input.actorId}:${input.conversationId}:${state.draftGroupId}:aid:${JSON.stringify(submissionIdentity)}`)
        .digest("hex");
      await cancelPendingActionDrafts(input.conversationId, input.actorId);
      const draft = await createActionDraft({
        actorId: input.actorId,
        conversationId: input.conversationId,
        actionType: "AID_REQUEST",
        idempotencyKey,
        payload: { ...base, items: primary },
        preview: { summary },
      });
      return {
        conversationId: input.conversationId,
        phase: "PREVIEW",
        text: `La recomendación es ${point.name}, ${point.neighborhood}: ${point.reasons.join("; ")}. Revisa la solicitud y confirma; la disponibilidad y el turno FIFO se volverán a comprobar al confirmar.`,
        recommendation: point,
        actionOptions: [{ draftId: draft.draftId, label: "Confirmar solicitud", summary }],
      };
    }

    if (!input.actorId) {
      return {
        conversationId: input.conversationId,
        phase: "NEEDS_AUTH",
        text: `El punto recomendado es ${point.name}, ${point.neighborhood}, ${humanDistance(point)}: ${point.reasons.join("; ")}. Inicia sesión con Google para generar y confirmar el manifiesto.`,
        recommendation: point,
      };
    }
    const mediaIds = state.photoMediaIds ?? [];
    const ownedMedia = await getOwnedPrivateMedia(input.actorId, mediaIds);
    if (ownedMedia.length < items.length) {
      return {
        conversationId: input.conversationId,
        phase: "CAPTURING",
        missingFields: ["photos"],
        text: `Adjunta al menos una foto privada por cada producto. En tu mensaje hay ${items.length} productos y el sistema verificó ${ownedMedia.length} fotos. Las fotos no se procesan con IA.`,
        recommendation: point,
      };
    }
    const photosByItem = attachPhotos(state.items, mediaIds);
    const instantRows = await queryRows<{ estimated_at: string }>(
      `SELECT (((transaction_timestamp() AT TIME ZONE timezone)::date + $2::time) AT TIME ZONE timezone)::text AS estimated_at
         FROM grn_collection_points WHERE id = $1`,
      [point.id, state.estimatedDeliveryTime],
    );
    const estimatedDeliveryAt = instantRows[0]?.estimated_at;
    if (!estimatedDeliveryAt) return { conversationId: input.conversationId, phase: "ERROR", text: "No pude calcular la hora del punto. No se creó ningún manifiesto." };
    const manifestItems = items.map((item, index) => ({
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      photoMediaIds: photosByItem[index]?.photoMediaIds ?? [],
    }));
    const payload: ManifestDraftPayload = {
      channel: input.channel,
      pointId: point.id,
      zone: state.zone,
      estimatedDeliveryAt,
      items: manifestItems,
    };
    const summary = `${point.name}, ${point.neighborhood}, ${humanDistance(point)}. Hora orientativa de llegada: ${state.estimatedDeliveryTime}; puedes entregar en cualquier momento dentro del horario de atención de hoy. ${manifestItems.map((item) => `${item.quantity} ${item.productName} con foto`).join("; ")}. Llegar con todo separado. El manifiesto cuenta como suministro esperado hasta el cierre local, pero el stock solo se incrementará cuando el encargado coteje y valide físicamente la entrega.`;
    if (!state.draftGroupId) state.draftGroupId = randomUUID();
    await this.contexts.save(input.conversationId, input.channel, state, input.actorId);
    const idempotencyKey = createHash("sha256")
      .update(`${input.actorId}:${input.conversationId}:${state.draftGroupId}:manifest:${JSON.stringify(payload)}`)
      .digest("hex");
    await cancelPendingActionDrafts(input.conversationId, input.actorId);
    const draft = await createActionDraft({
      actorId: input.actorId,
      conversationId: input.conversationId,
      actionType: "DONATION_MANIFEST",
      idempotencyKey,
      payload,
      preview: { summary },
    });
    return {
      conversationId: input.conversationId,
      phase: "PREVIEW",
      text: `Recomendación: ${point.name}, ${point.neighborhood}, ${point.reasons.join("; ")}. Revisa el manifiesto antes de confirmar.`,
      recommendation: point,
      actionOptions: [{ draftId: draft.draftId, label: "Confirmar manifiesto", summary }],
    };
  }
}

