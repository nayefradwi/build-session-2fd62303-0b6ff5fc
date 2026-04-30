/**
 * Admin image upload route.
 *
 *   POST /api/admin/uploads
 *     Accepts a single file (multipart/form-data field name `file`) or
 *     a raw image body (Content-Type set to one of the allow-listed
 *     image MIME types). Persists the bytes to Vercel Blob and returns
 *     `{ url, contentType, size, pathname }` so the admin UI can stash
 *     the URL in a product's `images` array.
 *
 * The actual storage backend (Vercel Blob in production, deterministic
 * placeholder URLs in development) lives in `lib/server/blob.ts`. This
 * route just parses the request and surfaces typed errors as HTTP
 * responses.
 *
 * Requires the `admin` role:
 *   - 401 when no user is logged in
 *   - 403 when the user is logged in but not an admin
 *   - 413 when the file exceeds `MAX_IMAGE_BYTES`
 *   - 415 for an unsupported MIME type
 *   - 503 when running in production without `BLOB_READ_WRITE_TOKEN`
 */
import { NextResponse } from "next/server";

import {
  AuthRequiredError,
  ForbiddenError,
  requireAdmin,
} from "@/lib/server/auth";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  uploadImage,
  type UploadImageError,
} from "@/lib/server/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ErrorBody {
  error: string;
  code: string;
  details?: Record<string, unknown>;
}

function errorResponse(
  status: number,
  body: ErrorBody,
): NextResponse<ErrorBody> {
  return NextResponse.json(body, { status });
}

function unauthorized() {
  return errorResponse(401, {
    error: "Authentication required",
    code: "unauthenticated",
  });
}

function forbidden() {
  return errorResponse(403, {
    error: "Admin role required",
    code: "forbidden",
  });
}

function uploadErrorResponse(err: UploadImageError): NextResponse<ErrorBody> {
  switch (err.code) {
    case "not_configured":
      return errorResponse(503, {
        error: err.message,
        code: "not_configured",
      });
    case "too_large":
      return errorResponse(413, {
        error: `Uploaded file is too large (${err.actualBytes} bytes). Max ${err.maxBytes}.`,
        code: "too_large",
        details: { maxBytes: err.maxBytes, actualBytes: err.actualBytes },
      });
    case "unsupported_type":
      return errorResponse(415, {
        error: `Unsupported content type: ${err.contentType}. Allowed: ${ALLOWED_IMAGE_MIME_TYPES.join(", ")}`,
        code: "unsupported_type",
        details: {
          contentType: err.contentType,
          allowed: [...ALLOWED_IMAGE_MIME_TYPES],
        },
      });
    case "empty":
      return errorResponse(400, {
        error: "Uploaded file is empty",
        code: "empty",
      });
    case "upload_failed":
      return errorResponse(502, {
        error: `Blob upload failed: ${err.message}`,
        code: "upload_failed",
      });
  }
}

interface ParsedUpload {
  body: ArrayBuffer;
  contentType: string;
  filename: string | null;
  size: number;
}

/**
 * Pull the file out of either a multipart form (preferred) or a raw
 * binary body. Multipart is what `<input type="file">` produces; raw is
 * what curl-style power users send.
 */
async function parseUpload(req: Request): Promise<
  { ok: true; data: ParsedUpload } | { ok: false; error: ErrorBody; status: number }
> {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.startsWith("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return {
        ok: false,
        status: 400,
        error: {
          error: "Could not parse multipart form data",
          code: "invalid_form",
        },
      };
    }
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return {
        ok: false,
        status: 400,
        error: {
          error: "Form field `file` is required",
          code: "missing_file",
        },
      };
    }
    const buffer = await file.arrayBuffer();
    return {
      ok: true,
      data: {
        body: buffer,
        contentType: file.type || "application/octet-stream",
        filename: file.name || null,
        size: buffer.byteLength,
      },
    };
  }

  // Raw body. Disallow obvious mismatches so a stray JSON request
  // doesn't get persisted as a "JPEG".
  if (!contentType) {
    return {
      ok: false,
      status: 400,
      error: {
        error:
          "Content-Type header is required (use multipart/form-data or one of the allowed image types)",
        code: "missing_content_type",
      },
    };
  }
  let buffer: ArrayBuffer;
  try {
    buffer = await req.arrayBuffer();
  } catch {
    return {
      ok: false,
      status: 400,
      error: {
        error: "Could not read request body",
        code: "invalid_body",
      },
    };
  }
  return {
    ok: true,
    data: {
      body: buffer,
      contentType,
      filename: req.headers.get("x-filename"),
      size: buffer.byteLength,
    },
  };
}

export async function POST(req: Request) {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    if (err instanceof ForbiddenError) return forbidden();
    throw err;
  }

  const parsed = await parseUpload(req);
  if (!parsed.ok) return errorResponse(parsed.status, parsed.error);

  // Length-based 413 short-circuit so we don't waste time hashing a
  // body the storage backend will reject.
  if (parsed.data.size > MAX_IMAGE_BYTES) {
    return errorResponse(413, {
      error: `Uploaded file is too large (${parsed.data.size} bytes). Max ${MAX_IMAGE_BYTES}.`,
      code: "too_large",
      details: { maxBytes: MAX_IMAGE_BYTES, actualBytes: parsed.data.size },
    });
  }

  try {
    const result = await uploadImage({
      body: parsed.data.body,
      contentType: parsed.data.contentType,
      filename: parsed.data.filename,
      size: parsed.data.size,
    });
    if (!result.ok) return uploadErrorResponse(result.error);
    return NextResponse.json(result.data, { status: 201 });
  } catch (err) {
    console.error("[POST /api/admin/uploads] failed", err);
    return errorResponse(500, {
      error: "Failed to persist upload",
      code: "internal_error",
    });
  }
}

/** GET reports the current upload limits + allow-list for the admin UI. */
export async function GET() {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    if (err instanceof ForbiddenError) return forbidden();
    throw err;
  }

  return NextResponse.json(
    {
      maxBytes: MAX_IMAGE_BYTES,
      allowedContentTypes: [...ALLOWED_IMAGE_MIME_TYPES],
    },
    { status: 200 },
  );
}
