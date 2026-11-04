import { getAuthenticatedActor } from "@/core/server/auth";
import { listManagedPoints, listPendingManifests } from "@/services/manager-operations";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const actor = await getAuthenticatedActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const points = await listManagedPoints(actor.id);
    if (!points.length) return Response.json({ error: "manager_access_not_granted" }, { status: 403 });
    return Response.json({ manifests: await listPendingManifests(actor.id) });
  } catch {
    return Response.json({ error: "manager_view_unavailable" }, { status: 503 });
  }
}
