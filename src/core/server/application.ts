import "server-only";
import { MuseSparkTurnExtractor } from "@/adapters/server/muse-spark-extractor";
import { NeonConversationContextRepository } from "@/repositories/conversation-context-repository";
import { NeonCollectionPointReadService } from "@/services/geospatial-matching";
import { NeonConversationService } from "@/services/conversation-service";

/** Composition root: provider and persistence adapters are wired into application ports here. */
export const conversationService = new NeonConversationService(
  new MuseSparkTurnExtractor(),
  new NeonConversationContextRepository(),
  new NeonCollectionPointReadService(),
);
