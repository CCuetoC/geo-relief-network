import { requireServerEnv, serverEnv } from "@/core/server/env";

export interface NeonAuthServerConfig {
  baseUrl: string;
  jwksUrl?: string;
  cookieSecret?: string;
}

/** Configuration boundary only; OAuth and session handling are not initialized yet. */
export function getNeonAuthServerConfig(): NeonAuthServerConfig {
  return {
    baseUrl: requireServerEnv("NEON_AUTH_BASE_URL"),
    jwksUrl: serverEnv.NEON_AUTH_JWKS_URL,
    cookieSecret: serverEnv.NEON_AUTH_COOKIE_SECRET,
  };
}
