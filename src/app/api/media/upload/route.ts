import { getAuthenticatedActor } from "@/core/server/auth";
import { privateMediaConfigurationPresent, storePrivatePhoto } from "@/adapters/server/private-media";

export const runtime = "nodejs";
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_PHOTO_BYTES + 128 * 1024;

async function readBoundedRequest(request: Request): Promise<Request> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_MULTIPART_BYTES) throw new Error("body_too_large");
  if (!request.body) return request;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_MULTIPART_BYTES) {
      await reader.cancel();
      throw new Error("body_too_large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request.url, { method: request.method, headers: request.headers, body: bytes });
}

export async function POST(request: Request): Promise<Response> {
  const actor = await getAuthenticatedActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!privateMediaConfigurationPresent()) {
    return Response.json({ error: "private_media_not_configured" }, { status: 503 });
  }

  try {
    const bounded = await readBoundedRequest(request);
    if (!(bounded.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data;")) {
      return Response.json({ error: "multipart_required" }, { status: 415 });
    }
    const form = await bounded.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "photo_required" }, { status: 400 });
    if (file.size > MAX_PHOTO_BYTES) return Response.json({ error: "photo_too_large" }, { status: 413 });
    const saved = await storePrivatePhoto({
      ownerId: actor.id,
      bytes: new Uint8Array(await file.arrayBuffer()),
      claimedContentType: file.type,
    });
    return Response.json(saved, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "body_too_large") {
      return Response.json({ error: "photo_too_large" }, { status: 413 });
    }
    const message = error instanceof Error ? error.message : "No se pudo guardar la foto privada.";
    return Response.json({ error: "photo_upload_failed", message }, { status: 400 });
  }
}
