import { requireServerEnv } from "@/core/server/env";

export interface MuseSparkConfig {
  baseUrl: "https://api.meta.ai/v1";
  apiKey: string;
  modelFamily: "Muse Spark";
}

/** Configuration boundary only; no request is sent to Meta from this scaffold. */
export function getMuseSparkConfig(): MuseSparkConfig {
  return {
    baseUrl: "https://api.meta.ai/v1",
    apiKey: requireServerEnv("MODEL_API_KEY"),
    modelFamily: "Muse Spark",
  };
}
