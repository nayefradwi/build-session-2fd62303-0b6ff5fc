/**
 * Orders collection routes.
 *
 *   GET /api/orders
 *     Returns the authenticated user's order history, newest first. The
 *     query is ownership-scoped at the SQL layer — callers can NEVER
 *     read another user's orders even with a crafted query string.
 *
 *     Query parameters (all optional):
 *       - page                  1-indexed page number (default 1)
 *       - pageSize              items per page (default 20, max 100)
 *       - status                "all" (default) | one of ORDER_STATUSES
 *       - previewItemLimit      number of preview line items per row,
 *                               clamped to 0..10 (default 3)
 *
 *     Response: `{ items: PublicOrderListEntry[], page, pageSize, total,
 *                  totalPages, hasMore }`. List entries omit the full
 *     `items[]` array — fetch the detail endpoint to read every line.
 *
 *   POST /api/orders
 *     Body:
 *       {
 *         addressId?: string,                 // existing addresses.id
 *         address?:   { line1, city, ... },   // OR a brand new address payload
 *         discountCode?: string | null,
 *         notes?: string | null
 *       }
 *
 *     Creates a new order from the authenticated user's live cart inside
 *     a SERIALIZABLE transaction. The transaction:
 *
 *       1. inserts an `orders` row with snapshotted shipping address,
 *          recomputed totals and `status = "pending"`,
 *       2. snapshots each cart line into `order_items`,
 *       3. atomically decrements `products.stock` (a CHECK constraint
 *          aborts the transaction if any line would go below zero),
 *       4. bumps the redeemed discount code's `usage_count` (when set;
 *          a CHECK constraint aborts on usage-limit overflow),
 *       5. clears the cart.
 *
 *     Responses:
 *       - 201 `{ order }` on success.
 *       - 400 on a malformed body (validation_failed / invalid_json / both
 *         addressId AND address supplied / address_invalid).
 *       - 401 if no session.
 *       - 404 `{ code: "address_not_found" }` if `addressId` is unknown
 *         or doesn't belong to the user.
 *       - 409 `{ code: "cart_empty" }` if the cart has no lines.
 *       - 409 `{ code: "stock_conflict", details: {...} }` if any line
 *         lost a race against concurrent checkouts (or the cart is now
 *         stale on stock).
 *       - 409 `{ code: "product_unavailable" }` if a cart product was
 *         deleted between add-to-cart and checkout commit.
 *       - 409 `{ code: "discount_invalid", details: { reason } }` if the
 *         supplied discount code is no longer redeemable.
 *
 *     The endpoint is idempotent in the sense that it runs entirely
 *     under one transaction — a partial commit cannot occur. Clients
 *     that hit a 5xx should retry; clients that hit a 409 should
 *     re-read the cart and retry.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { AuthRequiredError, requireUser } from "@/lib/server/auth";
import {
  ORDERS_DEFAULT_PAGE_SIZE,
  ORDERS_MAX_PAGE_SIZE,
  ORDER_LIST_STATUS_FILTERS,
  createOrderFromCart,
  listOrdersForUser,
  parseOrderStatusFilter,
  type CreateOrderError,
} from "@/lib/server/orders";
import { sendOrderConfirmationEmail } from "@/lib/server/order-emails";

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

/**
 * Inline new-address payload. Mirrors `createAddressSchema` in
 * `lib/server/addresses.ts` but stays local so the route can present a
 * single Zod surface for the order body. The helper layer applies the
 * same trimming + country-code normalisation.
 */
const inlineAddressSchema = z.object({
  label: z.string().trim().max(100).nullable().optional(),
  recipient: z.string().trim().max(200).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  line1: z.string().trim().min(1, "Line 1 is required").max(200),
  line2: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().min(1, "City is required").max(120),
  state: z.string().trim().max(120).nullable().optional(),
  postalCode: z.string().trim().min(1, "Postal code is required").max(32),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Country must be a two-letter ISO code"),
  isDefault: z.boolean().optional(),
});

const createOrderSchema = z
  .object({
    addressId: z
      .string()
      .trim()
      .regex(UUID_RE, "addressId must be a UUID")
      .optional(),
    address: inlineAddressSchema.optional(),
    discountCode: z.string().trim().min(1).max(64).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine(
    (v) => Boolean(v.addressId) || Boolean(v.address),
    {
      message: "Either addressId or address must be provided",
      path: ["address"],
    },
  )
  .refine(
    (v) => !(v.addressId && v.address),
    {
      message: "Provide exactly one of addressId or address, not both",
      path: ["address"],
    },
  );

/** Map the typed mutation error to an HTTP response. */
function mutationErrorResponse(
  err: CreateOrderError,
): NextResponse<ErrorBody> {
  switch (err.code) {
    case "cart_empty":
      return errorResponse(409, {
        error: "Cart is empty",
        code: "cart_empty",
      });
    case "address_required":
      return errorResponse(400, {
        error: "Either addressId or address must be provided",
        code: "address_required",
      });
    case "address_conflict":
      return errorResponse(400, {
        error: "Provide exactly one of addressId or address, not both",
        code: "address_conflict",
      });
    case "address_invalid":
      return errorResponse(400, {
        error: "Address payload is invalid",
        code: "address_invalid",
      });
    case "address_not_found":
      return errorResponse(404, {
        error: "Address not found",
        code: "address_not_found",
      });
    case "stock_conflict":
      return errorResponse(409, {
        error: "Insufficient stock for one or more items",
        code: "stock_conflict",
        details: {
          productId: err.productId,
          sku: err.sku,
          requested: err.requested,
          available: err.available,
        },
      });
    case "product_unavailable":
      return errorResponse(409, {
        error: "A product in the cart is no longer available",
        code: "product_unavailable",
        details: { productId: err.productId },
      });
    case "discount_invalid":
      return errorResponse(409, {
        error: "Discount code is not redeemable",
        code: "discount_invalid",
        details: { reason: err.reason },
      });
    case "internal_error":
      return errorResponse(500, {
        error: err.message || "Failed to create order",
        code: "internal_error",
      });
  }
}

/**
 * Parse a non-negative integer query-string knob, returning a typed
 * error on garbage input. `null`/empty string is treated as "unset".
 */
function parseInteger(
  raw: string | null,
  field: string,
  min: number,
  max: number,
):
  | { ok: true; value: number | undefined }
  | { ok: false; error: ErrorBody } {
  if (raw === null || raw === "") return { ok: true, value: undefined };
  if (!/^-?\d+$/.test(raw)) {
    return {
      ok: false,
      error: {
        error: `\`${field}\` must be an integer`,
        code: "validation_failed",
        fieldErrors: { [field]: ["Expected an integer"] },
      },
    };
  }
  const parsed = parseInt(raw, 10);
  if (parsed < min || parsed > max) {
    return {
      ok: false,
      error: {
        error: `\`${field}\` must be between ${min} and ${max}`,
        code: "validation_failed",
        fieldErrors: { [field]: [`Out of range (${min}-${max})`] },
      },
    };
  }
  return { ok: true, value: parsed };
}

/**
 * GET /api/orders
 *
 * Returns the authenticated user's order history. Ownership is enforced
 * at the SQL layer in `listOrdersForUser` — there is no way to read
 * another user's orders through this endpoint.
 */
export async function GET(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    throw err;
  }

  const url = new URL(req.url);

  // status filter
  const statusRaw = url.searchParams.get("status");
  const statusFilter = parseOrderStatusFilter(statusRaw);
  if (statusFilter === null) {
    return errorResponse(400, {
      error: `\`status\` must be one of: ${ORDER_LIST_STATUS_FILTERS.join(", ")}`,
      code: "validation_failed",
      fieldErrors: { status: ["Invalid status"] },
    });
  }

  // page
  const pageParsed = parseInteger(
    url.searchParams.get("page"),
    "page",
    1,
    1_000_000,
  );
  if (!pageParsed.ok) return errorResponse(400, pageParsed.error);

  // pageSize
  const pageSizeParsed = parseInteger(
    url.searchParams.get("pageSize"),
    "pageSize",
    1,
    ORDERS_MAX_PAGE_SIZE,
  );
  if (!pageSizeParsed.ok) return errorResponse(400, pageSizeParsed.error);

  // previewItemLimit
  const previewParsed = parseInteger(
    url.searchParams.get("previewItemLimit"),
    "previewItemLimit",
    0,
    10,
  );
  if (!previewParsed.ok) return errorResponse(400, previewParsed.error);

  try {
    const result = await listOrdersForUser({
      userId: user.id,
      page: pageParsed.value ?? 1,
      pageSize: pageSizeParsed.value ?? ORDERS_DEFAULT_PAGE_SIZE,
      status: statusFilter,
      previewItemLimit: previewParsed.value,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[GET /api/orders] failed", err);
    return errorResponse(500, {
      error: "Failed to load orders",
      code: "internal_error",
    });
  }
}

/**
 * POST /api/orders
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

  const parsed = createOrderSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(400, {
      error: "Invalid order payload",
      code: "validation_failed",
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  const body = parsed.data;

  try {
    const result = await createOrderFromCart({
      userId: user.id,
      addressId: body.addressId,
      address: body.address
        ? {
            label: body.address.label ?? null,
            recipient: body.address.recipient ?? null,
            phone: body.address.phone ?? null,
            line1: body.address.line1,
            line2: body.address.line2 ?? null,
            city: body.address.city,
            state: body.address.state ?? null,
            postalCode: body.address.postalCode,
            country: body.address.country,
            isDefault: body.address.isDefault,
          }
        : undefined,
      discountCode: body.discountCode ?? null,
      notes: body.notes ?? null,
    });

    if (!result.ok) {
      return mutationErrorResponse(result.error);
    }

    // Best-effort confirmation email. The dispatcher already retries
    // transient provider failures and swallows errors into a logged
    // result, so a flaky mail provider will never turn a successful
    // checkout into a 500.
    await sendOrderConfirmationEmail({
      order: result.data,
      recipientEmail: user.email,
      recipientName: user.name ?? null,
    });

    return NextResponse.json({ order: result.data }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/orders] failed", err);
    return errorResponse(500, {
      error: "Failed to create order",
      code: "internal_error",
    });
  }
}
