/**
 * Low-stock threshold configuration.
 *
 *   GET /api/admin/inventory/threshold
 *     Returns `{ value, default, max }` — the active threshold and the
 *     supported range so the admin UI can render a sensible input.
 *
 *   PUT /api/admin/inventory/threshold
 *     Body: `{ value: number }`. Upserts the threshold in `app_config`
 *     under `inventory.low_stock_threshold` and records the acting admin.
 *     Returns the new value plus `updatedAt`.
 *
 * Requires the `admin` role.
 */
import { NextResponse } from "next/server";

import {
  AuthRequiredError,
  ForbiddenError,
  requireAdmin,
} from "@/lib/server/auth";
import {
  DEFAULT_LOW_STOCK_THRESHOLD,
  LOW_STOCK_THRESHOLD_MAX,
  getLowStockThreshold,
  setLowStockThreshold,
} from "@/lib/server/inventory";

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

export async function GET() {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    if (err instanceof ForbiddenError) return forbidden();
    throw err;
  }

  try {
    const value = await getLowStockThreshold();
    return NextResponse.json(
      {
        value,
        default: DEFAULT_LOW_STOCK_THRESHOLD,
        max: LOW_STOCK_THRESHOLD_MAX,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("[GET /api/admin/inventory/threshold] failed", err);
    return errorResponse(500, {
      error: "Failed to load threshold",
      code: "internal_error",
    });
  }
}

export async function PUT(req: Request) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    if (err instanceof ForbiddenError) return forbidden();
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

  if (!json || typeof json !== "object") {
    return errorResponse(400, {
      error: "Request body must be a JSON object",
      code: "validation_failed",
    });
  }

  const body = json as { value?: unknown };
  if (typeof body.value !== "number") {
    return errorResponse(400, {
      error: "`value` must be a number",
      code: "validation_failed",
      fieldErrors: { value: ["Expected an integer"] },
    });
  }

  try {
    const result = await setLowStockThreshold({
      value: body.value,
      userId: admin.id,
    });
    if (!result.ok) {
      return errorResponse(400, {
        error: result.error.message,
        code: result.error.code,
        fieldErrors: result.error.fields,
      });
    }
    return NextResponse.json(
      {
        value: result.data.value,
        updatedAt: result.data.updatedAt,
        default: DEFAULT_LOW_STOCK_THRESHOLD,
        max: LOW_STOCK_THRESHOLD_MAX,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("[PUT /api/admin/inventory/threshold] failed", err);
    return errorResponse(500, {
      error: "Failed to update threshold",
      code: "internal_error",
    });
  }
}
