import { listPublicCollectionPoints } from "@/services/public-collection-points";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const points = await listPublicCollectionPoints();
    return Response.json({ points }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { error: "collection_points_unavailable", message: "No pudimos cargar los puntos ahora." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
