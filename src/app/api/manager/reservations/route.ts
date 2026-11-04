import { getAuthenticatedActor } from "@/core/server/auth";
import { listActiveReservations, listManagedPoints } from "@/services/manager-operations";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const actor = await getAuthenticatedActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const points = await listManagedPoints(actor.id);
    if (!points.length) return Response.json({ error: "manager_access_not_granted" }, { status: 403 });
    return Response.json({ reservations: await listActiveReservations(actor.id) });
  } catch {
    return Response.json({ error: "reservations_unavailable" }, { status: 503 });
  }
}
