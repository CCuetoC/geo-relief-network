/**
 * Server environment access by module convention. Do not import this file from client code.
 * Values remain optional so static generation/builds do not require provider credentials.
 */
export const serverEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
  NEON_AUTH_BASE_URL: process.env.NEON_AUTH_BASE_URL,
  NEON_AUTH_JWKS_URL: process.env.NEON_AUTH_JWKS_URL,
  NEON_AUTH_COOKIE_SECRET: process.env.NEON_AUTH_COOKIE_SECRET,
  MODEL_API_KEY: process.env.MODEL_API_KEY,
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  AWS_ENDPOINT_URL_S3: process.env.AWS_ENDPOINT_URL_S3,
  AWS_REGION: process.env.AWS_REGION,
  OBJECT_STORAGE_BUCKET: process.env.OBJECT_STORAGE_BUCKET,
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN,
  WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET,
  WHATSAPP_LOOKUP_HMAC_KEY: process.env.WHATSAPP_LOOKUP_HMAC_KEY,
  WHATSAPP_DESTINATION_ENCRYPTION_KEY: process.env.WHATSAPP_DESTINATION_ENCRYPTION_KEY,
} as const;

export type ServerEnvironmentKey = keyof typeof serverEnv;

export function requireServerEnv(key: ServerEnvironmentKey): string {
  const value = serverEnv[key];
  if (!value) {
    throw new Error(`Missing required server environment variable: ${key}`);
  }
  return value;
}
