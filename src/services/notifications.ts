import "server-only";
import { markWebNotificationsRead, readWebNotifications } from "@/repositories/notification-outbox-repository";

/** Application-facing queries for in-app notifications; provider delivery is an outbound adapter. */
export async function listWebNotifications(userId: string) {
  return readWebNotifications(userId);
}

export async function acknowledgeWebNotifications(userId: string, ids: string[]) {
  return markWebNotificationsRead(userId, ids);
}
