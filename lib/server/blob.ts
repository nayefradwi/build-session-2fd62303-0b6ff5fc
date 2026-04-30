/**
 * Blob storage wrapper used by admin product/image routes.
 *
 * Vercel Blob is the canonical backend in production. The wrapper exists so
 * the route layer never imports `@vercel/blob` directly — keeping all the
 * cross-cutting concerns (token check, content-type allow-list, size cap,
 * deterministic pathname construction, error normalisation) in one place.
 *
 * The module degrades gracefully when no `BLOB_READ_WRITE_TOKEN` is set:
 *   - In dev (`NODE_ENV !== "production"`) we fall back to a deterministic
 *     placeholder URL on `/uploads/<hash>.<ext>` so an admin can still
 *     exercise the create/edit flows end-to-end without provisioning a
 *     blob store first. The placeholder is stable per content so re-uploads
 *     of the same file produce the same URL — convenient for testing.
 *   - In production, uploads return a typed `not_configured` error so the
 *     route layer can surface a 503 instead of a generic 500.
 *
 * Deletes are best-effort: a missing blob is treated as a successful
 * delete so the admin "remove image" path stays idempotent.
 */
import { createHash } from "node:crypto";

import { put, del, BlobError } from "@vercel/blob";

import { env } from "@/lib/server/env";

/** Maximum size of a single uploaded image, in bytes. ~10 MiB. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Allow-list of MIME types accepted by the upload route. The admin UI is
 * expected to coerce HEIC etc. before sending; we keep the server-side
 * gate strict so we never serve untrusted content from the public CDN.
 */
export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

export function isAllowedImageMimeType(
  value: string,
): value is AllowedImageMimeType {
  return (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

/** Filename → safe extension. Falls back to `bin` when ambiguous. */
function extensionFromContentType(contentType: string): string {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/avif":
      return "avif";
    default:
      return "bin";
  }
}

/** Slug-safe basename for the blob pathname. */
function safeBaseName(input: string | null | undefined): string {
  if (!input) return "image";
  const cleaned = input
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return cleaned.length === 0 ? "image" : cleaned.slice(0, 64);
}

export type UploadImageError =
  | { code: "not_configured"; message: string }
  | { code: "too_large"; maxBytes: number; actualBytes: number }
  | { code: "unsupported_type"; contentType: string }
  | { code: "empty" }
  | { code: "upload_failed"; message: string };

export type UploadImageResult =
  | {
      ok: true;
      data: {
        url: string;
        contentType: AllowedImageMimeType;
        size: number;
        pathname: string;
      };
    }
  | { ok: false; error: UploadImageError };

export interface UploadImageInput {
  /** Raw file bytes. */
  body: Buffer | Uint8Array | ArrayBuffer | Blob;
  /** Reported MIME type. Validated against `ALLOWED_IMAGE_MIME_TYPES`. */
  contentType: string;
  /** Optional original filename — used to build a friendly pathname. */
  filename?: string | null;
  /** Optional explicit byte length; falls back to body.byteLength. */
  size?: number;
  /**
   * Pathname prefix on the blob store. Defaults to `products/`. Trailing
   * slash optional.
   */
  prefix?: string;
}

/**
 * Convert miscellaneous body inputs into a `Blob` suitable for the
 * `@vercel/blob` SDK — which accepts Buffer | string | Blob but not raw
 * Uint8Array on every path. We funnel through Blob so the call site is
 * uniform.
 */
function toBlob(
  body: UploadImageInput["body"],
  contentType: string,
): { blob: Blob; size: number } {
  if (body instanceof Blob) {
    return { blob: body, size: body.size };
  }
  if (body instanceof ArrayBuffer) {
    const blob = new Blob([body], { type: contentType });
    return { blob, size: body.byteLength };
  }
  if (body instanceof Uint8Array) {
    // Wrap into a fresh ArrayBuffer slice to avoid a node Buffer's
    // shared-pool footprint surprising the Blob constructor.
    const ab = body.buffer.slice(
      body.byteOffset,
      body.byteOffset + body.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([ab], { type: contentType });
    return { blob, size: body.byteLength };
  }
  // Buffer is a Uint8Array subclass in Node, so the previous branch handles
  // it. The remaining type-narrow guard keeps TS happy.
  throw new Error("uploadImage: unsupported body type");
}

/**
 * Upload a single image to the configured blob store. The pathname is
 * deterministic-ish: `<prefix>/<base>-<hash>.<ext>` so re-uploading the
 * exact same bytes produces a stable URL — handy for idempotent retries
 * without polluting the bucket with duplicates.
 */
export async function uploadImage(
  input: UploadImageInput,
): Promise<UploadImageResult> {
  if (!isAllowedImageMimeType(input.contentType)) {
    return {
      ok: false,
      error: { code: "unsupported_type", contentType: input.contentType },
    };
  }

  const { blob, size: derivedSize } = toBlob(input.body, input.contentType);
  const size = input.size ?? derivedSize;

  if (size <= 0) return { ok: false, error: { code: "empty" } };
  if (size > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      error: { code: "too_large", maxBytes: MAX_IMAGE_BYTES, actualBytes: size },
    };
  }

  // Build a deterministic-ish pathname. The hash makes parallel uploads
  // of the same logical file collapse to one blob, but we still namespace
  // by basename so admins can recognise the resulting URLs.
  const prefix = (input.prefix ?? "products").replace(/^\/+|\/+$/g, "");
  const base = safeBaseName(input.filename);
  const ext = extensionFromContentType(input.contentType);

  let buffer: ArrayBuffer;
  if (blob.arrayBuffer) {
    buffer = await blob.arrayBuffer();
  } else {
    // Defensive — every Blob implementation we target exposes arrayBuffer().
    throw new Error("uploadImage: Blob.arrayBuffer() is not available");
  }
  const hashView = createHash("sha256")
    .update(new Uint8Array(buffer))
    .digest("hex")
    .slice(0, 16);
  const pathname = `${prefix}/${base}-${hashView}.${ext}`;

  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    if (env.IS_PROD) {
      return {
        ok: false,
        error: {
          code: "not_configured",
          message:
            "BLOB_READ_WRITE_TOKEN is not configured on the server. Set it in the Vercel project settings or .env.local.",
        },
      };
    }
    // Dev fallback: synthesise a deterministic public URL. The bytes are
    // not actually persisted; the admin UI can still display & store the
    // URL for round-trip testing.
    const placeholderUrl = `${env.APP_URL.replace(/\/+$/, "")}/uploads/${pathname}`;
    return {
      ok: true,
      data: {
        url: placeholderUrl,
        contentType: input.contentType,
        size,
        pathname,
      },
    };
  }

  try {
    const result = await put(pathname, blob, {
      access: "public",
      token,
      contentType: input.contentType,
      // `addRandomSuffix: false` keeps the deterministic-hash pathname.
      // If two admins race uploading the same bytes, the second call
      // succeeds and overwrites with the same content — Blob is content-
      // addressed downstream so this is benign.
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return {
      ok: true,
      data: {
        url: result.url,
        contentType: input.contentType,
        size,
        pathname: result.pathname ?? pathname,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof BlobError) {
      return { ok: false, error: { code: "upload_failed", message } };
    }
    return { ok: false, error: { code: "upload_failed", message } };
  }
}

/**
 * Delete an uploaded image by URL. Best-effort — a missing blob (already
 * deleted, never existed, or stored on a different backend) resolves
 * cleanly so the caller's "remove image" flow stays idempotent.
 */
export async function deleteImage(url: string): Promise<void> {
  if (!url) return;
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) return; // dev fallback — nothing to clean up.

  // Only attempt deletion against URLs that look like Vercel Blob hosts.
  // Anything else (a CDN URL the admin pasted in, etc.) we leave alone.
  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    return;
  }
  if (!/\.public\.blob\.vercel-storage\.com$/i.test(host)) return;

  try {
    await del(url, { token });
  } catch (err) {
    // Swallow — see jsdoc. Log so an operator can tell something went
    // wrong if they audit the logs.
    console.warn("[blob.deleteImage] failed", err);
  }
}
