/**
 * Admin product image detail route.
 *
 *   DELETE /api/admin/products/{id}/images/{imageId}
 *     Removes a single image from a product's gallery. Best-effort blob
 *     cleanup is attempted for URLs hosted on Vercel Blob; URLs from
 *     other CDNs are left in place. Returns the updated product so the
 *     UI can re-render without an extra GET.
 *
 * Requires the `admin` role.
 */
import { NextResponse } from "next/server";

import {
  AuthRequiredError,
  ForbiddenError,
  requireAdmin,
} from "@/lib/server/auth";
import { deleteProductImage } from "@/lib/server/admin-products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ErrorBody {
  error: string;
  code: string;
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
    error: "Image not found",
    code: "not_found",
  });
}

interface RouteParams {
  params: Promise<{ id: string; imageId: string }>;
}

export async function DELETE(_req: Request, ctx: RouteParams) {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    if (err instanceof ForbiddenError) return forbidden();
    throw err;
  }

  const { id, imageId } = await ctx.params;
  if (!id || !imageId) return notFound();

  try {
    const result = await deleteProductImage(id, imageId);
    if (!result.ok) return notFound();
    return NextResponse.json({ product: result.data }, { status: 200 });
  } catch (err) {
    console.error(
      `[DELETE /api/admin/products/${id}/images/${imageId}] failed`,
      err,
    );
    return errorResponse(500, {
      error: "Failed to delete image",
      code: "internal_error",
    });
  }
}
