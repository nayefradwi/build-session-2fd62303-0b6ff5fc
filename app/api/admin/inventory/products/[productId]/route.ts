/**
 * Admin inventory single-product routes.
 *
 *   GET   /api/admin/inventory/products/{productId}
 *     Return the inventory row for a single product (stock + lowStock /
 *     outOfStock flags + active threshold).
 *
 *   PATCH /api/admin/inventory/products/{productId}
 *     Body: `{ stock?: number, delta?: number, reason?: string }`. Either
 *     `stock` (absolute set) or `delta` (signed change) must be present.
 *     Persists a `stock_adjustments` audit row with the actor and
 *     before/after values. Returns the updated inventory row plus the
 *     audit row.
 *
 * Requires the `admin` role:
 *   - 401 when no user is logged in
 *   - 403 when the user is logged in but not an admin
 *   - 404 when the product does not exist
 *   - 409 when no change was applied (stock == requested value)
 */
import { NextResponse } from "next/server";

import {
  AuthRequiredError,
  ForbiddenError,
  requireAdmin,
} from "@/lib/server/auth";
import {
  getInventoryRow,
  updateProductStock,
  type StockUpdateError,
} from "@/lib/server/inventory";

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

function stockErrorResponse(err: StockUpdateError): NextResponse<ErrorBody> {
  switch (err.code) {
    case "not_found":
      return notFound();
    case "no_change":
      return errorResponse(409, {
        error: "Stock is already at the requested value",
        code: "no_change",
      });
    case "validation_failed":
      return errorResponse(400, {
        error: err.message,
        code: "validation_failed",
        fieldErrors: err.fields,
      });
  }
}

interface RouteParams {
  params: Promise<{ productId: string }>;
}

export async function GET(_req: Request, ctx: RouteParams) {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    if (err instanceof ForbiddenError) return forbidden();
    throw err;
  }

  const { productId } = await ctx.params;
  if (!productId) return notFound();

  try {
    const row = await getInventoryRow(productId);
    if (!row) return notFound();
    return NextResponse.json({ product: row }, { status: 200 });
  } catch (err) {
    console.error(
      `[GET /api/admin/inventory/products/${productId}] failed`,
      err,
    );
    return errorResponse(500, {
      error: "Failed to load inventory row",
      code: "internal_error",
    });
  }
}

export async function PATCH(req: Request, ctx: RouteParams) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    if (err instanceof ForbiddenError) return forbidden();
    throw err;
  }

  const { productId } = await ctx.params;
  if (!productId) return notFound();

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
    const result = await updateProductStock({
      productId,
      stock: body.stock as number | undefined,
      delta: body.delta as number | undefined,
      reason: body.reason as string | null | undefined,
      userId: admin.id,
    });
    if (!result.ok) return stockErrorResponse(result.error);
    return NextResponse.json(
      { product: result.data.product, adjustment: result.data.adjustment },
      { status: 200 },
    );
  } catch (err) {
    console.error(
      `[PATCH /api/admin/inventory/products/${productId}] failed`,
      err,
    );
    return errorResponse(500, {
      error: "Failed to update product stock",
      code: "internal_error",
    });
  }
}
