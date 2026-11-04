import { requireServerEnv, serverEnv } from "@/core/server/env";

export interface NeonAuthServerConfig {
  baseUrl: string;
  jwksUrl?: string;
  cookieSecret: string;
}

/** Neon Auth branch configuration is resolved only on the server. */
export function getNeonAuthServerConfig(): NeonAuthServerConfig {
  return {
    baseUrl: requireServerEnv("NEON_AUTH_BASE_URL"),
    jwksUrl: serverEnv.NEON_AUTH_JWKS_URL,
    cookieSecret: requireServerEnv("NEON_AUTH_COOKIE_SECRET"),
  };
}
