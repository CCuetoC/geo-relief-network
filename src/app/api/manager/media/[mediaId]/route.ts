import { getAuthenticatedActor } from "@/core/server/auth";
import { getManagerPrivateMedia } from "@/adapters/server/private-media";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ mediaId: string }> }): Promise<Response> {
  const actor = await getAuthenticatedActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  try {
    const { mediaId } = await context.params;
    const media = await getManagerPrivateMedia(mediaId, actor.id);
    if (!media) return new Response("Not found", { status: 404 });
    return new Response(media.bytes, {
      status: 200,
      headers: {
        "Content-Type": media.contentType,
        "Content-Length": String(media.bytes.byteLength),
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Media unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
