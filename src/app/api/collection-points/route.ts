import { listPublicCollectionPoints } from "@/services/public-collection-points";
import { parseLocale } from "@/i18n/locale";
import { translate } from "@/i18n/messages";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const locale = parseLocale(new URL(request.url).searchParams.get("locale")) ?? "en";
  try {
    const points = await listPublicCollectionPoints(locale);
    return Response.json({ points }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { error: "collection_points_unavailable", message: translate(locale, "api.pointsError") },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
