import "server-only";
import { requireServerEnv } from "@/core/server/env";

export function configuredWhatsAppBusinessNumber() {
  const number = requireServerEnv("WHATSAPP_BUSINESS_NUMBER").replace(/\D/g, "");
  if (!number) throw new Error("WhatsApp business number is invalid.");
  return number;
}
