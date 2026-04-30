/**
 * Admin low-stock list.
 *
 *   GET /api/admin/inventory/low-stock
 *     Returns every product with `stock <= lowStockThreshold`, ordered
 *     by stock ascending. Cap on `limit` keeps the result tractable for
 *     dashboards; default 100, max 500.
 *
 * Requires the `admin` role.
 */
import { NextResponse } from "next/server";

import {
  AuthRequiredError,
  ForbiddenError,
  requireAdmin,
} from "@/lib/server/auth";
import { listLowStockProducts } from "@/lib/server/inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ErrorBody {
  error: string;
  code: string;
  fieldErrors?: Record<string, string[]>;
}

function errorResponse(status: number, body: ErrorBody) {
  return NextResponse.json(body, { status });
}

export async function GET(req: Request) {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      return errorResponse(401, {
        error: "Authentication required",
        code: "unauthenticated",
      });
    }
    if (err instanceof ForbiddenError) {
      return errorResponse(403, {
        error: "Admin role required",
        code: "forbidden",
      });
    }
    throw err;
  }

  const url = new URL(req.url);
  const limitRaw = url.searchParams.get("limit");
  let limit: number | undefined;
  if (limitRaw !== null && limitRaw !== "") {
    if (!/^\d+$/.test(limitRaw)) {
      return errorResponse(400, {
        error: "`limit` must be a positive integer",
        code: "validation_failed",
        fieldErrors: { limit: ["Expected an integer"] },
      });
    }
    const parsed = parseInt(limitRaw, 10);
    if (parsed < 1 || parsed > 500) {
      return errorResponse(400, {
        error: "`limit` must be between 1 and 500",
        code: "validation_failed",
        fieldErrors: { limit: ["Out of range (1-500)"] },
      });
    }
    limit = parsed;
  }

  try {
    const result = await listLowStockProducts({ limit });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[GET /api/admin/inventory/low-stock] failed", err);
    return errorResponse(500, {
      error: "Failed to load low-stock products",
      code: "internal_error",
    });
  }
}
