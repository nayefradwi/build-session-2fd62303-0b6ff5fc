/**
 * Cart item routes.
 *
 *   PUT    /api/cart/{itemId}
 *     Body: `{ quantity }`. Set the absolute quantity on an existing
 *     cart line. The route enforces stock and the per-line cap.
 *
 *   DELETE /api/cart/{itemId}
 *     Remove the cart line with the supplied id, scoped to the
 *     authenticated user. Idempotent in spirit — a 404 is returned when
 *     no such row exists for this user.
 *
 * Both endpoints require authentication. The id in the URL is the cart
 * item's primary key (matching the `id` returned by GET /api/cart).
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { AuthRequiredError, requireUser } from "@/lib/server/auth";
import {
  MAX_QUANTITY_PER_LINE,
  getCartView,
  removeCartItem,
  setCartItemQuantity,
  type CartMutationError,
} from "@/lib/server/cart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ErrorBody {
  error: string;
  code: string;
  fieldErrors?: Record<string, string[]>;
  details?: Record<string, unknown>;
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

function notFound(): NextResponse<ErrorBody> {
  return errorResponse(404, {
    error: "Cart item not found",
    code: "not_found",
  });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const updateItemSchema = z.object({
  quantity: z
    .number()
    .int("quantity must be an integer")
    .positive("quantity must be > 0")
    .max(MAX_QUANTITY_PER_LINE, `quantity must be at most ${MAX_QUANTITY_PER_LINE}`),
});

interface RouteParams {
  params: Promise<{ itemId: string }>;
}

/**
 * Translate a mutation error into the right HTTP response. Mirrors the
 * collection-route logic so the contract stays consistent across the
 * whole cart surface.
 */
function mutationErrorResponse(
  err: CartMutationError,
): NextResponse<ErrorBody> {
  switch (err.code) {
    case "product_not_found":
      // The owning row vanished (the cart item or the product it
      // referenced). 404 is the right answer for either.
      return notFound();
    case "out_of_stock":
      return errorResponse(409, {
        error: "Product is out of stock",
        code: "out_of_stock",
        details: { available: err.available },
      });
    case "exceeds_stock":
      return errorResponse(409, {
        error: "Requested quantity exceeds available stock",
        code: "exceeds_stock",
        details: { available: err.available, requested: err.requested },
      });
    case "exceeds_max_quantity":
      return errorResponse(400, {
        error: `Quantity must be at most ${err.max}`,
        code: "exceeds_max_quantity",
        details: { max: err.max, requested: err.requested },
      });
    case "invalid_quantity":
      return errorResponse(400, {
        error: "Quantity must be a positive integer",
        code: "invalid_quantity",
      });
  }
}

/**
 * PUT /api/cart/[itemId]
 *
 * Body: `{ quantity }`. Returns 200 with the updated `{ item, summary }`
 * on success, 400 on validation, 404 if the item doesn't exist for this
 * user, 409 on stock conflict.
 */
export async function PUT(req: Request, ctx: RouteParams) {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    throw err;
  }

  const { itemId } = await ctx.params;
  if (!itemId || !UUID_RE.test(itemId)) return notFound();

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return errorResponse(400, {
      error: "Request body must be valid JSON",
      code: "invalid_json",
    });
  }

  const parsed = updateItemSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(400, {
      error: "Invalid cart payload",
      code: "validation_failed",
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const result = await setCartItemQuantity(
      user.id,
      itemId,
      parsed.data.quantity,
    );
    if (!result.ok) {
      return mutationErrorResponse(result.error);
    }
    const view = await getCartView(user.id);
    const item = view.items.find((i) => i.id === result.itemId) ?? null;
    return NextResponse.json(
      { item, summary: view.summary },
      { status: 200 },
    );
  } catch (err) {
    console.error(`[PUT /api/cart/${itemId}] failed`, err);
    return errorResponse(500, {
      error: "Failed to update cart item",
      code: "internal_error",
    });
  }
}

/**
 * DELETE /api/cart/[itemId]
 *
 * Returns 200 `{ ok: true, summary }` on success (with the updated cart
 * summary), 404 if no such item exists for this user, 401 if
 * unauthenticated.
 */
export async function DELETE(_req: Request, ctx: RouteParams) {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    throw err;
  }

  const { itemId } = await ctx.params;
  if (!itemId || !UUID_RE.test(itemId)) return notFound();

  try {
    const removed = await removeCartItem(user.id, itemId);
    if (!removed) return notFound();
    const view = await getCartView(user.id);
    return NextResponse.json(
      { ok: true, summary: view.summary },
      { status: 200 },
    );
  } catch (err) {
    console.error(`[DELETE /api/cart/${itemId}] failed`, err);
    return errorResponse(500, {
      error: "Failed to remove cart item",
      code: "internal_error",
    });
  }
}
