import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { requireServerEnv } from "@/core/server/env";

function decodeKey(value: string): Buffer {
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, "hex");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("A WhatsApp encryption key must decode to 32 bytes.");
  return key;
}

export function normalizeWhatsAppPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 18) throw new Error("Invalid WhatsApp sender identifier.");
  return digits;
}

export function hashWhatsAppSender(value: string): string {
  return createHmac("sha256", requireServerEnv("WHATSAPP_LOOKUP_HMAC_KEY"))
    .update(normalizeWhatsAppPhone(value)).digest("hex");
}

export function encryptWhatsAppDestination(value: string) {
  const key = decodeKey(requireServerEnv("WHATSAPP_DESTINATION_ENCRYPTION_KEY"));
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(normalizeWhatsAppPhone(value), "utf8"), cipher.final()]);
  return { ciphertext, nonce, tag: cipher.getAuthTag() };
}

export function decryptWhatsAppDestination(input: { ciphertext: Uint8Array; nonce: Uint8Array; tag: Uint8Array }) {
  const key = decodeKey(requireServerEnv("WHATSAPP_DESTINATION_ENCRYPTION_KEY"));
  const decipher = createDecipheriv("aes-256-gcm", key, input.nonce);
  decipher.setAuthTag(input.tag);
  return Buffer.concat([decipher.update(input.ciphertext), decipher.final()]).toString("utf8");
}

export function hashWhatsAppLinkToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function verifyWhatsAppWebhookSignature(rawBody: Uint8Array, signature: string | null): boolean {
  if (!signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", requireServerEnv("WHATSAPP_APP_SECRET")).update(rawBody).digest();
  const received = Buffer.from(signature.slice("sha256=".length), "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
