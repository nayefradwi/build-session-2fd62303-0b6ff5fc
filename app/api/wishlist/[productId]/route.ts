/**
 * Wishlist item routes.
 *
 *   DELETE /api/wishlist/{productId}
 *     Remove the wishlist row that matches the authenticated user and
 *     the supplied product id. Returns 200 on a successful delete, 404
 *     if no such row exists for this user, 401 if unauthenticated.
 *
 * Note we key the URL by `productId` rather than the wishlist row id so
 * the UI can call DELETE without first fetching the wishlist to learn
 * the row id.
 */
import { NextResponse } from "next/server";

import { AuthRequiredError, requireUser } from "@/lib/server/auth";
import { removeWishlistItem } from "@/lib/server/wishlist";

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

function unauthorized(): NextResponse<ErrorBody> {
  return errorResponse(401, {
    error: "Authentication required",
    code: "unauthenticated",
  });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: Promise<{ productId: string }>;
}

export async function DELETE(_req: Request, ctx: RouteParams) {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    throw err;
  }

  const { productId } = await ctx.params;
  if (!productId || !UUID_RE.test(productId)) {
    return errorResponse(404, {
      error: "Wishlist item not found",
      code: "not_found",
    });
  }

  try {
    const removed = await removeWishlistItem(user.id, productId);
    if (!removed) {
      return errorResponse(404, {
        error: "Wishlist item not found",
        code: "not_found",
      });
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error(
      `[DELETE /api/wishlist/${productId}] failed`,
      err,
    );
    return errorResponse(500, {
      error: "Failed to remove wishlist item",
      code: "internal_error",
    });
  }
}
