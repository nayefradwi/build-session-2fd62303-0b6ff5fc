/**
 * Wishlist collection routes.
 *
 *   GET  /api/wishlist
 *     Return every wishlist entry for the authenticated user, newest
 *     first, including a product summary and stock status for each row.
 *
 *   POST /api/wishlist
 *     Body: `{ productId: string }`
 *     Add a product to the authenticated user's wishlist. Idempotent in
 *     spirit: if the product is already wishlisted we return the
 *     existing row with a 200 (the unique index also guards against
 *     concurrent duplicate inserts).
 *
 * Both endpoints require authentication; an unauthenticated caller
 * receives a 401 `{ code: "unauthenticated" }`.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { AuthRequiredError, requireUser } from "@/lib/server/auth";
import {
  addWishlistItem,
  findWishlistEntry,
  listWishlistForUser,
  productExists,
} from "@/lib/server/wishlist";

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

const addItemSchema = z.object({
  productId: z
    .string()
    .trim()
    .regex(UUID_RE, "productId must be a UUID"),
});

/**
 * GET /api/wishlist
 *
 * Returns `{ items: WishlistEntry[], total: number }`.
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
    const items = await listWishlistForUser(user.id);
    return NextResponse.json(
      { items, total: items.length },
      { status: 200 },
    );
  } catch (err) {
    console.error("[GET /api/wishlist] failed", err);
    return errorResponse(500, {
      error: "Failed to load wishlist",
      code: "internal_error",
    });
  }
}

/**
 * POST /api/wishlist
 *
 * Body: `{ productId: string }`. Returns 201 with the new entry on
 * insert; 200 with the existing entry if the product is already
 * wishlisted; 404 if the product id does not exist.
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
      error: "Invalid wishlist payload",
      code: "validation_failed",
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  const { productId } = parsed.data;

  // Pre-check the product exists so we can return a clean 404 instead
  // of letting the FK violation surface as an opaque 500.
  if (!(await productExists(productId))) {
    return errorResponse(404, {
      error: "Product not found",
      code: "product_not_found",
      fieldErrors: { productId: ["Unknown product"] },
    });
  }

  // Pre-check duplicate so the common "already wishlisted" path returns
  // a clean 200 with the existing row, leaving the unique index as a
  // last-resort guard against concurrent inserts.
  const existing = await findWishlistEntry(user.id, productId);
  if (existing) {
    const items = await listWishlistForUser(user.id);
    const item =
      items.find((i) => i.productId === productId) ?? null;
    return NextResponse.json(
      { item, alreadyExists: true },
      { status: 200 },
    );
  }

  try {
    const item = await addWishlistItem(user.id, productId);
    if (!item) {
      return errorResponse(500, {
        error: "Failed to add wishlist item",
        code: "internal_error",
      });
    }
    return NextResponse.json({ item, alreadyExists: false }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Concurrent insert collided with the unique index. Fall back to
    // the existing row, which is the duplicate handling we already
    // committed to above.
    if (/duplicate|unique/i.test(message)) {
      const items = await listWishlistForUser(user.id);
      const item =
        items.find((i) => i.productId === productId) ?? null;
      return NextResponse.json(
        { item, alreadyExists: true },
        { status: 200 },
      );
    }
    console.error("[POST /api/wishlist] failed", err);
    return errorResponse(500, {
      error: "Failed to add wishlist item",
      code: "internal_error",
    });
  }
}
