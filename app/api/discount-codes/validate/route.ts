/**
 * Discount-code validation route (cart / checkout flow).
 *
 *   POST /api/discount-codes/validate
 *     Body: `{ code: string, subtotalCents?: number }`.
 *
 * Validates the supplied code against the cart subtotal and returns a
 * normalised representation suitable for the cart UI's "Promo applied"
 * line. The endpoint is stateless: it does NOT persist anything on the
 * cart and does NOT bump the code's `usageCount` — that bump happens at
 * checkout commit (a future order-creation task), under a transaction.
 *
 * Subtotal resolution:
 *   - When `subtotalCents` is supplied in the body, that value is used.
 *     It must be a non-negative integer (cents).
 *   - When omitted, the server reads the authenticated user's live cart
 *     and uses its `summary.subtotalCents`.
 *
 * Auth: an authenticated session is required. Anonymous validation is
 * intentionally not supported — coupon-spamming bots would otherwise have
 * an oracle for the entire active-code list.
 *
 * "Only one code per cart context" is enforced by the request shape
 * (exactly one code per call) and by the absence of any persisted
 * "applied code" state — the client tracks the active code locally and
 * re-submits it (or a different one) when the cart subtotal changes.
 *
 * Responses:
 *   - 200 `{ discount }`           — the code applies; `discount` is the
 *                                    normalised payload (id, code, type,
 *                                    value, amountCents, subtotalCents,
 *                                    subtotalAfterDiscountCents, …).
 *   - 400                          — malformed body / invalid subtotal.
 *   - 401                          — not authenticated.
 *   - 404 `{ code: "not_found" }`  — no such code (or doesn't pass length /
 *                                    character checks).
 *   - 409 `{ code: "inactive" }`   — admin-disabled.
 *   - 409 `{ code: "expired" }`    — past `expiresAt`.
 *   - 409 `{ code: "exhausted" }`  — `usageCount >= usageLimit`.
 *   - 409 `{ code: "min_order_not_met" }` — subtotal below `minOrderValue`.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { AuthRequiredError, requireUser } from "@/lib/server/auth";
import { getCartView } from "@/lib/server/cart";
import {
  validateDiscountCode,
  type DiscountValidationError,
} from "@/lib/server/discount-codes";

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

/**
 * Request body schema. `code` is required; `subtotalCents` is optional —
 * when omitted the route falls back to the authenticated user's live
 * cart subtotal.
 */
const validateSchema = z.object({
  code: z
    .string()
    .min(1, "code is required")
    .max(64, "code is too long"),
  subtotalCents: z
    .number()
    .int("subtotalCents must be an integer")
    .nonnegative("subtotalCents must be >= 0")
    .optional(),
  /**
   * Currency tag echoed back on success. Defaults to the cart currency
   * when omitted; the cart is single-currency by construction.
   */
  currency: z
    .string()
    .min(3)
    .max(3)
    .optional(),
});

/**
 * Map the typed validation error to an HTTP response. The "code can't be
 * applied for a business reason" set (inactive / expired / exhausted /
 * min-order) shares a 409 — the request is well-formed and the code
 * exists, but the resource state conflicts with the cart context.
 */
function validationErrorResponse(
  err: DiscountValidationError,
): NextResponse<ErrorBody> {
  switch (err.code) {
    case "not_found":
      return errorResponse(404, {
        error: "Discount code not found",
        code: "not_found",
      });
    case "inactive":
      return errorResponse(409, {
        error: "This discount code is no longer active",
        code: "inactive",
      });
    case "expired":
      return errorResponse(409, {
        error: "This discount code has expired",
        code: "expired",
        details: { expiresAt: err.expiresAt },
      });
    case "exhausted":
      return errorResponse(409, {
        error: "This discount code has reached its usage limit",
        code: "exhausted",
        details: { usageLimit: err.usageLimit, usageCount: err.usageCount },
      });
    case "min_order_not_met":
      return errorResponse(409, {
        error:
          "Cart subtotal does not meet the minimum order value for this code",
        code: "min_order_not_met",
        details: {
          minOrderValue: err.minOrderValue,
          subtotalCents: err.subtotalCents,
        },
      });
    case "validation_failed":
      return errorResponse(400, {
        error: err.message,
        code: "validation_failed",
        fieldErrors: err.fields,
      });
  }
}

/**
 * POST /api/discount-codes/validate
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

  const parsed = validateSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(400, {
      error: "Invalid validate-discount payload",
      code: "validation_failed",
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  // Resolve the subtotal we'll validate against. Body-supplied values win
  // over the live cart so the checkout step (which already knows the
  // numbers it is about to charge) doesn't need a second round-trip.
  let subtotalCents = parsed.data.subtotalCents;
  let currency = parsed.data.currency;
  if (subtotalCents === undefined) {
    try {
      const view = await getCartView(user.id);
      subtotalCents = view.summary.subtotalCents;
      currency = currency ?? view.summary.currency;
    } catch (err) {
      console.error(
        "[POST /api/discount-codes/validate] failed loading cart",
        err,
      );
      return errorResponse(500, {
        error: "Failed to load cart for discount validation",
        code: "internal_error",
      });
    }
  }

  try {
    const result = await validateDiscountCode({
      code: parsed.data.code,
      subtotalCents: subtotalCents ?? 0,
      currency,
    });
    if (!result.ok) return validationErrorResponse(result.error);
    return NextResponse.json({ discount: result.data }, { status: 200 });
  } catch (err) {
    console.error("[POST /api/discount-codes/validate] failed", err);
    return errorResponse(500, {
      error: "Failed to validate discount code",
      code: "internal_error",
    });
  }
}
