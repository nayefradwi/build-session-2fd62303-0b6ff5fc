/**
 * Admin product image collection routes.
 *
 *   POST /api/admin/products/{id}/images
 *     Body: `{ images: [{ url, alt?, position? }, ...] }`. Appends new
 *     image rows to the product's gallery. Positions auto-increment
 *     when not supplied so new uploads land at the end.
 *
 *   PUT  /api/admin/products/{id}/images
 *     Body: `{ order: [{ id, position }, ...] }`. Reorders the existing
 *     gallery in a single call. Every id must already belong to this
 *     product.
 *
 * Both endpoints require the `admin` role.
 */
import { NextResponse } from "next/server";

import {
  AuthRequiredError,
  ForbiddenError,
  requireAdmin,
} from "@/lib/server/auth";
import {
  addProductImages,
  reorderProductImages,
  type AddImagesResult,
  type ReorderImagesResult,
} from "@/lib/server/admin-products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ErrorBody {
  error: string;
  code: string;
  fieldErrors?: Record<string, string[]>;
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

function notFound() {
  return errorResponse(404, {
    error: "Product not found",
    code: "not_found",
  });
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

function addErrorResponse(
  err: Exclude<AddImagesResult, { ok: true }>["error"],
): NextResponse<ErrorBody> {
  if (err.code === "not_found") return notFound();
  return errorResponse(400, {
    error: err.message,
    code: "validation_failed",
    fieldErrors: err.fields,
  });
}

function reorderErrorResponse(
  err: Exclude<ReorderImagesResult, { ok: true }>["error"],
): NextResponse<ErrorBody> {
  if (err.code === "not_found") return notFound();
  return errorResponse(400, {
    error: err.message,
    code: "validation_failed",
    fieldErrors: err.fields,
  });
}

export async function POST(req: Request, ctx: RouteParams) {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    if (err instanceof ForbiddenError) return forbidden();
    throw err;
  }

  const { id } = await ctx.params;
  if (!id) return notFound();

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return errorResponse(400, {
      error: "Request body must be valid JSON",
      code: "invalid_json",
    });
  }

  if (!json || typeof json !== "object") {
    return errorResponse(400, {
      error: "Request body must be a JSON object",
      code: "validation_failed",
    });
  }

  const body = json as Record<string, unknown>;

  try {
    const result = await addProductImages(id, {
      images: (body.images as never) ?? [],
    });
    if (!result.ok) return addErrorResponse(result.error);
    return NextResponse.json({ product: result.data }, { status: 201 });
  } catch (err) {
    console.error(`[POST /api/admin/products/${id}/images] failed`, err);
    return errorResponse(500, {
      error: "Failed to attach images",
      code: "internal_error",
    });
  }
}

export async function PUT(req: Request, ctx: RouteParams) {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    if (err instanceof ForbiddenError) return forbidden();
    throw err;
  }

  const { id } = await ctx.params;
  if (!id) return notFound();

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return errorResponse(400, {
      error: "Request body must be valid JSON",
      code: "invalid_json",
    });
  }

  if (!json || typeof json !== "object") {
    return errorResponse(400, {
      error: "Request body must be a JSON object",
      code: "validation_failed",
    });
  }

  const body = json as Record<string, unknown>;

  try {
    const result = await reorderProductImages(id, {
      order: (body.order as never) ?? [],
    });
    if (!result.ok) return reorderErrorResponse(result.error);
    return NextResponse.json({ product: result.data }, { status: 200 });
  } catch (err) {
    console.error(`[PUT /api/admin/products/${id}/images] failed`, err);
    return errorResponse(500, {
      error: "Failed to reorder images",
      code: "internal_error",
    });
  }
}
