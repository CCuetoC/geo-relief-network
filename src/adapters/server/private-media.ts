import "server-only";

import { createHash, createHmac, randomUUID } from "node:crypto";
import {
  requireServerEnv,
  serverEnv,
} from "@/core/server/env";
import { getAttachedManagerMedia, insertPrivateMedia } from "@/repositories/private-media-repository";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function hmac(key: Uint8Array | string, value: string) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

async function s3Request(method: "GET" | "PUT" | "DELETE", storageKey: string, bytes?: Uint8Array, contentType?: string) {
  const endpoint = new URL(requireServerEnv("AWS_ENDPOINT_URL_S3"));
  const bucket = requireServerEnv("OBJECT_STORAGE_BUCKET");
  const region = requireServerEnv("AWS_REGION");
  const accessKey = requireServerEnv("AWS_ACCESS_KEY_ID");
  const secretKey = requireServerEnv("AWS_SECRET_ACCESS_KEY");
  const encodedPath = `${endpoint.pathname.replace(/\/$/, "")}/${[bucket, ...storageKey.split("/")].map(encodeURIComponent).join("/")}`;
  const url = new URL(endpoint.toString());
  url.pathname = encodedPath;
  const bodyHash = createHash("sha256").update(bytes ?? new Uint8Array()).digest("hex");
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": bodyHash,
    "x-amz-date": amzDate,
  };
  if (contentType) headers["content-type"] = contentType;
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort().map((key) => `${key}:${headers[key].trim()}\n`).join("");
  const canonicalRequest = [method, url.pathname, url.searchParams.toString(), canonicalHeaders, signedHeaders, bodyHash].join("\n");
  const scope = `${date}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");
  const dateKey = hmac(`AWS4${secretKey}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch(url, {
    method,
    headers: { ...headers, Authorization: authorization },
    ...(method === "PUT" ? { body: Buffer.from(bytes ?? new Uint8Array()) } : {}),
  });
  if (!response.ok) throw new Error(`El almacenamiento privado respondió ${response.status}.`);
  return response;
}

function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "image/png";
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
  ) return "image/webp";
  return null;
}

export async function storePrivatePhoto(input: {
  ownerId: string;
  bytes: Uint8Array;
  claimedContentType: string;
}): Promise<{ id: string }> {
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_PHOTO_BYTES) {
    throw new Error("La foto debe pesar como máximo 5 MB.");
  }
  const detectedType = sniffImageType(input.bytes);
  if (!detectedType || !allowedTypes.has(input.claimedContentType) || detectedType !== input.claimedContentType) {
    throw new Error("Formato de foto no válido. Usa JPG, PNG o WebP.");
  }

  const id = randomUUID();
  const storageKey = `donation-photos/${input.ownerId}/${id}`;
  await s3Request("PUT", storageKey, input.bytes, detectedType);

  try {
    await insertPrivateMedia({
      id,
      ownerId: input.ownerId,
      storageKey,
      contentType: detectedType,
      byteSize: input.bytes.byteLength,
    });
  } catch (error) {
    await s3Request("DELETE", storageKey).catch(() => undefined);
    throw error;
  }
  return { id };
}

export async function getManagerPrivateMedia(mediaId: string, managerId: string) {
  const media = await getAttachedManagerMedia(mediaId, managerId);
  if (!media) return null;
  const response = await s3Request("GET", media.storage_key);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== Number(media.byte_size)) throw new Error("El tamaño del archivo almacenado no coincide.");
  return { bytes, contentType: media.content_type };
}

export async function storeWhatsAppImage(ownerId: string, bytes: Uint8Array, contentType: string) {
  return storePrivatePhoto({ ownerId, bytes, claimedContentType: contentType });
}

export const privateMediaConfigurationPresent = () => Boolean(
  serverEnv.AWS_ACCESS_KEY_ID && serverEnv.AWS_SECRET_ACCESS_KEY && serverEnv.AWS_ENDPOINT_URL_S3 && serverEnv.AWS_REGION && serverEnv.OBJECT_STORAGE_BUCKET,
);
