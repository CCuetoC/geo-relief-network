import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type {
  CollectionPointRecommendation,
  ConversationInput,
  ConversationMissingField,
  ConversationOutput,
  ConversationState,
  Locale,
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
import { DEFAULT_LOCALE, formatTime } from "@/i18n/locale";
import { translate } from "@/i18n/messages";

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

function followUp(missing: ConversationMissingField[], state: ConversationState, locale: Locale, suggested?: Array<{ productName: string; quantity: number; unit: string }>) {
  if (missing.includes("intent")) return translate(locale, "conversation.askIntent");
  const parts: string[] = [];
  if (missing.includes("products")) {
    if (state.intent === "REQUEST_AID" && state.householdSize && suggested?.length) {
      parts.push(translate(locale, "conversation.householdSuggestion", {
        size: state.householdSize,
        items: suggested.map((item) => `${number(locale, item.quantity)} ${item.unit} ${locale === "en" ? "of" : "de"} ${item.productName}`).join(", "),
      }));
    } else if (state.intent === "REQUEST_AID") {
      parts.push(translate(locale, "conversation.askRequestProducts"));
    } else {
      parts.push(translate(locale, "conversation.askDonationProducts"));
    }
  }
  if (missing.includes("zone")) parts.push(translate(locale, "conversation.askZone"));
  if (missing.includes("mobility")) parts.push(translate(locale, "conversation.askMobility"));
  if (missing.includes("availability_window")) parts.push(translate(locale, "conversation.askAvailability"));
  if (missing.includes("donor_preference")) parts.push(translate(locale, "conversation.askDonorPreference"));
  if (missing.includes("pre_sorted")) parts.push(translate(locale, "conversation.askPreSorted"));
  if (missing.includes("estimated_delivery_time")) parts.push(translate(locale, "conversation.askEstimatedDelivery"));
  if (missing.includes("photos")) parts.push(translate(locale, "conversation.askPhotos"));
  return parts.join(" ");
}

function attachPhotos(items: ProductLineDraft[], mediaIds: string[]) {
  if (items.length === 1) return [{ ...items[0], photoMediaIds: [...mediaIds] }];
  return items.map((item, index) => ({ ...item, photoMediaIds: mediaIds[index] ? [mediaIds[index]] : [] }));
}

function number(locale: Locale, value: number) {
  return new Intl.NumberFormat(locale).format(value);
}

function humanDistance(point: CollectionPointRecommendation, locale: Locale) {
  return point.distanceKm === null
    ? translate(locale, "map.distanceNoPin")
    : translate(locale, "map.distance", { distance: new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(point.distanceKm) });
}

export class NeonConversationService implements ConversationService {
  constructor(
    private readonly extractor: StructuredTurnExtractor,
    private readonly contexts: ConversationContextRepository,
    private readonly points: CollectionPointReadService,
  ) {}

  async respond(input: ConversationInput): Promise<ConversationOutput> {
    const output = await this.respondInternal(input);
    const state = await this.contexts.load(input.conversationId, input.actorId).catch(() => null);
    return { ...output, locale: output.locale ?? state?.locale ?? input.locale ?? DEFAULT_LOCALE };
  }

  private async respondInternal(input: ConversationInput): Promise<ConversationOutput> {
    let locale = input.locale ?? DEFAULT_LOCALE;
    if (!uuidPattern.test(input.conversationId)) {
      return { conversationId: input.conversationId, locale, phase: "ERROR", text: translate(locale, "conversation.startError") };
    }
    if (input.confirmationDraftId) return this.confirm(input);
    if (!input.text?.trim() && !input.audio && !input.photoMediaIds?.length) {
      return { conversationId: input.conversationId, locale, phase: "CAPTURING", text: translate(locale, "conversation.startPrompt") };
    }

    const prior = await this.contexts.load(input.conversationId, input.actorId);
    locale = input.channel === "WEB" ? input.locale ?? prior?.locale ?? DEFAULT_LOCALE : input.locale ?? prior?.locale ?? DEFAULT_LOCALE;
    let state: ConversationState = prior ?? {};
    if (!prior && input.actorId) {
      const pendingOffer = await findPendingWaitlistOffer(input.actorId, locale);
      if (pendingOffer) {
        state = {
          locale,
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
      return { conversationId: input.conversationId, locale, phase: "ERROR", text: translate(locale, "conversation.photoError") };
    }
    const allMediaIds = [...new Set([...(state.photoMediaIds ?? []), ...incomingMedia.map((media) => media.id)])];
    const baseState: ConversationState = {
      ...state,
      locale,
      photoMediaIds: allMediaIds,
    };

    let extracted: ConversationState & { cancel?: boolean };
    try {
      const catalog = await getActiveCatalog(locale);
      extracted = await this.extractor.extract({
        text: input.text,
        audio: input.audio,
        state: baseState,
        photoAttached: allMediaIds.length > 0,
        locale,
        catalog: catalog.map((product) => ({ slug: product.slug, name: product.name, aliases: product.aliases })),
      });
      locale = input.channel === "WEB" ? input.locale ?? DEFAULT_LOCALE : extracted.locale ?? locale;
    } catch (error) {
      const audioOnly = Boolean(input.audio && !input.text?.trim());
      return {
        conversationId: input.conversationId,
        locale,
        phase: "CAPTURING",
        text: audioOnly
          ? translate(locale, "conversation.audioError")
          : translate(locale, "conversation.processingError"),
      };
    }

    if (extracted.cancel) {
      await this.contexts.delete(input.conversationId, input.actorId);
      if (input.actorId) await cancelPendingActionDrafts(input.conversationId, input.actorId);
      return { conversationId: input.conversationId, locale, phase: "COMPLETED", text: translate(locale, "conversation.cancelled") };
    }

    if (state.intent && extracted.intent && state.intent !== extracted.intent) {
      if (input.actorId) await cancelPendingActionDrafts(input.conversationId, input.actorId);
      await this.contexts.delete(input.conversationId, input.actorId);
      state = {
        locale,
        intent: extracted.intent,
        draftGroupId: randomUUID(),
        photoMediaIds: extracted.intent === "DONATE" ? incomingMedia.map((media) => media.id) : [],
      };
      await this.contexts.save(input.conversationId, input.channel, state, input.actorId);
      const missing = missingSlots(state);
      return {
        conversationId: input.conversationId,
        locale,
        phase: "CAPTURING",
        text: `${translate(locale, state.intent === "DONATE" ? "conversation.changedToDonation" : "conversation.changedToRequest")} ${followUp(missing, state, locale)}`,
        missingFields: missing,
      };
    }

    state = {
      ...baseState,
      ...extracted,
      locale,
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
        ? await getActiveCatalog(locale)
        : [];
      const suggestions = state.householdSize ? suggestForHousehold(catalog, state.householdSize) : [];
      return {
        conversationId: input.conversationId,
        locale,
        phase: "CAPTURING",
        text: followUp(missing, state, locale, suggestions),
        missingFields: missing,
        audioTranscribed: Boolean(input.audio),
      };
    }
    return this.buildPreview(input, state);
  }

  private async confirm(input: ConversationInput): Promise<ConversationOutput> {
    const locale = input.locale ?? (await this.contexts.load(input.conversationId, input.actorId))?.locale ?? DEFAULT_LOCALE;
    if (!input.actorId) {
      return { conversationId: input.conversationId, locale, phase: "NEEDS_AUTH", text: translate(locale, "conversation.login") };
    }
    const token = input.confirmationDraftId!;
    const result = await executeConfirmedAction(token, input.actorId);
    if (result.status === "NOT_FOUND" || result.status === "ALREADY_USED") {
      return { conversationId: input.conversationId, locale, phase: "ERROR", text: translate(locale, "conversation.draftInvalid") };
    }
    if (result.status === "EXPIRED") {
      return { conversationId: input.conversationId, locale, phase: "CAPTURING", text: translate(locale, "conversation.draftExpired") };
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
          locale,
          text: translate(locale, "conversation.waitlistStale"),
          notificationOutboxIds: result.notificationOutboxIds,
        };
      }
      if (state) return { ...await this.buildPreview(input, state), notificationOutboxIds: result.notificationOutboxIds };
      return { conversationId: input.conversationId, locale, phase: "CAPTURING", text: translate(locale, "conversation.availabilityChanged"), notificationOutboxIds: result.notificationOutboxIds };
    }
    if (result.status !== "COMPLETED") {
      return { conversationId: input.conversationId, locale, phase: "ERROR", text: translate(locale, "conversation.confirmError") };
    }
    if (result.actionType === "AID_REQUEST") {
      const reserved = result.reservations.map((item) => `${number(locale, item.quantity)} ${item.productName} (${locale === "en" ? "code" : "código"} ${item.pickupCode})`).join(", ");
      const waiting = result.waiting.map((item) => `${number(locale, item.quantity)} ${item.productName}`).join(", ");
      const pieces = [translate(locale, "conversation.requestRegistered")];
      if (reserved) pieces.push(`${translate(locale, "conversation.activeReservation", { items: reserved })}`);
      if (waiting) pieces.push(`${translate(locale, "conversation.inWaitlist", { items: waiting })}`);
      if (!reserved && !waiting) pieces.push(translate(locale, "conversation.noCommitments"));
      return { conversationId: input.conversationId, locale, phase: "COMPLETED", text: pieces.join(" "), notificationOutboxIds: result.notificationOutboxIds };
    }
    if (result.actionType === "WAITLIST_CONFIRMATION") {
      return {
        conversationId: input.conversationId,
        phase: "COMPLETED",
        locale,
        text: translate(locale, "conversation.turnConfirmed", { quantity: number(locale, result.quantity), product: result.productName, code: result.pickupCode }),
        notificationOutboxIds: result.notificationOutboxIds,
      };
    }
    return {
      conversationId: input.conversationId,
      phase: "COMPLETED",
      locale,
      text: translate(locale, "conversation.manifestCreated", { code: result.code }),
      notificationOutboxIds: result.notificationOutboxIds,
    };
  }

  private async buildPreview(input: ConversationInput, state: ConversationState): Promise<ConversationOutput> {
    const locale = input.locale ?? state.locale ?? DEFAULT_LOCALE;
    if (state.pendingWaitlistReservationId) {
      if (!input.actorId || !state.availabilityWindow) {
        return { conversationId: input.conversationId, locale, phase: "CAPTURING", text: translate(locale, "conversation.askPickupTime") };
      }
      const offer = await findPendingWaitlistOffer(input.actorId, locale);
      if (!offer || offer.id !== state.pendingWaitlistReservationId) {
        return { conversationId: input.conversationId, locale, phase: "CAPTURING", text: translate(locale, "conversation.offerExpired") };
      }
      const payload: WaitlistConfirmationDraftPayload = {
        reservationId: offer.id,
        availabilityWindow: state.availabilityWindow,
      };
      const idempotencyKey = createHash("sha256")
        .update(`${input.actorId}:${offer.id}:${state.availabilityWindow.start}:${state.availabilityWindow.end}`)
        .digest("hex");
      const summary = translate(locale, "conversation.offerSummary", {
        quantity: number(locale, Number(offer.quantity)),
        product: offer.product_name,
        point: offer.point_name,
        start: state.availabilityWindow.start,
        end: state.availabilityWindow.end,
        expires: formatTime(locale, offer.expires_at, offer.timezone),
      });
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
        locale,
        text: translate(locale, "conversation.offerPreview"),
        actionOptions: [{ draftId: draft.draftId, label: translate(locale, "conversation.confirmTurn"), summary }],
      };
    }
    if (!state.intent || !state.items?.length || !state.zone) {
      return { conversationId: input.conversationId, locale, phase: "CAPTURING", text: followUp(missingSlots(state), state, locale) };
    }

    const resolved = await resolveCatalogItems(state.items, locale);
    const unresolved = resolved.filter((entry) => !entry);
    if (unresolved.length) {
      const catalog = await getActiveCatalog(locale);
      const unresolvedNames = resolved.flatMap((entry, index) => entry ? [] : [state.items![index].productName]);
      const names = catalog.map((product) => product.name).join(", ");
      return {
        conversationId: input.conversationId,
        locale,
        phase: "CAPTURING",
        missingFields: ["products"],
        text: names
          ? translate(locale, "conversation.catalogNotFound", { products: unresolvedNames.join(", "), catalog: names })
          : translate(locale, "conversation.catalogEmpty"),
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
      locale,
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
      const locationHint = translate(locale, inputOrigin ? "conversation.noPointPin" : "conversation.noPointZone");
      return { conversationId: input.conversationId, locale, phase: "CAPTURING", text: `${locationHint} ${translate(locale, "conversation.noPointSuffix")}` };
    }
    const productRows = point.products;
    const capExceeded = productRows.find((row) => row.requestedQuantity > row.maxPerRequest);
    if (capExceeded && state.intent === "REQUEST_AID") {
      return { conversationId: input.conversationId, locale, phase: "CAPTURING", text: translate(locale, "conversation.quantityLimit", { product: capExceeded.productName, limit: capExceeded.maxPerRequest }) };
    }

    if (state.intent === "REQUEST_AID") {
      const partialAvailability = productRows.filter((row) =>
        row.queuedRequestCount === 0 && row.availableQuantity > 0 && row.availableQuantity < row.requestedQuantity,
      );
      if (partialAvailability.length > 0) {
        const limits = partialAvailability
          .map((row) => translate(locale, "conversation.partialItem", { product: row.productName, available: number(locale, row.availableQuantity), requested: number(locale, row.requestedQuantity) }))
          .join("; ");
        return {
          conversationId: input.conversationId,
          locale,
          phase: "CAPTURING",
          missingFields: ["products"],
          text: translate(locale, "conversation.partialStock", { point: point.name, limits }),
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
          ? translate(locale, "conversation.pickupItem", { quantity: number(locale, item.requestedQuantity), product: item.productName })
          : translate(locale, "conversation.queueItem", {
            quantity: number(locale, item.requestedQuantity),
            product: item.productName,
            priority: productRows.find((row) => row.productId === item.productId)?.queuedRequestCount ? translate(locale, "conversation.queuePriority") : "",
          }))
        .join("; ");
      const summary = translate(locale, "conversation.pickupSummary", {
        point: point.name,
        distance: humanDistance(point, locale),
        items: immediateSummary,
        start: state.availabilityWindow!.start,
        end: state.availabilityWindow!.end,
      });
      if (!input.actorId) {
        return {
          conversationId: input.conversationId,
          locale,
          phase: "NEEDS_AUTH",
          text: translate(locale, "conversation.recommendation", { point: point.name, area: point.neighborhood, distance: humanDistance(point, locale), reasons: point.reasons.join("; "), summary }),
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
        locale,
        text: translate(locale, "conversation.requestPreview", { point: point.name, area: point.neighborhood, reasons: point.reasons.join("; ") }),
        recommendation: point,
        actionOptions: [{ draftId: draft.draftId, label: translate(locale, "conversation.confirmRequest"), summary }],
      };
    }

    if (!input.actorId) {
      return {
        conversationId: input.conversationId,
        locale,
        phase: "NEEDS_AUTH",
        text: translate(locale, "conversation.donationRecommendation", { point: point.name, area: point.neighborhood, distance: humanDistance(point, locale), reasons: point.reasons.join("; ") }),
        recommendation: point,
      };
    }
    const mediaIds = state.photoMediaIds ?? [];
    const ownedMedia = await getOwnedPrivateMedia(input.actorId, mediaIds);
    if (ownedMedia.length < items.length) {
      return {
        conversationId: input.conversationId,
        locale,
        phase: "CAPTURING",
        missingFields: ["photos"],
        text: translate(locale, "conversation.photoCount", { items: items.length, photos: ownedMedia.length }),
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
    if (!estimatedDeliveryAt) return { conversationId: input.conversationId, locale, phase: "ERROR", text: translate(locale, "conversation.timeError") };
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
    const summary = translate(locale, "conversation.manifestSummary", {
      point: point.name,
      area: point.neighborhood,
      distance: humanDistance(point, locale),
      eta: state.estimatedDeliveryTime ?? "",
      items: manifestItems.map((item) => `${number(locale, item.quantity)} ${item.productName} (${locale === "en" ? "photo attached" : "con foto"})`).join("; "),
    });
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
      locale,
      text: translate(locale, "conversation.recommendationReviewManifest", { point: point.name, area: point.neighborhood, reasons: point.reasons.join("; ") }),
      recommendation: point,
      actionOptions: [{ draftId: draft.draftId, label: translate(locale, "conversation.confirmManifest"), summary }],
    };
  }
}

