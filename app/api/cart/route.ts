/**
 * Cart collection routes.
 *
 *   GET  /api/cart
 *     Return every cart line for the authenticated user, plus the cart
 *     summary (subtotal, shipping placeholder, discount placeholder,
 *     total). Empty cart still returns a populated `summary` so the UI
 *     never has to special-case the zero-line state.
 *
 *   POST /api/cart
 *     Body: `{ productId, quantity?, mode? }`. Adds a product to the
 *     authenticated user's cart, or increments / overwrites the existing
 *     line for that product. Default `quantity` is 1, default `mode` is
 *     `"increment"`.
 *
 * Both endpoints require authentication; an unauthenticated caller
 * receives a 401 `{ code: "unauthenticated" }`.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { AuthRequiredError, requireUser } from "@/lib/server/auth";
import {
  MAX_QUANTITY_PER_LINE,
  addOrUpdateCartItem,
  getCartView,
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const addItemSchema = z.object({
  productId: z
    .string()
    .trim()
    .regex(UUID_RE, "productId must be a UUID"),
  quantity: z
    .number()
    .int("quantity must be an integer")
    .positive("quantity must be > 0")
    .max(MAX_QUANTITY_PER_LINE, `quantity must be at most ${MAX_QUANTITY_PER_LINE}`)
    .optional()
    .default(1),
  mode: z.enum(["increment", "set"]).optional().default("increment"),
});

/**
 * Map the typed mutation error to an HTTP response. Stock-related errors
 * surface with a 409 (the resource exists, but the requested state
 * conflicts with on-hand inventory) which lets the client distinguish
 * them from a malformed payload (400) or a missing product (404).
 */
function mutationErrorResponse(
  err: CartMutationError,
): NextResponse<ErrorBody> {
  switch (err.code) {
    case "product_not_found":
      return errorResponse(404, {
        error: "Product not found",
        code: "product_not_found",
      });
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
 * GET /api/cart
 *
 * Returns `{ items, summary }` for the authenticated user.
 */
export async function GET() {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    throw err;
  }

  try {
    const view = await getCartView(user.id);
    return NextResponse.json(view, { status: 200 });
  } catch (err) {
    console.error("[GET /api/cart] failed", err);
    return errorResponse(500, {
      error: "Failed to load cart",
      code: "internal_error",
    });
  }
}

/**
 * POST /api/cart
 *
 * Body: `{ productId, quantity?, mode? }`.
 *   - `quantity` defaults to 1; must be a positive integer no greater
 *     than the per-line cap.
 *   - `mode` defaults to "increment". `"set"` overwrites the existing
 *     line's quantity.
 *
 * Returns:
 *   - 201 `{ item, summary }` on insert
 *   - 200 `{ item, summary }` on update of an existing line
 *   - 400 on validation / invalid quantity
 *   - 404 if the product id is unknown
 *   - 409 if the requested quantity violates the live stock check
 */
export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    throw err;
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return errorResponse(400, {
      error: "Request body must be valid JSON",
      code: "invalid_json",
    });
  }

  const parsed = addItemSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(400, {
      error: "Invalid cart payload",
      code: "validation_failed",
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  const { productId, quantity, mode } = parsed.data;

  try {
    const result = await addOrUpdateCartItem({
      userId: user.id,
      productId,
      quantity,
      mode,
    });
    if (!result.ok) {
      return mutationErrorResponse(result.error);
    }

    const view = await getCartView(user.id);
    const item = view.items.find((i) => i.id === result.itemId) ?? null;
    return NextResponse.json(
      { item, summary: view.summary, created: result.created },
      { status: result.created ? 201 : 200 },
    );
  } catch (err) {
    console.error("[POST /api/cart] failed", err);
    return errorResponse(500, {
      error: "Failed to update cart",
      code: "internal_error",
    });
  }
}
