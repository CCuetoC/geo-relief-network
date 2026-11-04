import { requireServerEnv, serverEnv } from "@/core/server/env";

export interface MuseSparkConfig {
  baseUrl: "https://api.meta.ai/v1";
  apiKey: string;
  textModel: string;
  audioModel: string;
}

/** Model choice is server-only; audio requests use Muse Spark 1.2 while current text uses 1.3. */
export function getMuseSparkConfig(): MuseSparkConfig {
  return {
    baseUrl: "https://api.meta.ai/v1",
    apiKey: requireServerEnv("MODEL_API_KEY"),
    textModel: serverModel("MUSE_SPARK_TEXT_MODEL", "muse-spark-1.3"),
    audioModel: serverModel("MUSE_SPARK_AUDIO_MODEL", "muse-spark-1.2"),
  };
}

function serverModel(key: "MUSE_SPARK_TEXT_MODEL" | "MUSE_SPARK_AUDIO_MODEL", fallback: string) {
  return serverEnv[key] || fallback;
}
